import { randomUUID } from 'node:crypto';
import { h as defineTask } from '../nitro/nitro.mjs';
import { i as fetchDiscoveryItemsForScoring, j as listDiscoverySourcesDue, k as claimDiscoverySourceForFetch, m as saveDiscoveryItems, n as completeDiscoverySourceFetch, r as releaseDiscoverySourceAfterFailedCompletion, o as countPendingDiscoveryItemsForClient, p as resetDiscoveryItemsToPending, q as persistDiscoveryScores } from './discovery-repository.mjs';
import { e as emitDiscoveryEvent } from './discovery-events.mjs';
import { p as publishSourceHealthStatus } from './discovery-health.mjs';
import { i as isFeatureEnabled, F as FEATURE_DISCOVERY_AGENT } from './feature-flags.mjs';
import { z } from 'zod';
import { g as getKeywordThemesForClient } from './discovery-keyword-cache.mjs';
import { f as normalizedDiscoveryAdapterItemSchema, a as normalizeDiscoverySourceUrl, g as discoveryContentTypeSchema, e as discoveryIngestionFailureReasonSchema } from './discovery.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:url';
import 'drizzle-orm';
import './client.mjs';
import 'drizzle-orm/node-postgres';
import 'pg';
import 'drizzle-orm/pg-core';
import '@upstash/redis';

const SMART_CHAR_MAP = {
  "\u2018": "'",
  "\u2019": "'",
  "\u201C": '"',
  "\u201D": '"',
  "\u2014": "--",
  "\u2013": "-",
  "\u2026": "...",
  "\xA0": " ",
  "\u2009": " ",
  "\u200A": " ",
  "\u200B": ""
};
const ENTITY_MAP = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " "
};
const SENTENCE_SPLIT_REGEX = /(?<=[.!?])\s+/g;
const HTML_COMMENT_REGEX = /<!--([\s\S]*?)-->/g;
const TAGS_TO_STRIP = ["script", "style", "noscript", "template", "iframe"];
const BOILERPLATE_TAGS = ["nav", "header", "footer", "aside", "form"];
function replaceSmartCharacters(input) {
  return input.replace(/[\u2018\u2019\u201C\u201D\u2014\u2013\u2026\u00A0\u2009\u200A\u200B]/g, (match) => {
    var _a;
    return (_a = SMART_CHAR_MAP[match]) != null ? _a : "";
  });
}
function decodeEntities(input) {
  return input.replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
    const codePoint = Number.parseInt(hex, 16);
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
  }).replace(/&#(\d+);/g, (_, num) => {
    const codePoint = Number.parseInt(num, 10);
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
  }).replace(/&([a-z]+);/gi, (_, entity) => {
    var _a;
    return (_a = ENTITY_MAP[entity.toLowerCase()]) != null ? _a : `&${entity};`;
  });
}
function stripTags(html, tagNames) {
  return tagNames.reduce((acc, tag) => acc.replace(new RegExp(`<${tag}[^>]*>[sS]*?</${tag}>`, "gi"), " "), html);
}
function stripBoilerplate(html) {
  let output = html.replace(HTML_COMMENT_REGEX, " ");
  output = stripTags(output, TAGS_TO_STRIP);
  output = stripTags(output, BOILERPLATE_TAGS);
  return output;
}
function extractText(html) {
  const withoutBoilerplate = stripBoilerplate(html);
  const withoutTags = withoutBoilerplate.replace(/<br\s*\/?>/gi, "\n").replace(/<p[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ");
  const decoded = decodeEntities(withoutTags);
  const ascii = replaceSmartCharacters(decoded);
  return ascii.replace(/[\t\r\f\v]+/g, " ").replace(/\n{2,}/g, "\n").replace(/\s{2,}/g, " ").trim();
}
function truncatePreservingSentences(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }
  const sentences = text.split(SENTENCE_SPLIT_REGEX);
  const pieces = [];
  let total = 0;
  for (const sentence of sentences) {
    const candidate = sentence.trim();
    if (!candidate)
      continue;
    const addedLength = candidate.length + (pieces.length > 0 ? 1 : 0);
    if (total + addedLength > maxLength) {
      break;
    }
    pieces.push(candidate);
    total += addedLength;
  }
  if (!pieces.length) {
    return text.slice(0, maxLength).trimEnd();
  }
  return pieces.join(" ");
}
function sanitizeHtmlContent(html, maxLength = 5e3) {
  const text = extractText(html);
  const cleaned = stripResidualBoilerplate(text);
  const truncated = truncatePreservingSentences(cleaned, maxLength);
  return truncated;
}
function stripResidualBoilerplate(text) {
  let trimmed = text.trimStart();
  const keywords = ["navigation", "menu", "advertisement"];
  for (const keyword of keywords) {
    const lower = trimmed.toLowerCase();
    const index = lower.indexOf(keyword);
    if (index === -1)
      continue;
    const fragment = trimmed.slice(index);
    const pattern = new RegExp(`^${keyword}(?:\\s+[A-Za-z][^\\s]*)*`, "i");
    const match = fragment.match(pattern);
    if (match) {
      trimmed = `${trimmed.slice(0, index)}${fragment.slice(match[0].length)}`.trimStart();
    }
  }
  return trimmed;
}
function createExcerpt(text, maxLength = 320) {
  if (!text)
    return null;
  const truncated = truncatePreservingSentences(text, maxLength);
  return truncated.length === text.length ? truncated : `${truncated}...`;
}
function normalizeTitle(rawTitle) {
  if (!rawTitle)
    return null;
  return replaceSmartCharacters(decodeEntities(rawTitle)).trim() || null;
}
function derivePublishedAt(candidates, fallback, candidateSource = "original", fallbackSource = "fallback") {
  for (const candidate of candidates) {
    if (!candidate)
      continue;
    const trimmed = candidate.trim();
    if (!trimmed)
      continue;
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime()))
      continue;
    return { publishedAt: parsed.toISOString(), source: candidateSource };
  }
  return { publishedAt: fallback.toISOString(), source: fallbackSource };
}
function extractMetaContent(html, keys) {
  var _a, _b;
  const pattern = /<meta\s+([^>]+)>/gi;
  let match;
  const normalizedKeys = keys.map((key) => key.toLowerCase());
  while ((match = pattern.exec(html)) !== null) {
    const attrs = match[1];
    const nameMatch = /(?:name|property)\s*=\s*"([^"]+)"/i.exec(attrs) || /(?:name|property)\s*=\s*'([^']+)'/i.exec(attrs);
    if (!nameMatch)
      continue;
    const key = (_a = nameMatch[1]) == null ? void 0 : _a.toLowerCase();
    if (!key || !normalizedKeys.includes(key))
      continue;
    const contentMatch = /content\s*=\s*"([^"]*)"/i.exec(attrs) || /content\s*=\s*'([^']*)'/i.exec(attrs);
    if (contentMatch) {
      return decodeEntities((_b = contentMatch[1]) != null ? _b : "");
    }
  }
  return null;
}
function stripHtml(html) {
  return extractText(html);
}

