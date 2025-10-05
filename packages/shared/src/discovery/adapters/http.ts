import type { DiscoveryIngestionAdapter, DiscoveryAdapterResult } from '../ingestion.js'
import type { DiscoveryIngestionFailureReason } from '../../discovery.js'
import {
  normalizedDiscoveryAdapterItemSchema,
  type ArticleSourceMetadata,
} from '../../discovery.js'
import {
  sanitizeHtmlContent,
  createExcerpt,
  extractMetaContent,
  derivePublishedAt,
  normalizeTitle,
} from '../normalization.js'

type Fetcher = typeof globalThis.fetch

type FetchError = Error & { name?: string }

function resolveFailureReason(responseStatus: number): DiscoveryIngestionFailureReason {
  if (responseStatus >= 500) return 'http_5xx'
  if (responseStatus >= 400) return 'http_4xx'
  return 'unknown_error'
}

async function readResponseBody(response: Response) {
  try {
    const cloned = response.clone()
    return await cloned.text()
  } catch (error) {
    return { error: (error as Error).message }
  }
}

export const fetchHttpSource: DiscoveryIngestionAdapter = async (input, context): Promise<DiscoveryAdapterResult> => {
  const fetcher: Fetcher | undefined = context?.fetch ?? globalThis.fetch
  if (!fetcher) {
    return {
      ok: false,
      failureReason: 'unknown_error',
      error: new Error('No fetch implementation available for HTTP adapter'),
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
          adapter: 'http',
          status,
        },
      }
    }

    const sanitizedBody = sanitizeHtmlContent(body)

    if (!sanitizedBody) {
      return {
        ok: false,
        failureReason: 'parser_error',
        raw: {
          status,
          headers,
          body,
        },
        metadata: {
          adapter: 'http',
          status,
          message: 'Empty body after sanitization',
        },
      }
    }

    const now = context?.now?.() ?? new Date()
    const fallbackUrl = response.url || input.canonicalUrl || input.url
    const metaTitle = extractMetaContent(body, ['og:title', 'twitter:title'])
    const titleFromTag = (() => {
      const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)
      return match ? match[1] : null
    })()
    const normalizedTitle = normalizeTitle(metaTitle ?? titleFromTag) ?? normalizeTitle(fallbackUrl) ?? 'Untitled Article'

    const metaPublished = extractMetaContent(body, [
      'article:published_time',
      'og:published_time',
      'pubdate',
      'date',
      'dc.date',
      'dc.date.issued',
    ])
    const timeTagMatch = /<time[^>]*datetime="([^"]+)"[^>]*>/i.exec(body) ?? /<time[^>]*datetime='([^']+)'[^>]*>/i.exec(body)
    const published = derivePublishedAt([metaPublished, timeTagMatch?.[1] ?? null], now)

    const htmlLangMatch = /<html[^>]*lang="([^"]+)"[^>]*>/i.exec(body) ?? /<html[^>]*lang='([^']+)'[^>]*>/i.exec(body)
    const contentLanguage = extractMetaContent(body, ['og:locale', 'language', 'content-language']) ?? htmlLangMatch?.[1] ?? null

    const candidate = {
      externalId: fallbackUrl,
      title: normalizedTitle,
      url: fallbackUrl,
      contentType: 'article' as const,
      publishedAt: published.publishedAt,
      publishedAtSource: published.source,
      fetchedAt: now.toISOString(),
      extractedBody: sanitizedBody,
      excerpt: createExcerpt(sanitizedBody),
    }

    const parsed = normalizedDiscoveryAdapterItemSchema.safeParse(candidate)
    if (!parsed.success) {
      return {
        ok: false,
        failureReason: 'parser_error',
        raw: {
          status,
          headers,
          body,
        },
        metadata: {
          adapter: 'http',
          status,
          validationIssues: parsed.error.issues.map((issue) => issue.message),
        },
      }
    }

    const sourceMetadata: ArticleSourceMetadata = {
      contentType: 'article',
      canonicalUrl: fallbackUrl,
      language: contentLanguage?.toLowerCase() ?? null,
    }

    return {
      ok: true,
      items: [
        {
          rawPayload: {
            status,
            headers,
            body,
            url: fallbackUrl,
          },
          normalized: parsed.data,
          sourceMetadata,
        },
      ],
      raw: {
        status,
        headers,
      },
      metadata: {
        adapter: 'http',
        contentLength: body.length,
        itemCount: 1,
        skippedCount: 0,
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
        adapter: 'http',
        message: err.message,
      },
    }
  }
}

export default fetchHttpSource
