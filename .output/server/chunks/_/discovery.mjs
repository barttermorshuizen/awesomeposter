import { z } from 'zod';

const discoverySourceTypeSchema = z.enum([
  "rss",
  "youtube-channel",
  "youtube-playlist",
  "web-page"
]);
const discoveryIngestionFailureReasonSchema = z.enum([
  "network_error",
  "http_4xx",
  "http_5xx",
  "youtube_quota",
  "youtube_not_found",
  "timeout",
  "parser_error",
  "unknown_error"
]);
const discoveryContentTypeSchema = z.enum(["article", "rss", "youtube"]);
const discoveryPublishedAtSourceSchema = z.enum(["original", "fallback", "feed", "api"]);
const normalizedDiscoveryAdapterItemSchema = z.object({
  externalId: z.string().min(1),
  title: z.string().min(1).max(500),
  url: z.string().url(),
  contentType: discoveryContentTypeSchema,
  publishedAt: z.string().datetime().nullable(),
  publishedAtSource: discoveryPublishedAtSourceSchema,
  fetchedAt: z.string().datetime(),
  extractedBody: z.string().min(1),
  excerpt: z.string().optional().nullable()
});
const createDiscoverySourceInputSchema = z.object({
  clientId: z.string().uuid(),
  url: z.string().min(1, "URL is required"),
  notes: z.string().max(2e3).optional().nullable()
});
const KEYWORD_MAX_LENGTH = 40;
const ASCII_PATTERN = /^[\x20-\x7E]+$/;
function collapseInternalWhitespace(value) {
  return value.replace(/\s+/g, " ");
}
function buildDuplicateKey(canonical) {
  return canonical.replace(/[-\s]+/g, " ").trim();
}
function normalizeDiscoveryKeyword(raw) {
  if (typeof raw !== "string") {
    throw new Error("Keyword is required");
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Keyword is required");
  }
  const collapsed = collapseInternalWhitespace(trimmed);
  if (collapsed.length > KEYWORD_MAX_LENGTH) {
    throw new Error(`Keywords must be ${KEYWORD_MAX_LENGTH} characters or fewer`);
  }
  if (!ASCII_PATTERN.test(collapsed)) {
    throw new Error("Keywords must use ASCII characters only");
  }
  const canonical = collapsed.toLowerCase();
  const duplicateKey = buildDuplicateKey(canonical);
  return {
    cleaned: collapsed,
    canonical,
    duplicateKey
  };
}
const SUPPORTED_PROTOCOLS = /* @__PURE__ */ new Set(["http:", "https:"]);
const RSS_PATH_HINTS = [
  "/feed",
  "/feeds",
  ".rss",
  ".xml",
  ".atom",
  ".rdf"
];
function trimTrailingSlash(path) {
  if (path === "/")
    return "/";
  return path.replace(/\/+$/g, "") || "/";
}
function canonicalizeYoutubeIdentifier(pathSegments, search) {
  if (search.has("list")) {
    const listId = search.get("list").trim();
    if (!listId)
      return null;
    return { type: "youtube-playlist", identifier: listId };
  }
  if (pathSegments.length === 0)
    return null;
  const [first, second] = pathSegments;
  if (first.startsWith("@")) {
    return { type: "youtube-channel", identifier: first };
  }
  if (first === "channel" && second) {
    return { type: "youtube-channel", identifier: second };
  }
  if (first === "c" && second) {
    return { type: "youtube-channel", identifier: `c:${second}` };
  }
  if (first === "user" && second) {
    return { type: "youtube-channel", identifier: `user:${second}` };
  }
  return null;
}
function isLikelyRss(pathname, hostname) {
  const lowerPath = pathname.toLowerCase();
  if (hostname.startsWith("feeds."))
    return true;
  return RSS_PATH_HINTS.some((hint) => lowerPath.endsWith(hint) || lowerPath.includes(`${hint}/`));
}
function normalizeDiscoverySourceUrl(rawUrl) {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error("URL is required");
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    throw new Error("Enter a valid URL with http:// or https://");
  }
  if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error("Only HTTP(S) URLs are supported");
  }
  parsed.username = "";
  parsed.password = "";
  if (parsed.protocol === "http:" && parsed.port === "80" || parsed.protocol === "https:" && parsed.port === "443") {
    parsed.port = "";
  }
  const hostname = parsed.hostname.toLowerCase();
  const pathname = trimTrailingSlash(decodeURIComponent(parsed.pathname || "/"));
  const search = parsed.searchParams;
  const isYoutube = /(^|\.)youtube\.com$/.test(hostname) || hostname === "youtu.be";
  let detected = null;
  if (isYoutube) {
    const segments = pathname.split("/").filter(Boolean);
    detected = canonicalizeYoutubeIdentifier(segments, search);
    if ((detected == null ? void 0 : detected.type) === "youtube-playlist") {
      const listId = detected.identifier;
      parsed.search = "";
      parsed.searchParams.set("list", listId);
    } else {
      parsed.search = "";
    }
  } else {
    const preserved = new URLSearchParams();
    for (const key of search.keys()) {
      const lowerKey = key.toLowerCase();
      if (lowerKey === "utm")
        continue;
      if (lowerKey.startsWith("utm_"))
        continue;
      if (lowerKey === "fbclid")
        continue;
      preserved.set(key, search.get(key));
    }
    parsed.search = preserved.toString() ? `?${preserved.toString()}` : "";
  }
  const canonicalHost = hostname;
  const canonicalPath = pathname;
  const canonicalSearch = parsed.search;
  parsed.hostname = canonicalHost;
  parsed.pathname = canonicalPath;
  const canonicalUrl = `${parsed.protocol}//${canonicalHost}${canonicalPath}${canonicalSearch}`;
  if (detected) {
    return {
      url: parsed.toString(),
      canonicalUrl,
      sourceType: detected.type,
      identifier: detected.identifier
    };
  }
  if (isLikelyRss(pathname, canonicalHost)) {
    return {
      url: parsed.toString(),
      canonicalUrl,
      sourceType: "rss",
      identifier: canonicalUrl
    };
  }
  return {
    url: parsed.toString(),
    canonicalUrl,
    sourceType: "web-page",
    identifier: `${canonicalHost}${canonicalPath}${canonicalSearch}`
  };
}
function deriveDuplicateKey(ns) {
  return `${ns.sourceType}::${ns.identifier.toLowerCase()}`;
}

export { normalizeDiscoverySourceUrl as a, discoverySourceTypeSchema as b, createDiscoverySourceInputSchema as c, deriveDuplicateKey as d, discoveryIngestionFailureReasonSchema as e, normalizedDiscoveryAdapterItemSchema as f, discoveryContentTypeSchema as g, normalizeDiscoveryKeyword as n };
//# sourceMappingURL=discovery.mjs.map