function resolveFailureReason$3(responseStatus) {
  if (responseStatus >= 500)
    return "http_5xx";
  if (responseStatus >= 400)
    return "http_4xx";
  return "unknown_error";
}
const fetchHttpSource = async (input, context) => {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k;
  const fetcher = (_a = context == null ? void 0 : context.fetch) != null ? _a : globalThis.fetch;
  if (!fetcher) {
    return {
      ok: false,
      failureReason: "unknown_error",
      error: new Error("No fetch implementation available for HTTP adapter")
    };
  }
  try {
    const response = await fetcher(input.url, { signal: context == null ? void 0 : context.signal });
    const status = response.status;
    const headers = Object.fromEntries(response.headers.entries());
    const body = await response.text();
    if (!response.ok) {
      const failureReason = resolveFailureReason$3(status);
      return {
        ok: false,
        failureReason,
        raw: {
          status,
          statusText: response.statusText,
          headers,
          body
        },
        retryInMinutes: failureReason === "http_5xx" ? 5 : null,
        metadata: {
          adapter: "http",
          status
        }
      };
    }
    const sanitizedBody = sanitizeHtmlContent(body);
    if (!sanitizedBody) {
      return {
        ok: false,
        failureReason: "parser_error",
        raw: {
          status,
          headers,
          body
        },
        metadata: {
          adapter: "http",
          status,
          message: "Empty body after sanitization"
        }
      };
    }
    const now = (_c = (_b = context == null ? void 0 : context.now) == null ? void 0 : _b.call(context)) != null ? _c : /* @__PURE__ */ new Date();
    const fallbackUrl = response.url || input.canonicalUrl || input.url;
    const metaTitle = extractMetaContent(body, ["og:title", "twitter:title"]);
    const titleFromTag = (() => {
      const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body);
      return match ? match[1] : null;
    })();
    const normalizedTitle = (_e = (_d = normalizeTitle(metaTitle != null ? metaTitle : titleFromTag)) != null ? _d : normalizeTitle(fallbackUrl)) != null ? _e : "Untitled Article";
    const metaPublished = extractMetaContent(body, [
      "article:published_time",
      "og:published_time",
      "pubdate",
      "date",
      "dc.date",
      "dc.date.issued"
    ]);
    const timeTagMatch = (_f = /<time[^>]*datetime="([^"]+)"[^>]*>/i.exec(body)) != null ? _f : /<time[^>]*datetime='([^']+)'[^>]*>/i.exec(body);
    const published = derivePublishedAt([metaPublished, (_g = timeTagMatch == null ? void 0 : timeTagMatch[1]) != null ? _g : null], now);
    const htmlLangMatch = (_h = /<html[^>]*lang="([^"]+)"[^>]*>/i.exec(body)) != null ? _h : /<html[^>]*lang='([^']+)'[^>]*>/i.exec(body);
    const contentLanguage = (_j = (_i = extractMetaContent(body, ["og:locale", "language", "content-language"])) != null ? _i : htmlLangMatch == null ? void 0 : htmlLangMatch[1]) != null ? _j : null;
    const candidate = {
      externalId: fallbackUrl,
      title: normalizedTitle,
      url: fallbackUrl,
      contentType: "article",
      publishedAt: published.publishedAt,
      publishedAtSource: published.source,
      fetchedAt: now.toISOString(),
      extractedBody: sanitizedBody,
      excerpt: createExcerpt(sanitizedBody)
    };
    const parsed = normalizedDiscoveryAdapterItemSchema.safeParse(candidate);
    if (!parsed.success) {
      return {
        ok: false,
        failureReason: "parser_error",
        raw: {
          status,
          headers,
          body
        },
        metadata: {
          adapter: "http",
          status,
          validationIssues: parsed.error.issues.map((issue) => issue.message)
        }
      };
    }
    const sourceMetadata = {
      contentType: "article",
      canonicalUrl: fallbackUrl,
      language: (_k = contentLanguage == null ? void 0 : contentLanguage.toLowerCase()) != null ? _k : null
    };
    return {
      ok: true,
      items: [
        {
          rawPayload: {
            status,
            headers,
            body,
            url: fallbackUrl
          },
          normalized: parsed.data,
          sourceMetadata
        }
      ],
      raw: {
        status,
        headers
      },
      metadata: {
        adapter: "http",
        contentLength: body.length,
        itemCount: 1,
        skippedCount: 0
      }
    };
  } catch (error) {
    const err = error;
    const failureReason = err.name === "AbortError" ? "timeout" : "network_error";
    return {
      ok: false,
      failureReason,
      error: err,
      retryInMinutes: failureReason === "network_error" ? 5 : null,
      metadata: {
        adapter: "http",
        message: err.message
      }
    };
  }
};

function resolveFailureReason$2(status) {
  if (status >= 500)
    return "http_5xx";
  if (status >= 400)
    return "http_4xx";
  return "unknown_error";
}
function toEntries(feed) {
  const itemMatches = [...feed.matchAll(/<item[\s\S]*?<\/item>/gi)];
  if (itemMatches.length > 0) {
    return { format: "rss", entries: itemMatches.map((match) => parseRssItem(match[0])) };
  }
  const atomMatches = [...feed.matchAll(/<entry[\s\S]*?<\/entry>/gi)];
  if (atomMatches.length > 0) {
    return { format: "atom", entries: atomMatches.map((match) => parseAtomEntry(match[0])) };
  }
  return { format: "rss", entries: [] };
}
function matchTag(source, tag) {
  var _a, _b;
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = regex.exec(source);
  return match ? (_b = (_a = match[1]) == null ? void 0 : _a.trim()) != null ? _b : null : null;
}
function matchTagAllowingCData(source, tag) {
  var _a, _b;
  const value = matchTag(source, tag);
  if (!value)
    return null;
  const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/i.exec(value);
  return cdata ? (_b = (_a = cdata[1]) == null ? void 0 : _a.trim()) != null ? _b : "" : value;
}
function parseCategories(source) {
  const matches = [...source.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/gi)];
  if (!matches.length)
    return [];
  return matches.map((match) => {
    var _a;
    return (_a = match[1]) == null ? void 0 : _a.trim();
  }).filter((value) => Boolean(value));
}
function parseLink(source) {
  var _a, _b;
  const rssLink = matchTag(source, "link");
  if (rssLink)
    return rssLink.trim();
  const atomMatch = /<link\s+[^>]*href="([^"]+)"/i.exec(source) || /<link\s+[^>]*href='([^']+)'/i.exec(source);
  return atomMatch ? (_b = (_a = atomMatch[1]) == null ? void 0 : _a.trim()) != null ? _b : null : null;
}
function parseRssItem(source) {
  var _a;
  return {
    guid: (_a = matchTag(source, "guid")) != null ? _a : parseLink(source),
    link: parseLink(source),
    title: matchTagAllowingCData(source, "title"),
    description: matchTagAllowingCData(source, "description"),
    content: matchTagAllowingCData(source, "content:encoded"),
    publishedAt: matchTag(source, "pubDate"),
    categories: parseCategories(source),
    raw: { source }
  };
}
function parseAtomEntry(source) {
  var _a, _b;
  return {
    guid: (_a = matchTag(source, "id")) != null ? _a : parseLink(source),
    link: parseLink(source),
    title: matchTagAllowingCData(source, "title"),
    description: matchTagAllowingCData(source, "summary"),
    content: matchTagAllowingCData(source, "content"),
    publishedAt: (_b = matchTag(source, "published")) != null ? _b : matchTag(source, "updated"),
    categories: parseCategories(source),
    raw: { source }
  };
}
const fetchRssSource = async (input, context) => {
  var _a, _b, _c;
  const fetcher = (_a = context == null ? void 0 : context.fetch) != null ? _a : globalThis.fetch;
  if (!fetcher) {
    return {
      ok: false,
      failureReason: "unknown_error",
      error: new Error("No fetch implementation available for RSS adapter")
    };
  }
  try {
    const response = await fetcher(input.url, { signal: context == null ? void 0 : context.signal });
    const status = response.status;
    const headers = Object.fromEntries(response.headers.entries());
    const body = await response.text();
    if (!response.ok) {
      const failureReason = resolveFailureReason$2(status);
      return {
        ok: false,
        failureReason,
        raw: {
          status,
          statusText: response.statusText,
          headers,
          body
        },
        retryInMinutes: failureReason === "http_5xx" ? 5 : null,
        metadata: {
          adapter: "rss",
          status
        }
      };
    }
    const { entries } = toEntries(body);
    const now = (_c = (_b = context == null ? void 0 : context.now) == null ? void 0 : _b.call(context)) != null ? _c : /* @__PURE__ */ new Date();
    const feedUrl = input.canonicalUrl || input.url;
    const skipped = [];
    const normalizedItems = entries.flatMap((entry) => {
      var _a2, _b2, _c2, _d, _e, _f;
      const rawBody = (_b2 = (_a2 = entry.content) != null ? _a2 : entry.description) != null ? _b2 : "";
      const extracted = sanitizeHtmlContent(rawBody || entry.title || "");
      if (!extracted) {
        skipped.push({ reason: "empty_content", entryId: (_d = (_c2 = entry.guid) != null ? _c2 : entry.link) != null ? _d : null });
        return [];
      }
      const link = (_e = entry.link) != null ? _e : feedUrl;
      const externalId = (_f = entry.guid) != null ? _f : link;
      const published = derivePublishedAt([entry.publishedAt], now, "feed", "fallback");
      const candidate = {
        externalId: externalId != null ? externalId : link,
        title: (entry.title ? stripHtml(entry.title).trim() : stripHtml(link)).slice(0, 500) || "Untitled Entry",
        url: link,
        contentType: "rss",
        publishedAt: published.publishedAt,
        publishedAtSource: published.source,
        fetchedAt: now.toISOString(),
        extractedBody: extracted,
        excerpt: createExcerpt(extracted)
      };
      const parsed = normalizedDiscoveryAdapterItemSchema.safeParse(candidate);
      if (!parsed.success) {
        skipped.push({
          reason: "validation_error",
          entryId: externalId != null ? externalId : link,
          detail: parsed.error.issues.map((issue) => issue.message).join(", ")
        });
        return [];
      }
      const metadata = {
        contentType: "rss",
        feedUrl,
        entryId: externalId != null ? externalId : link,
        categories: entry.categories.length ? entry.categories : void 0
      };
      return [
        {
          rawPayload: entry.raw,
          normalized: parsed.data,
          sourceMetadata: metadata
        }
      ];
    });
    return {
      ok: true,
      items: normalizedItems,
      raw: {
        status,
        headers
      },
      metadata: {
        adapter: "rss",
        itemCount: normalizedItems.length,
        entryCount: entries.length,
        skippedCount: skipped.length,
        skipped
      }
    };
  } catch (error) {
    const err = error;
    const failureReason = err.name === "AbortError" ? "timeout" : "network_error";
    return {
      ok: false,
      failureReason,
      error: err,
      retryInMinutes: failureReason === "network_error" ? 5 : null,
      metadata: {
        adapter: "rss",
        message: err.message
      }
    };
  }
};

