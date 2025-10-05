import type { DiscoveryAdapterResult, DiscoveryIngestionAdapter } from '../ingestion.js'
import type { DiscoveryIngestionFailureReason } from '../../discovery.js'
import {
  normalizedDiscoveryAdapterItemSchema,
  type RssSourceMetadata,
} from '../../discovery.js'
import {
  sanitizeHtmlContent,
  createExcerpt,
  stripHtml,
  derivePublishedAt,
} from '../normalization.js'

type Fetcher = typeof globalThis.fetch

type FetchError = Error & { name?: string }

type ParsedFeedEntry = {
  guid: string | null
  link: string | null
  title: string | null
  description: string | null
  content: string | null
  publishedAt: string | null
  categories: string[]
  raw: Record<string, unknown>
}

type FeedFormat = 'rss' | 'atom'

function resolveFailureReason(status: number): DiscoveryIngestionFailureReason {
  if (status >= 500) return 'http_5xx'
  if (status >= 400) return 'http_4xx'
  return 'unknown_error'
}

function toEntries(feed: string): { format: FeedFormat; entries: ParsedFeedEntry[] } {
  const itemMatches = [...feed.matchAll(/<item[\s\S]*?<\/item>/gi)]
  if (itemMatches.length > 0) {
    return { format: 'rss', entries: itemMatches.map((match) => parseRssItem(match[0])) }
  }

  const atomMatches = [...feed.matchAll(/<entry[\s\S]*?<\/entry>/gi)]
  if (atomMatches.length > 0) {
    return { format: 'atom', entries: atomMatches.map((match) => parseAtomEntry(match[0])) }
  }

  return { format: 'rss', entries: [] }
}

function matchTag(source: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')
  const match = regex.exec(source)
  return match ? match[1]?.trim() ?? null : null
}

function matchTagAllowingCData(source: string, tag: string): string | null {
  const value = matchTag(source, tag)
  if (!value) return null
  const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/i.exec(value)
  return cdata ? cdata[1]?.trim() ?? '' : value
}

function parseCategories(source: string): string[] {
  const matches = [...source.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/gi)]
  if (!matches.length) return []
  return matches
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value))
}

function parseLink(source: string): string | null {
  const rssLink = matchTag(source, 'link')
  if (rssLink) return rssLink.trim()
  const atomMatch = /<link\s+[^>]*href="([^"]+)"/i.exec(source) || /<link\s+[^>]*href='([^']+)'/i.exec(source)
  return atomMatch ? atomMatch[1]?.trim() ?? null : null
}

function parseRssItem(source: string): ParsedFeedEntry {
  return {
    guid: matchTag(source, 'guid') ?? parseLink(source),
    link: parseLink(source),
    title: matchTagAllowingCData(source, 'title'),
    description: matchTagAllowingCData(source, 'description'),
    content: matchTagAllowingCData(source, 'content:encoded'),
    publishedAt: matchTag(source, 'pubDate'),
    categories: parseCategories(source),
    raw: { source },
  }
}

function parseAtomEntry(source: string): ParsedFeedEntry {
  return {
    guid: matchTag(source, 'id') ?? parseLink(source),
    link: parseLink(source),
    title: matchTagAllowingCData(source, 'title'),
    description: matchTagAllowingCData(source, 'summary'),
    content: matchTagAllowingCData(source, 'content'),
    publishedAt: matchTag(source, 'published') ?? matchTag(source, 'updated'),
    categories: parseCategories(source),
    raw: { source },
  }
}

export const fetchRssSource: DiscoveryIngestionAdapter = async (input, context): Promise<DiscoveryAdapterResult> => {
  const fetcher: Fetcher | undefined = context?.fetch ?? globalThis.fetch
  if (!fetcher) {
    return {
      ok: false,
      failureReason: 'unknown_error',
      error: new Error('No fetch implementation available for RSS adapter'),
    }
  }

  try {
    const response = await fetcher(input.url, { signal: context?.signal })
    const status = response.status
    const headers = Object.fromEntries(response.headers.entries())
    const body = await response.text()

    if (!response.ok) {
      const failureReason = resolveFailureReason(status)
      return {
        ok: false,
        failureReason,
        raw: {
          status,
          statusText: response.statusText,
          headers,
          body,
        },
        retryInMinutes: failureReason === 'http_5xx' ? 5 : null,
        metadata: {
          adapter: 'rss',
          status,
        },
      }
    }

    const { entries } = toEntries(body)
    const now = context?.now?.() ?? new Date()
    const feedUrl = input.canonicalUrl || input.url

    const skipped: Array<{ reason: string; entryId: string | null; detail?: string }> = []

    const normalizedItems = entries.flatMap((entry) => {
      const rawBody = entry.content ?? entry.description ?? ''
      const extracted = sanitizeHtmlContent(rawBody || entry.title || '')
      if (!extracted) {
        skipped.push({ reason: 'empty_content', entryId: entry.guid ?? entry.link ?? null })
        return []
      }

      const link = entry.link ?? feedUrl
      const externalId = entry.guid ?? link
      const published = derivePublishedAt([entry.publishedAt], now, 'feed', 'fallback')

      const candidate = {
        externalId: externalId ?? link,
        title:
          (entry.title ? stripHtml(entry.title).trim() : stripHtml(link)).slice(0, 500)
          || 'Untitled Entry',
        url: link,
        contentType: 'rss' as const,
        publishedAt: published.publishedAt,
        publishedAtSource: published.source,
        fetchedAt: now.toISOString(),
        extractedBody: extracted,
        excerpt: createExcerpt(extracted),
      }

      const parsed = normalizedDiscoveryAdapterItemSchema.safeParse(candidate)
      if (!parsed.success) {
        skipped.push({
          reason: 'validation_error',
          entryId: externalId ?? link,
          detail: parsed.error.issues.map((issue) => issue.message).join(', '),
        })
        return []
      }

      const metadata: RssSourceMetadata = {
        contentType: 'rss',
        feedUrl,
        entryId: externalId ?? link,
        categories: entry.categories.length ? entry.categories : undefined,
      }

      return [
        {
          rawPayload: entry.raw,
          normalized: parsed.data,
          sourceMetadata: metadata,
        },
      ]
    })

    return {
      ok: true,
      items: normalizedItems,
      raw: {
        status,
        headers,
      },
      metadata: {
        adapter: 'rss',
        itemCount: normalizedItems.length,
        entryCount: entries.length,
        skippedCount: skipped.length,
        skipped,
      },
    }
  } catch (error) {
    const err = error as FetchError
    const failureReason: DiscoveryIngestionFailureReason = err.name === 'AbortError' ? 'timeout' : 'network_error'
    return {
      ok: false,
      failureReason,
      error: err,
      retryInMinutes: failureReason === 'network_error' ? 5 : null,
      metadata: {
        adapter: 'rss',
        message: err.message,
      },
    }
  }
}

export default fetchRssSource