const DEFAULT_YOUTUBE_DATA_API_BASE = "https://www.googleapis.com/youtube/v3/";
function toBaseUrl(raw) {
  if (!raw)
    return DEFAULT_YOUTUBE_DATA_API_BASE;
  return raw.endsWith("/") ? raw : `${raw}/`;
}
function buildUrl(baseUrl, path, params, apiKey) {
  const searchParams = new URLSearchParams(params);
  if (apiKey) {
    searchParams.set("key", apiKey);
  }
  const url = new URL(path, baseUrl);
  url.search = searchParams.toString();
  return { url: url.toString(), params };
}
function clampMaxResults(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 50;
  }
  return Math.min(Math.max(Math.floor(value), 1), 50);
}
function isChannelId(identifier) {
  return /^UC[0-9A-Za-z_-]{3,}$/.test(identifier);
}
function toUploadsPlaylistId(channelId) {
  return `UU${channelId.slice(2)}`;
}
function buildYoutubeDataApiRequest(rawUrl, options = {}) {
  const { apiKey, baseUrl, maxResults } = options;
  const normalized = normalizeDiscoverySourceUrl(rawUrl);
  const effectiveBase = toBaseUrl(baseUrl);
  const effectiveMaxResults = clampMaxResults(maxResults);
  if (normalized.sourceType === "youtube-playlist") {
    const params2 = {
      part: "snippet,contentDetails",
      playlistId: normalized.identifier,
      maxResults: String(effectiveMaxResults)
    };
    const built2 = buildUrl(effectiveBase, "playlistItems", params2, apiKey);
    return {
      type: "playlistItems",
      playlistId: normalized.identifier,
      url: built2.url,
      params: params2
    };
  }
  if (normalized.sourceType !== "youtube-channel") {
    throw new Error("URL does not represent a YouTube channel or playlist");
  }
  const identifier = normalized.identifier;
  if (isChannelId(identifier)) {
    const playlistId = toUploadsPlaylistId(identifier);
    const params2 = {
      part: "snippet,contentDetails",
      playlistId,
      maxResults: String(effectiveMaxResults)
    };
    const built2 = buildUrl(effectiveBase, "playlistItems", params2, apiKey);
    return {
      type: "channelUploads",
      channelId: identifier,
      playlistId,
      url: built2.url,
      params: params2
    };
  }
  if (identifier.startsWith("@")) {
    const params2 = {
      part: "id",
      forHandle: identifier
    };
    const built2 = buildUrl(effectiveBase, "channels", params2, apiKey);
    return {
      type: "resolveHandle",
      handle: identifier,
      url: built2.url,
      params: params2
    };
  }
  if (identifier.startsWith("user:")) {
    const username = identifier.slice("user:".length);
    const params2 = {
      part: "id",
      forUsername: username
    };
    const built2 = buildUrl(effectiveBase, "channels", params2, apiKey);
    return {
      type: "resolveUsername",
      username,
      url: built2.url,
      params: params2
    };
  }
  if (identifier.startsWith("c:")) {
    const query = identifier.slice("c:".length);
    const params2 = {
      part: "snippet",
      type: "channel",
      q: query,
      maxResults: "5"
    };
    const built2 = buildUrl(effectiveBase, "search", params2, apiKey);
    return {
      type: "searchChannel",
      query,
      url: built2.url,
      params: params2
    };
  }
  const params = {
    part: "snippet",
    type: "channel",
    q: identifier,
    maxResults: "5"
  };
  const built = buildUrl(effectiveBase, "search", params, apiKey);
  return {
    type: "searchChannel",
    query: identifier,
    url: built.url,
    params
  };
}

function resolveFailureReason$1(status) {
  if (status === 403 || status === 429)
    return "youtube_quota";
  if (status === 404)
    return "youtube_not_found";
  if (status >= 500)
    return "http_5xx";
  if (status >= 400)
    return "http_4xx";
  return "unknown_error";
}
function extractVideoId(item) {
  if (!item)
    return null;
  if (typeof item.id === "string")
    return item.id;
  if (item.id && typeof item.id === "object" && typeof item.id.videoId === "string") {
    return item.id.videoId;
  }
  return null;
}
function isoDurationToSeconds(duration) {
  if (!duration)
    return null;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(duration);
  if (!match)
    return null;
  const [, hours, minutes, seconds] = match;
  const total = Number(hours != null ? hours : "0") * 3600 + Number(minutes != null ? minutes : "0") * 60 + Number(seconds != null ? seconds : "0");
  return Number.isFinite(total) ? total : null;
}
function toTranscriptText(transcript) {
  var _a, _b, _c;
  if (!transcript)
    return { text: "", available: false };
  if (typeof transcript === "string") {
    const trimmed = transcript.trim();
    return { text: trimmed, available: Boolean(trimmed) };
  }
  const text = (_b = (_a = transcript.text) == null ? void 0 : _a.trim()) != null ? _b : "";
  const available = (_c = transcript.available) != null ? _c : Boolean(text);
  return { text, available };
}
function resolvePlaylistId(config) {
  var _a;
  if (!config || typeof config !== "object")
    return null;
  const youtubeConfig = config.youtube;
  if (youtubeConfig && typeof youtubeConfig === "object") {
    const playlist = (_a = youtubeConfig.playlist) != null ? _a : youtubeConfig.playlistId;
    if (typeof playlist === "string" && playlist.trim()) {
      return playlist.trim();
    }
  }
  return null;
}
function resolveChannelIdentifier(config) {
  var _a;
  if (!config || typeof config !== "object")
    return null;
  const youtubeConfig = config.youtube;
  if (!youtubeConfig || typeof youtubeConfig !== "object")
    return null;
  const channel = (_a = youtubeConfig.channel) != null ? _a : youtubeConfig.channelId;
  if (typeof channel === "string" && channel.trim()) {
    return channel.trim();
  }
  return null;
}
function toChannelPublicUrl(identifier) {
  if (identifier.startsWith("@")) {
    return `https://www.youtube.com/${identifier}`;
  }
  if (identifier.startsWith("c:")) {
    return `https://www.youtube.com/c/${identifier.slice(2)}`;
  }
  if (identifier.startsWith("user:")) {
    return `https://www.youtube.com/user/${identifier.slice(5)}`;
  }
  return `https://www.youtube.com/channel/${identifier}`;
}
function extractChannelIdFromLookup(request, json) {
  var _a;
  if (!json || typeof json !== "object" || !("items" in json)) {
    return null;
  }
  const items = Array.isArray(json.items) ? json.items : [];
  if (!items.length) {
    return null;
  }
  if (request.type === "resolveHandle" || request.type === "resolveUsername") {
    const first = items[0];
    if (typeof (first == null ? void 0 : first.id) === "string") {
      return first.id;
    }
    return null;
  }
  if (request.type === "searchChannel") {
    for (const raw of items) {
      const candidate = raw;
      const direct = candidate == null ? void 0 : candidate.id;
      if (direct && typeof direct.channelId === "string" && direct.channelId.trim()) {
        return direct.channelId.trim();
      }
      if (((_a = candidate == null ? void 0 : candidate.snippet) == null ? void 0 : _a.channelId) && candidate.snippet.channelId.trim()) {
        return candidate.snippet.channelId.trim();
      }
    }
  }
  return null;
}
async function fetchYoutubeApi(fetcher, request, signal) {
  const response = await fetcher(request.url, { signal });
  const status = response.status;
  const headers = Object.fromEntries(response.headers.entries());
  const body = await response.text();
  if (!response.ok) {
    const failureReason = resolveFailureReason$1(status);
    return {
      ok: false,
      status,
      headers,
      body,
      failureReason
    };
  }
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    return {
      ok: false,
      status,
      headers,
      body,
      failureReason: "parser_error"
    };
  }
  return {
    ok: true,
    status,
    headers,
    body,
    json
  };
}
const fetchYoutubeSource = async (input, context) => {
  var _a, _b, _c, _d, _e, _f, _g;
  const fetcher = (_a = context == null ? void 0 : context.fetch) != null ? _a : globalThis.fetch;
  if (!fetcher) {
    return {
      ok: false,
      failureReason: "unknown_error",
      error: new Error("No fetch implementation available for YouTube adapter")
    };
  }
  try {
    const playlistOverride = resolvePlaylistId(input.config);
    const channelIdentifier = resolveChannelIdentifier(input.config);
    const publicUrl = playlistOverride ? `https://www.youtube.com/playlist?list=${playlistOverride}` : channelIdentifier ? toChannelPublicUrl(channelIdentifier) : input.canonicalUrl || input.url;
    const requestOptions = {
      apiKey: (_c = (_b = context == null ? void 0 : context.youtubeApiKey) != null ? _b : process.env.YOUTUBE_API_KEY) != null ? _c : void 0,
      baseUrl: (_e = (_d = context == null ? void 0 : context.youtubeApiBaseUrl) != null ? _d : process.env.YOUTUBE_DATA_API_BASE_URL) != null ? _e : void 0,
      maxResults: context == null ? void 0 : context.youtubeMaxResults
    };
    const requestsMetadata = [];
    let request;
    try {
      request = buildYoutubeDataApiRequest(publicUrl, requestOptions);
    } catch (error) {
      return {
        ok: false,
        failureReason: "unknown_error",
        error,
        metadata: {
          adapter: "youtube",
          message: "Failed to build YouTube Data API request"
        }
      };
    }
    let finalResponse = null;
    let resolvedChannelId = null;
    let playlistId = playlistOverride != null ? playlistOverride : null;
    for (let hop = 0; hop < 2; hop++) {
      const apiResult = await fetchYoutubeApi(fetcher, request, context == null ? void 0 : context.signal);
      requestsMetadata.push({ type: request.type, url: request.url, status: apiResult.status });
      if (!apiResult.ok) {
        return {
          ok: false,
          failureReason: apiResult.failureReason,
          raw: {
            status: apiResult.status,
            headers: apiResult.headers,
            body: apiResult.body
          },
          retryInMinutes: apiResult.failureReason === "http_5xx" ? 5 : null,
          metadata: {
            adapter: "youtube",
            status: apiResult.status,
            requests: requestsMetadata
          }
        };
      }
      if (request.type === "channelUploads") {
        finalResponse = apiResult;
        resolvedChannelId = request.channelId;
        playlistId = request.playlistId;
        break;
      }
      if (request.type === "playlistItems") {
        finalResponse = apiResult;
        break;
      }
      const derivedChannelId = extractChannelIdFromLookup(request, apiResult.json);
      if (!derivedChannelId) {
        return {
          ok: false,
          failureReason: "youtube_not_found",
          raw: {
            status: apiResult.status,
            headers: apiResult.headers,
            body: apiResult.body
          },
          metadata: {
            adapter: "youtube",
            status: apiResult.status,
            requests: requestsMetadata,
            message: "Unable to resolve channel identifier from YouTube response"
          }
        };
      }
      resolvedChannelId = derivedChannelId;
      const uploadsUrl = `https://www.youtube.com/channel/${derivedChannelId}`;
      request = buildYoutubeDataApiRequest(uploadsUrl, requestOptions);
    }
    if (!finalResponse) {
      return {
        ok: false,
        failureReason: "unknown_error",
        metadata: {
          adapter: "youtube",
          message: "Failed to retrieve playlist items after request hops",
          requests: requestsMetadata
        }
      };
    }
    const parsed = (() => {
      var _a2;
      const candidates = (_a2 = finalResponse.json) == null ? void 0 : _a2.items;
      if (!Array.isArray(candidates)) {
        return { items: [] };
      }
      return { items: candidates };
    })();
    const items = Array.isArray(parsed == null ? void 0 : parsed.items) ? parsed.items : [];
    const now = (_g = (_f = context == null ? void 0 : context.now) == null ? void 0 : _f.call(context)) != null ? _g : /* @__PURE__ */ new Date();
    const skipped = [];
    const normalizedItems = items.flatMap((item) => {
      var _a2, _b2, _c2, _d2, _e2, _f2;
      const videoId = extractVideoId(item);
      if (!videoId) {
        skipped.push({ reason: "missing_video_id", videoId: null });
        return [];
      }
      const snippet = (_a2 = item.snippet) != null ? _a2 : {};
      const description = (_b2 = snippet.description) != null ? _b2 : "";
      const { text: transcriptText, available: transcriptAvailable } = toTranscriptText(item.transcript);
      const bodySource = transcriptText || description;
      const extracted = sanitizeHtmlContent(bodySource || snippet.title || "");
      if (!extracted) {
        skipped.push({ reason: "empty_body", videoId });
        return [];
      }
      const published = derivePublishedAt([snippet.publishedAt], now, "api", "fallback");
      const durationSeconds = isoDurationToSeconds((_c2 = item.contentDetails) == null ? void 0 : _c2.duration);
      const candidate = {
        externalId: videoId,
        title: ((_d2 = snippet.title) != null ? _d2 : `YouTube Video ${videoId}`).slice(0, 500) || `YouTube Video ${videoId}`,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        contentType: "youtube",
        publishedAt: published.publishedAt,
        publishedAtSource: published.source,
        fetchedAt: now.toISOString(),
        extractedBody: extracted,
        excerpt: createExcerpt(extracted)
      };
      const validated = normalizedDiscoveryAdapterItemSchema.safeParse(candidate);
      if (!validated.success) {
        skipped.push({
          reason: "validation_error",
          videoId,
          detail: validated.error.issues.map((issue) => issue.message).join(", ")
        });
        return [];
      }
      const metadata = {
        contentType: "youtube",
        videoId,
        channelId: (_f2 = (_e2 = snippet.channelId) != null ? _e2 : resolvedChannelId) != null ? _f2 : null,
        playlistId: playlistId != null ? playlistId : void 0,
        transcriptAvailable,
        durationSeconds
      };
      return [
        {
          rawPayload: item,
          normalized: validated.data,
          sourceMetadata: metadata
        }
      ];
    });
    return {
      ok: true,
      items: normalizedItems,
      raw: {
        status: finalResponse.status,
        headers: finalResponse.headers
      },
      metadata: {
        adapter: "youtube",
        itemCount: normalizedItems.length,
        totalItems: items.length,
        skippedCount: skipped.length,
        skipped,
        requests: requestsMetadata,
        channelId: resolvedChannelId,
        playlistId
      }
    };
  } catch (error) {
    const err = error;
    const failureReason = err.name === "AbortError" ? "timeout" : "network_error";
    return {
      ok: false,
      failureReason,
      error: err,
      retryInMinutes: failureReason === "network_error" ? 5 : null,
      metadata: {
        adapter: "youtube",
        message: err.message
      }
    };
  }
};

const ADAPTERS = {
  "web-page": fetchHttpSource,
  rss: fetchRssSource,
  "youtube-channel": fetchYoutubeSource,
  "youtube-playlist": fetchYoutubeSource
};
function getIngestionAdapter(type) {
  const adapter = ADAPTERS[type];
  if (!adapter) {
    throw new Error(`No ingestion adapter registered for type ${type}`);
  }
  return adapter;
}
async function executeIngestionAdapter(input, context) {
  const adapter = getIngestionAdapter(input.sourceType);
  return adapter(input, context);
}

const SCORE_FEATURE_FLAG = FEATURE_DISCOVERY_AGENT;
const DEFAULT_SOURCE_MULTIPLIERS = {
  article: 1,
  rss: 0.85,
  youtube: 0.75
};
const DEFAULT_COMPONENT_WEIGHTS = {
  keyword: 0.5,
  recency: 0.3,
  source: 0.2
};
const DEFAULT_THRESHOLD = 0.6;
const DEFAULT_RECENCY_HALF_LIFE_HOURS = 48;
const DEFAULT_WEIGHTS_VERSION = 1;
const SOURCE_METADATA_CONTENT_TYPE = z.object({
  contentType: discoveryContentTypeSchema.optional()
});
let cachedConfig = null;
function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}
function roundTo(value, precision = 4) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}
function parseNumberEnv(key, fallback, { min, max } = {}) {
  const raw = process.env[key];
  if (raw === void 0) return fallback;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return fallback;
  if (min !== void 0 && parsed < min) return fallback;
  if (max !== void 0 && parsed > max) return fallback;
  return parsed;
}
function normalizeWeights(weights) {
  const { keyword, recency, source } = weights;
  const sum = keyword + recency + source;
  if (!Number.isFinite(sum) || sum <= 0) {
    return { ...DEFAULT_COMPONENT_WEIGHTS };
  }
  return {
    keyword: keyword / sum,
    recency: recency / sum,
    source: source / sum
  };
}
function resolveScoringConfig() {
  if (cachedConfig) {
    return cachedConfig;
  }
  const weightsRaw = {
    keyword: parseNumberEnv("DISCOVERY_SCORING_KEYWORD_WEIGHT", DEFAULT_COMPONENT_WEIGHTS.keyword, { min: 0 }),
    recency: parseNumberEnv("DISCOVERY_SCORING_RECENCY_WEIGHT", DEFAULT_COMPONENT_WEIGHTS.recency, { min: 0 }),
    source: parseNumberEnv("DISCOVERY_SCORING_SOURCE_WEIGHT", DEFAULT_COMPONENT_WEIGHTS.source, { min: 0 })
  };
  const normalizedWeights = normalizeWeights(weightsRaw);
  const sourceMultipliers = {
    article: clamp01(parseNumberEnv("DISCOVERY_SCORING_SOURCE_WEIGHT_ARTICLE", DEFAULT_SOURCE_MULTIPLIERS.article, { min: 0 })),
    rss: clamp01(parseNumberEnv("DISCOVERY_SCORING_SOURCE_WEIGHT_RSS", DEFAULT_SOURCE_MULTIPLIERS.rss, { min: 0 })),
    youtube: clamp01(parseNumberEnv("DISCOVERY_SCORING_SOURCE_WEIGHT_YOUTUBE", DEFAULT_SOURCE_MULTIPLIERS.youtube, { min: 0 }))
  };
  const threshold = clamp01(parseNumberEnv("DISCOVERY_SCORING_THRESHOLD", DEFAULT_THRESHOLD, { min: 0, max: 1 }));
  const recencyHalfLifeHours = Math.max(1, parseNumberEnv("DISCOVERY_SCORING_RECENCY_HALF_LIFE_HOURS", DEFAULT_RECENCY_HALF_LIFE_HOURS, { min: 1 }));
  const weightsVersion = Math.trunc(parseNumberEnv("DISCOVERY_SCORING_WEIGHTS_VERSION", DEFAULT_WEIGHTS_VERSION, { min: 1 })) || DEFAULT_WEIGHTS_VERSION;
  cachedConfig = {
    weights: normalizedWeights,
    threshold,
    recencyHalfLifeHours,
    sourceMultipliers,
    weightsVersion
  };
  return cachedConfig;
}
function buildConfigSnapshot(config) {
  return {
    weights: config.weights,
    threshold: config.threshold,
    recencyHalfLifeHours: config.recencyHalfLifeHours,
    weightsVersion: config.weightsVersion
  };
}
const KEYWORD_MATCH_DAMPING = 2;
function computeKeywordScore(normalized, keywords) {
  if (!keywords.length) return 0;
  const text = `${normalized.title} ${normalized.extractedBody}`.toLowerCase();
  if (!text) return 0;
  let matches = 0;
  const seen = /* @__PURE__ */ new Set();
  for (const keyword of keywords) {
    const trimmed = keyword.trim().toLowerCase();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    if (text.includes(trimmed)) {
      matches += 1;
    }
  }
  if (!seen.size) return 0;
  if (matches === 0) return 0;
  const coverage = matches / seen.size;
  const matchInfluence = matches / (matches + KEYWORD_MATCH_DAMPING);
  const boosted = coverage + (1 - coverage) * matchInfluence;
  return clamp01(boosted);
}
function computeRecencyScore(item, normalized, halfLifeHours, now) {
  const referenceDate = normalized.publishedAt ? new Date(normalized.publishedAt) : item.fetchedAt;
  if (!(referenceDate instanceof Date) || Number.isNaN(referenceDate.getTime())) {
    return 0;
  }
  const ageMs = now.getTime() - referenceDate.getTime();
  if (ageMs <= 0) {
    return 1;
  }
  const ageHours = ageMs / (1e3 * 60 * 60);
  const decay = Math.pow(0.5, ageHours / halfLifeHours);
  return clamp01(decay);
}
function computeSourceScore(normalized, sourceMetadata, multipliers) {
  var _a;
  let contentType = normalized.contentType;
  if (!contentType) {
    const parsed = SOURCE_METADATA_CONTENT_TYPE.safeParse(sourceMetadata);
    if (parsed.success && parsed.data.contentType) {
      contentType = parsed.data.contentType;
    }
  }
  const multiplier = (_a = multipliers[contentType]) != null ? _a : multipliers.article;
  return clamp01(multiplier);
}
function toScoreResult(item, normalized, keywords, config, now) {
  var _a;
  const keywordComponent = computeKeywordScore(normalized, keywords);
  const recencyComponent = computeRecencyScore(item, normalized, config.recencyHalfLifeHours, now);
  const sourceComponent = computeSourceScore(normalized, (_a = item.sourceMetadata) != null ? _a : {}, config.sourceMultipliers);
  const score = clamp01(
    keywordComponent * config.weights.keyword + recencyComponent * config.weights.recency + sourceComponent * config.weights.source
  );
  const status = score >= config.threshold ? "scored" : "suppressed";
  return {
    itemId: item.id,
    clientId: item.clientId,
    sourceId: item.sourceId,
    score: roundTo(score),
    components: {
      keyword: roundTo(keywordComponent),
      recency: roundTo(recencyComponent),
      source: roundTo(sourceComponent)
    },
    appliedThreshold: config.threshold,
    status,
    weightsVersion: config.weightsVersion
  };
}
function buildMissingItemsError(itemIds) {
  return {
    ok: false,
    error: {
      code: "DISCOVERY_SCORING_NOT_FOUND",
      message: "One or more discovery items could not be found.",
      details: { itemIds }
    }
  };
}
function buildDisabledError(clientId, itemIds) {
  return {
    ok: false,
    error: {
      code: "DISCOVERY_SCORING_DISABLED",
      message: "Discovery scoring is not enabled for this client.",
      details: { clientId, itemIds }
    }
  };
}
function buildInvalidItemsError(invalidItems) {
  return {
    ok: false,
    error: {
      code: "DISCOVERY_SCORING_INVALID_ITEM",
      message: "One or more discovery items are missing required data for scoring.",
      details: { invalidItems }
    }
  };
}
function sanitizeIds(itemIds) {
  return itemIds.map((id) => id == null ? void 0 : id.trim()).filter((id) => Boolean(id));
}
async function scoreDiscoveryItems(itemIds, options) {
  var _a, _b, _c;
  const sanitizedIds = sanitizeIds(itemIds);
  if (!sanitizedIds.length) {
    const config2 = resolveScoringConfig();
    return {
      ok: true,
      results: [],
      config: buildConfigSnapshot(config2)
    };
  }
  const uniqueIds = Array.from(new Set(sanitizedIds));
  const items = await fetchDiscoveryItemsForScoring(uniqueIds);
  if (items.length !== uniqueIds.length) {
    const foundIds = new Set(items.map((item) => item.id));
    const missing = uniqueIds.filter((id) => !foundIds.has(id));
    return buildMissingItemsError(missing);
  }
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const config = resolveScoringConfig();
  const now = (_b = (_a = options == null ? void 0 : options.now) == null ? void 0 : _a.call(options)) != null ? _b : /* @__PURE__ */ new Date();
  const itemOrder = sanitizedIds.map((id) => itemsById.get(id));
  const itemsByClient = /* @__PURE__ */ new Map();
  for (const item of itemOrder) {
    const bucket = itemsByClient.get(item.clientId);
    if (bucket) {
      bucket.push(item);
    } else {
      itemsByClient.set(item.clientId, [item]);
    }
  }
  for (const [clientId, clientItems] of itemsByClient.entries()) {
    const enabled = await isFeatureEnabled(clientId, SCORE_FEATURE_FLAG);
    if (!enabled) {
      return buildDisabledError(clientId, clientItems.map((item) => item.id));
    }
  }
  const keywordsByClient = /* @__PURE__ */ new Map();
  for (const clientId of itemsByClient.keys()) {
    const keywords = await getKeywordThemesForClient(clientId);
    keywordsByClient.set(clientId, keywords);
  }
  const invalidItems = [];
  const resultsById = /* @__PURE__ */ new Map();
  for (const item of items) {
    const normalizedParse = normalizedDiscoveryAdapterItemSchema.safeParse(item.normalized);
    if (!normalizedParse.success) {
      invalidItems.push({ itemId: item.id, reason: "normalized_payload_invalid" });
      continue;
    }
    const normalized = normalizedParse.data;
    if (!normalized.extractedBody || normalized.extractedBody.trim().length === 0) {
      invalidItems.push({ itemId: item.id, reason: "extracted_body_missing" });
      continue;
    }
    const keywords = (_c = keywordsByClient.get(item.clientId)) != null ? _c : [];
    const scoreResult = toScoreResult(item, normalized, keywords, config, now);
    resultsById.set(item.id, scoreResult);
  }
  if (invalidItems.length) {
    return buildInvalidItemsError(invalidItems);
  }
  const orderedResults = sanitizedIds.map((id) => resultsById.get(id));
  return {
    ok: true,
    results: orderedResults,
    config: buildConfigSnapshot(config)
  };
}

var _a, _b;
const DEFAULT_WORKER_LIMIT = 3;
const MAX_BATCH_MULTIPLIER = 4;
const EVENT_VERSION = 1;
const DEFAULT_MAX_RETRY_ATTEMPTS = 3;
const DEFAULT_MAX_RETRY_DELAY_MINUTES = 15;
const BASE_RETRY_DELAY_MINUTES = 1;
const YOUTUBE_MAX_RESULTS_CAP = 50;
const DEFAULT_SCORING_PENDING_THRESHOLD = 500;
const SCORING_EVENT_VERSION = 1;
function parseWorkerLimit(raw) {
  const parsed = Number.parseInt(raw != null ? raw : "", 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_WORKER_LIMIT;
}
function parsePositiveInt(raw, fallback, { min = 1, max = Number.POSITIVE_INFINITY } = {}) {
  const parsed = Number.parseInt(raw != null ? raw : "", 10);
  if (Number.isFinite(parsed) && parsed >= min && parsed <= max) {
    return parsed;
  }
  return fallback;
}
function resolveYoutubeMaxResults(raw) {
  if (!raw) return void 0;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return void 0;
  const clamped = Math.min(Math.max(parsed, 1), YOUTUBE_MAX_RESULTS_CAP);
  return clamped;
}
function resolveMaxAttempts() {
  return parsePositiveInt(process.env.INGESTION_RETRY_MAX_ATTEMPTS, DEFAULT_MAX_RETRY_ATTEMPTS, { min: 1, max: 10 });
}
function resolveMaxRetryDelayMinutes() {
  return parsePositiveInt(process.env.INGESTION_RETRY_MAX_DELAY_MINUTES, DEFAULT_MAX_RETRY_DELAY_MINUTES, {
    min: BASE_RETRY_DELAY_MINUTES,
    max: 60
  });
}
let cachedScoringPendingThreshold = null;
function resolveScoringPendingThreshold() {
  var _a2;
  if (cachedScoringPendingThreshold !== null) {
    return cachedScoringPendingThreshold;
  }
  const raw = Number.parseInt((_a2 = process.env.DISCOVERY_SCORING_PENDING_THRESHOLD) != null ? _a2 : "", 10);
  if (Number.isFinite(raw) && raw >= 0) {
    cachedScoringPendingThreshold = raw === 0 ? Number.POSITIVE_INFINITY : Math.min(Math.max(raw, 1), 1e5);
    return cachedScoringPendingThreshold;
  }
  cachedScoringPendingThreshold = DEFAULT_SCORING_PENDING_THRESHOLD;
  return cachedScoringPendingThreshold;
}
const YOUTUBE_API_KEY = (_a = process.env.YOUTUBE_API_KEY) != null ? _a : void 0;
const YOUTUBE_API_BASE_URL = (_b = process.env.YOUTUBE_DATA_API_BASE_URL) != null ? _b : void 0;
const YOUTUBE_API_MAX_RESULTS = resolveYoutubeMaxResults(process.env.YOUTUBE_API_MAX_RESULTS);
function resolveFailureReason(raw) {
  if (typeof raw === "string") {
    const result = discoveryIngestionFailureReasonSchema.safeParse(raw);
    if (result.success) return result.data;
  }
  return "unknown_error";
}
function coerceTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
function emitDiscoveryEventSafely(event) {
  var _a2;
  try {
    emitDiscoveryEvent(event);
  } catch (error) {
    console.error("[discovery.ingest] failed to emit discovery event", {
      type: event.type,
      sourceId: "payload" in event ? (_a2 = event.payload) == null ? void 0 : _a2.sourceId : void 0,
      error
    });
  }
}
function buildAdapterTelemetry(result) {
  var _a2, _b2, _c, _d, _e, _f, _g, _h, _i, _j;
  if (result.ok) {
    return {
      adapter: (_b2 = (_a2 = result.metadata) == null ? void 0 : _a2.adapter) != null ? _b2 : "unknown",
      itemsFetched: result.items.length,
      metadata: (_c = result.metadata) != null ? _c : null
    };
  }
  return {
    adapter: (_e = (_d = result.metadata) == null ? void 0 : _d.adapter) != null ? _e : "unknown",
    metadata: (_f = result.metadata) != null ? _f : null,
    error: {
      message: (_h = (_g = result.error) == null ? void 0 : _g.message) != null ? _h : null,
      name: (_j = (_i = result.error) == null ? void 0 : _i.name) != null ? _j : null
    }
  };
}
function toSafeNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
function extractStatusCode(result) {
  var _a2, _b2;
  const status = toSafeNumber((_a2 = result.metadata) == null ? void 0 : _a2.status);
  if (status !== null) return Math.trunc(status);
  const rawStatus = (_b2 = result.raw) == null ? void 0 : _b2.status;
  const coerced = toSafeNumber(rawStatus);
  return coerced !== null ? Math.trunc(coerced) : null;
}
function extractRetryAfterMinutes(result, now) {
  var _a2;
  const rawHeaders = (_a2 = result.raw) == null ? void 0 : _a2.headers;
  if (!rawHeaders || typeof rawHeaders !== "object") return null;
  const headerEntries = Object.entries(rawHeaders);
  const header = headerEntries.find(([key]) => key.toLowerCase() === "retry-after");
  if (!header) return null;
  const [, value] = header;
  if (typeof value === "number") {
    return Math.max(0, Math.ceil(value / 60));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number.parseInt(trimmed, 10);
    if (Number.isFinite(numeric)) {
      return Math.max(0, Math.ceil(numeric / 60));
    }
    const parsedDate = new Date(trimmed);
    if (!Number.isNaN(parsedDate.getTime())) {
      const diffMs = parsedDate.getTime() - now.getTime();
      if (diffMs <= 0) return 0;
      return Math.max(0, Math.ceil(diffMs / 6e4));
    }
  }
  return null;
}
function classifyFailure(result, attempt, maxAttempts, now) {
  const failureReason = result.ok ? null : result.failureReason;
  if (!failureReason) {
    return { retryable: false, delayMinutes: null, reason: "none" };
  }
  const status = extractStatusCode(result);
  const maxDelay = resolveMaxRetryDelayMinutes();
  const suggestedRetry = typeof result.retryInMinutes === "number" && Number.isFinite(result.retryInMinutes) ? result.retryInMinutes : null;
  const retryAfter = extractRetryAfterMinutes(result, now);
  const baseDelay = Math.min(Math.pow(2, Math.max(0, attempt - 1)) * BASE_RETRY_DELAY_MINUTES, maxDelay);
  const computeDelay = () => {
    const overrides = [baseDelay];
    overrides.push(suggestedRetry);
    if (retryAfter !== null) overrides.push(retryAfter);
    const filtered = overrides.filter((value) => typeof value === "number" && value >= 0);
    if (filtered.length === 0) return baseDelay;
    const delay2 = Math.min(maxDelay, Math.max(...filtered));
    return Math.max(BASE_RETRY_DELAY_MINUTES, delay2);
  };
  const retryableFailureReasons = [
    "network_error",
    "timeout",
    "http_5xx",
    "youtube_quota"
  ];
  const isRetryableReason = retryableFailureReasons.includes(failureReason) || failureReason === "http_4xx" && status === 429;
  if (!isRetryableReason) {
    return { retryable: false, delayMinutes: null, reason: "permanent" };
  }
  if (attempt >= maxAttempts) {
    const delay2 = computeDelay();
    return {
      retryable: false,
      delayMinutes: delay2,
      reason: "exhausted",
      fromRetryAfterHeader: retryAfter !== null
    };
  }
  const delay = computeDelay();
  return {
    retryable: true,
    delayMinutes: delay,
    reason: "transient",
    fromRetryAfterHeader: retryAfter !== null
  };
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function extractItemIdsFromError(error) {
  const { details } = error;
  if (!details || typeof details !== "object") {
    return [];
  }
  const fromItemIds = Array.isArray(details.itemIds) ? details.itemIds.map((value) => typeof value === "string" ? value : null).filter((value) => Boolean(value)) : [];
  if (fromItemIds.length) {
    return fromItemIds;
  }
  const invalidItems = Array.isArray(details.invalidItems) ? details.invalidItems : [];
  if (invalidItems.length) {
    const collected = invalidItems.map((entry) => typeof entry.itemId === "string" ? entry.itemId : null).filter((value) => Boolean(value));
    return collected;
  }
  return [];
}
async function runInlineScoring({
  clientId,
  sourceId,
  itemIds,
  now
}) {
  var _a2, _b2, _c;
  if (itemIds.length === 0) {
    return { attempted: false, skippedReason: "no_new_items" };
  }
  const metrics = { attempted: false };
  const threshold = resolveScoringPendingThreshold();
  try {
    const enabled = await isFeatureEnabled(clientId, FEATURE_DISCOVERY_AGENT);
    if (!enabled) {
      metrics.skippedReason = "feature_disabled";
      console.info("[discovery.ingest] inline scoring skipped; feature disabled", { clientId, sourceId });
      return metrics;
    }
    const pendingBefore = await countPendingDiscoveryItemsForClient(clientId);
    metrics.pendingBefore = pendingBefore;
    if (pendingBefore > threshold) {
      metrics.skippedReason = "backlog";
      console.warn("[discovery.ingest] inline scoring deferred due to backlog", {
        clientId,
        sourceId,
        pending: pendingBefore,
        threshold
      });
      emitDiscoveryEventSafely({
        type: "discovery.queue.updated",
        version: SCORING_EVENT_VERSION,
        payload: {
          clientId,
          pendingCount: pendingBefore,
          updatedAt: now().toISOString(),
          reason: "backlog"
        }
      });
      return metrics;
    }
    metrics.attempted = true;
    const scoringStart = now();
    const response = await scoreDiscoveryItems(itemIds, { now });
    const scoringEnd = now();
    metrics.durationMs = Math.max(0, scoringEnd.getTime() - scoringStart.getTime());
    if (!response.ok) {
      metrics.skippedReason = "error";
      metrics.errorCode = response.error.code;
      metrics.errorMessage = response.error.message;
      const failedIds = extractItemIdsFromError(response.error);
      const resetIds = failedIds.length ? failedIds : itemIds;
      await resetDiscoveryItemsToPending(resetIds);
      emitDiscoveryEventSafely({
        type: "discovery.scoring.failed",
        version: SCORING_EVENT_VERSION,
        payload: {
          clientId,
          itemIds: resetIds,
          errorCode: response.error.code,
          errorMessage: response.error.message,
          details: (_a2 = response.error.details) != null ? _a2 : void 0,
          occurredAt: scoringEnd.toISOString()
        }
      });
      console.error("[discovery.ingest] inline scoring failed", {
        clientId,
        sourceId,
        error: response.error
      });
      return metrics;
    }
    metrics.scoredCount = response.results.filter((result) => result.status === "scored").length;
    metrics.suppressedCount = response.results.filter((result) => result.status === "suppressed").length;
    const scoredAt = now();
    const scoredAtIso = scoredAt.toISOString();
    await persistDiscoveryScores(
      response.results.map((result) => ({
        itemId: result.itemId,
        clientId: result.clientId,
        sourceId: result.sourceId,
        score: result.score,
        keywordScore: result.components.keyword,
        recencyScore: result.components.recency,
        sourceScore: result.components.source,
        appliedThreshold: result.appliedThreshold,
        status: result.status,
        weightsVersion: result.weightsVersion,
        components: result.components,
        metadata: { configSnapshot: response.config },
        scoredAt
      }))
    );
    const pendingAfter = await countPendingDiscoveryItemsForClient(clientId);
    metrics.pendingAfter = pendingAfter;
    for (const result of response.results) {
      emitDiscoveryEventSafely({
        type: "discovery.score.complete",
        version: SCORING_EVENT_VERSION,
        payload: {
          clientId: result.clientId,
          itemId: result.itemId,
          sourceId: result.sourceId,
          score: result.score,
          status: result.status,
          components: result.components,
          appliedThreshold: result.appliedThreshold,
          weightsVersion: result.weightsVersion,
          scoredAt: scoredAtIso
        }
      });
    }
    emitDiscoveryEventSafely({
      type: "discovery.queue.updated",
      version: SCORING_EVENT_VERSION,
      payload: {
        clientId,
        pendingCount: pendingAfter,
        scoredDelta: (_b2 = metrics.scoredCount) != null ? _b2 : 0,
        suppressedDelta: (_c = metrics.suppressedCount) != null ? _c : 0,
        updatedAt: scoredAtIso,
        reason: "scoring"
      }
    });
  } catch (error) {
    metrics.skippedReason = "error";
    metrics.errorMessage = error.message;
    console.error("[discovery.ingest] inline scoring encountered unexpected error", {
      clientId,
      sourceId,
      error
    });
  }
  return metrics;
}
async function processSource(source, options, stats) {
  var _a2, _b2, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l;
  const claimed = await claimDiscoverySourceForFetch(source.id, options.now());
  if (!claimed) {
    stats.skipped += 1;
    return;
  }
  const runId = randomUUID();
  const startedAt = options.now();
  const scheduledAt = (_a2 = coerceTimestamp(source.nextFetchAt)) != null ? _a2 : startedAt;
  emitDiscoveryEventSafely({
    type: "ingestion.started",
    version: EVENT_VERSION,
    payload: {
      runId,
      clientId: claimed.clientId,
      sourceId: claimed.id,
      sourceType: claimed.sourceType,
      scheduledAt: scheduledAt.toISOString(),
      startedAt: startedAt.toISOString()
    }
  });
  let success = false;
  let failureReason = null;
  let retryInMinutes = null;
  let nextRetryAt = null;
  let adapterResult = null;
  const attempts = [];
  const maxAttempts = resolveMaxAttempts();
  let permanentFailureNotice = null;
  const runMetrics = {};
  const ingestionIssues = [];
  let healthUpdate = null;
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const attemptStartedAt = options.now();
      let result;
      try {
        result = await executeIngestionAdapter(
          {
            sourceId: claimed.id,
            clientId: claimed.clientId,
            sourceType: claimed.sourceType,
            url: claimed.url,
            canonicalUrl: claimed.canonicalUrl,
            config: (_b2 = claimed.configJson) != null ? _b2 : null
          },
          {
            fetch: options.fetch,
            now: options.now,
            youtubeApiKey: YOUTUBE_API_KEY,
            youtubeApiBaseUrl: YOUTUBE_API_BASE_URL,
            youtubeMaxResults: YOUTUBE_API_MAX_RESULTS
          }
        );
      } catch (error) {
        const derivedFailure = resolveFailureReason((_c = error == null ? void 0 : error.cause) != null ? _c : null);
        result = {
          ok: false,
          failureReason: derivedFailure,
          error,
          retryInMinutes: null,
          metadata: { adapter: "unknown" }
        };
      }
      adapterResult = result;
      const attemptCompletedAt = options.now();
      const attemptDurationMs = Math.max(0, attemptCompletedAt.getTime() - attemptStartedAt.getTime());
      const adapterName = typeof ((_d = result.metadata) == null ? void 0 : _d.adapter) === "string" ? result.metadata.adapter : (_e = runMetrics.adapter) != null ? _e : "unknown";
      runMetrics.adapter = adapterName;
      if (result.ok) {
        const metadata = (_f = result.metadata) != null ? _f : {};
        const skippedDetails = Array.isArray(metadata.skipped) ? metadata.skipped : [];
        if (typeof metadata.entryCount === "number") {
          runMetrics.entryCount = metadata.entryCount;
        }
        if (typeof metadata.totalItems === "number") {
          runMetrics.totalItems = metadata.totalItems;
        }
        runMetrics.normalizedCount = result.items.length;
        runMetrics.skippedCount = skippedDetails.length;
        if (skippedDetails.length) {
          ingestionIssues.push({
            reason: "adapter_skipped",
            count: skippedDetails.length,
            details: skippedDetails
          });
        }
        let persistence = null;
        try {
          persistence = await saveDiscoveryItems({
            clientId: claimed.clientId,
            sourceId: claimed.id,
            items: result.items.map((item) => ({
              normalized: item.normalized,
              rawPayload: item.rawPayload,
              sourceMetadata: item.sourceMetadata
            }))
          });
        } catch (persistError) {
          result = {
            ok: false,
            failureReason: "unknown_error",
            error: persistError,
            metadata: {
              adapter: adapterName
            }
          };
          adapterResult = result;
        }
        if (result.ok && persistence) {
          runMetrics.insertedCount = persistence.inserted.length;
          runMetrics.duplicateCount = persistence.duplicates.length;
          if (persistence.duplicates.length) {
            ingestionIssues.push({ reason: "duplicate", count: persistence.duplicates.length });
          }
          const scoringMetrics = await runInlineScoring({
            clientId: claimed.clientId,
            sourceId: claimed.id,
            itemIds: persistence.inserted.map((item) => item.id),
            now: options.now
          });
          runMetrics.scoring = scoringMetrics;
          success = true;
          failureReason = null;
          retryInMinutes = null;
          nextRetryAt = null;
          attempts.push({
            attempt,
            startedAt: attemptStartedAt.toISOString(),
            completedAt: attemptCompletedAt.toISOString(),
            durationMs: attemptDurationMs,
            success: true,
            retryInMinutes: null,
            nextRetryAt: null
          });
          break;
        }
      }
      failureReason = result.failureReason;
      const classification = classifyFailure(result, attempt, maxAttempts, attemptCompletedAt);
      retryInMinutes = (_g = classification.delayMinutes) != null ? _g : null;
      nextRetryAt = retryInMinutes != null ? new Date(attemptCompletedAt.getTime() + retryInMinutes * 6e4) : null;
      attempts.push({
        attempt,
        startedAt: attemptStartedAt.toISOString(),
        completedAt: attemptCompletedAt.toISOString(),
        durationMs: attemptDurationMs,
        success: false,
        failureReason,
        retryInMinutes,
        nextRetryAt: nextRetryAt ? nextRetryAt.toISOString() : null,
        retryReason: classification.reason,
        retryAfterOverride: (_h = classification.fromRetryAfterHeader) != null ? _h : false
      });
      if (!classification.retryable) {
        if (classification.reason === "permanent") {
          permanentFailureNotice = {
            failureReason,
            attempt
          };
        }
        break;
      }
      if (retryInMinutes && retryInMinutes > 0) {
        await sleep(retryInMinutes * 6e4);
      }
    }
  } finally {
    if (!success && !failureReason) {
      failureReason = "unknown_error";
    }
    const completedAt = options.now();
    const durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime());
    if (failureReason) {
      runMetrics.failureReason = failureReason;
    }
    try {
      healthUpdate = await completeDiscoverySourceFetch({
        runId,
        sourceId: claimed.id,
        clientId: claimed.clientId,
        startedAt,
        completedAt,
        fetchIntervalMinutes: claimed.fetchIntervalMinutes,
        success,
        failureReason,
        retryInMinutes,
        telemetry: {
          durationMs,
          ...adapterResult ? buildAdapterTelemetry(adapterResult) : {},
          attempts,
          attemptCount: attempts.length,
          maxAttempts,
          nextRetryAt: nextRetryAt ? nextRetryAt.toISOString() : null
        },
        metrics: {
          ...runMetrics,
          issues: ingestionIssues
        }
      });
    } catch (error) {
      console.error("[discovery.ingest] failed to persist completion", {
        sourceId: claimed.id,
        runId,
        error
      });
      try {
        healthUpdate = await releaseDiscoverySourceAfterFailedCompletion({
          sourceId: claimed.id,
          completedAt,
          fetchIntervalMinutes: claimed.fetchIntervalMinutes,
          success,
          failureReason,
          retryInMinutes
        });
      } catch (fallbackError) {
        console.error("[discovery.ingest] failed to reset source after completion error", {
          sourceId: claimed.id,
          runId,
          error: fallbackError
        });
      }
    }
    emitDiscoveryEventSafely({
      type: "ingestion.completed",
      version: EVENT_VERSION,
      payload: {
        runId,
        clientId: claimed.clientId,
        sourceId: claimed.id,
        sourceType: claimed.sourceType,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs,
        success,
        failureReason: failureReason != null ? failureReason : void 0,
        retryInMinutes: retryInMinutes != null ? retryInMinutes : void 0,
        attempt: attempts.length,
        maxAttempts,
        attempts,
        nextRetryAt: nextRetryAt ? nextRetryAt.toISOString() : void 0,
        metrics: runMetrics
      }
    });
    if (!success) {
      emitDiscoveryEventSafely({
        type: "ingestion.failed",
        version: EVENT_VERSION,
        payload: {
          runId,
          clientId: claimed.clientId,
          sourceId: claimed.id,
          sourceType: claimed.sourceType,
          failureReason: failureReason != null ? failureReason : "unknown_error",
          attempt: attempts.length,
          maxAttempts,
          retryInMinutes: retryInMinutes != null ? retryInMinutes : void 0,
          nextRetryAt: nextRetryAt ? nextRetryAt.toISOString() : void 0
        }
      });
    } else if (ingestionIssues.length) {
      emitDiscoveryEventSafely({
        type: "ingest.error",
        version: EVENT_VERSION,
        payload: {
          runId,
          clientId: claimed.clientId,
          sourceId: claimed.id,
          sourceType: claimed.sourceType,
          issues: ingestionIssues
        }
      });
    }
    if (healthUpdate) {
      publishSourceHealthStatus({
        clientId: claimed.clientId,
        sourceId: claimed.id,
        sourceType: claimed.sourceType,
        status: healthUpdate.status,
        lastFetchedAt: (_i = healthUpdate.lastFetchedAt) != null ? _i : void 0,
        observedAt: healthUpdate.observedAt,
        failureReason: (_j = healthUpdate.failureReason) != null ? _j : void 0,
        consecutiveFailures: healthUpdate.consecutiveFailures,
        attempt: !success ? (_k = permanentFailureNotice == null ? void 0 : permanentFailureNotice.attempt) != null ? _k : attempts.length : void 0,
        staleSince: (_l = healthUpdate.staleSince) != null ? _l : void 0
      });
    }
  }
  if (success) {
    stats.succeeded += 1;
  } else {
    stats.failed += 1;
  }
}
async function runDiscoveryIngestionJob(opts = {}) {
  var _a2, _b2, _c, _d;
  const nowFn = (_a2 = opts.now) != null ? _a2 : (() => /* @__PURE__ */ new Date());
  const workerLimit = (_b2 = opts.workerLimit) != null ? _b2 : parseWorkerLimit(process.env.DISCOVERY_INGEST_WORKERS);
  const fetchImpl = (_c = opts.fetch) != null ? _c : typeof globalThis.fetch === "function" ? globalThis.fetch : void 0;
  const batchSize = (_d = opts.batchSize) != null ? _d : Math.max(workerLimit * MAX_BATCH_MULTIPLIER, workerLimit);
  const dueSources = await listDiscoverySourcesDue(batchSize, nowFn());
  const stats = {
    totalDue: dueSources.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0
  };
  if (dueSources.length === 0) {
    return stats;
  }
  const runnerOptions = {
    now: nowFn,
    ...fetchImpl ? { fetch: fetchImpl } : {}
  };
  const queue = [...dueSources];
  const active = /* @__PURE__ */ new Set();
  const launch = (source) => {
    const task = (async () => {
      stats.processed += 1;
      await processSource(source, runnerOptions, stats);
    })().catch((error) => {
      console.error("[discovery.ingest] failed to process source", {
        sourceId: source.id,
        error
      });
      stats.failed += 1;
    });
    const tracked = task.finally(() => {
      active.delete(tracked);
    });
    active.add(tracked);
  };
  const refill = () => {
    while (active.size < workerLimit && queue.length > 0) {
      const next = queue.shift();
      launch(next);
    }
  };
  refill();
  while (active.size > 0) {
    await Promise.race(active);
    refill();
  }
  return stats;
}
const ingestSources = defineTask({
  meta: {
    name: "discovery-ingestion",
    description: "Fetch discovery sources on cadence"
  },
  async run() {
    const result = await runDiscoveryIngestionJob();
    return { result };
  }
});

export { ingestSources as default, runDiscoveryIngestionJob };
//# sourceMappingURL=ingest-sources.mjs.map
