import type { DiscoveryAdapterResult, DiscoveryIngestionAdapter } from '../ingestion.js'
import type { DiscoveryIngestionFailureReason } from '../../discovery.js'
import {
  normalizedDiscoveryAdapterItemSchema,
  type YoutubeSourceMetadata,
} from '../../discovery.js'
import { sanitizeHtmlContent, createExcerpt, derivePublishedAt } from '../normalization.js'
import {
  buildYoutubeDataApiRequest,
  type BuildYoutubeDataApiRequestOptions,
  type YoutubeDataApiRequest,
} from '../youtube.js'
import type { DiscoverySourceConfig } from '../config.js'

type Fetcher = typeof globalThis.fetch

type FetchError = Error & { name?: string }

type YoutubeApiItem = {
  id?: string | { videoId?: string }
  snippet?: {
    title?: string
    description?: string
    publishedAt?: string
    channelId?: string
  }
  contentDetails?: {
    duration?: string
  }
  transcript?: {
    text?: string
    available?: boolean
  } | string | null
}

type YoutubeApiResponse = {
  items?: YoutubeApiItem[] | null
}

type YoutubeApiRequestMetadata = {
  type: YoutubeDataApiRequest['type']
  url: string
  status: number | null
}

type YoutubeApiSuccess = {
  ok: true
  status: number
  headers: Record<string, string>
  body: string
  json: unknown
}

type YoutubeApiFailure = {
  ok: false
  status: number
  headers: Record<string, string>
  body: string
  failureReason: DiscoveryIngestionFailureReason
}

type YoutubeApiResult = YoutubeApiSuccess | YoutubeApiFailure

function resolveFailureReason(status: number): DiscoveryIngestionFailureReason {
  if (status === 403 || status === 429) return 'youtube_quota'
  if (status === 404) return 'youtube_not_found'
  if (status >= 500) return 'http_5xx'
  if (status >= 400) return 'http_4xx'
  return 'unknown_error'
}

function extractVideoId(item: YoutubeApiItem): string | null {
  if (!item) return null
  if (typeof item.id === 'string') return item.id
  if (item.id && typeof item.id === 'object' && typeof item.id.videoId === 'string') {
    return item.id.videoId
  }
  return null
}

function isoDurationToSeconds(duration: string | undefined): number | null {
  if (!duration) return null
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(duration)
  if (!match) return null
  const [, hours, minutes, seconds] = match
  const total = (Number(hours ?? '0') * 3600) + (Number(minutes ?? '0') * 60) + Number(seconds ?? '0')
  return Number.isFinite(total) ? total : null
}

function toTranscriptText(transcript: YoutubeApiItem['transcript']): { text: string; available: boolean } {
  if (!transcript) return { text: '', available: false }
  if (typeof transcript === 'string') {
    const trimmed = transcript.trim()
    return { text: trimmed, available: Boolean(trimmed) }
  }
  const text = transcript.text?.trim() ?? ''
  const available = transcript.available ?? Boolean(text)
  return { text, available }
}

function resolvePlaylistId(config: DiscoverySourceConfig | null): string | null {
  const playlist = config?.youtube?.playlist
  if (typeof playlist === 'string' && playlist.trim()) {
    return playlist.trim()
  }
  return null
}

function resolveChannelIdentifier(config: DiscoverySourceConfig | null): string | null {
  const channel = config?.youtube?.channel
  if (typeof channel === 'string' && channel.trim()) {
    return channel.trim()
  }
  return null
}

function toChannelPublicUrl(identifier: string): string {
  if (identifier.startsWith('@')) {
    return `https://www.youtube.com/${identifier}`
  }
  if (identifier.startsWith('c:')) {
    return `https://www.youtube.com/c/${identifier.slice(2)}`
  }
  if (identifier.startsWith('user:')) {
    return `https://www.youtube.com/user/${identifier.slice(5)}`
  }
  return `https://www.youtube.com/channel/${identifier}`
}

function extractChannelIdFromLookup(request: YoutubeDataApiRequest, json: unknown): string | null {
  if (!json || typeof json !== 'object' || !('items' in json)) {
    return null
  }
  const items = Array.isArray((json as { items?: unknown }).items) ? (json as { items: unknown[] }).items : []
  if (!items.length) {
    return null
  }

  if (request.type === 'resolveHandle' || request.type === 'resolveUsername') {
    const first = items[0] as { id?: unknown }
    if (typeof first?.id === 'string') {
      return first.id
    }
    return null
  }

  if (request.type === 'searchChannel') {
    for (const raw of items) {
      const candidate = raw as { id?: unknown; snippet?: { channelId?: string } }
      const direct = candidate?.id as { channelId?: string } | undefined
      if (direct && typeof direct.channelId === 'string' && direct.channelId.trim()) {
        return direct.channelId.trim()
      }
      if (candidate?.snippet?.channelId && candidate.snippet.channelId.trim()) {
        return candidate.snippet.channelId.trim()
      }
    }
  }

  return null
}

async function fetchYoutubeApi(
  fetcher: Fetcher,
  request: YoutubeDataApiRequest,
  signal: AbortSignal | undefined,
): Promise<YoutubeApiResult> {
  const response = await fetcher(request.url, { signal })
  const status = response.status
  const headers = Object.fromEntries(response.headers.entries())
  const body = await response.text()

  if (!response.ok) {
    const failureReason = resolveFailureReason(status)
    return {
      ok: false,
      status,
      headers,
      body,
      failureReason,
    }
  }

  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return {
      ok: false,
      status,
      headers,
      body,
      failureReason: 'parser_error',
    }
  }

  return {
    ok: true,
    status,
    headers,
    body,
    json,
  }
}

export const fetchYoutubeSource: DiscoveryIngestionAdapter = async (input, context): Promise<DiscoveryAdapterResult> => {
  const fetcher: Fetcher | undefined = context?.fetch ?? globalThis.fetch
  if (!fetcher) {
    return {
      ok: false,
      failureReason: 'unknown_error',
      error: new Error('No fetch implementation available for YouTube adapter'),
    }
  }

  try {
    const playlistOverride = resolvePlaylistId(input.config)
    const channelIdentifier = resolveChannelIdentifier(input.config)
    const publicUrl = playlistOverride
      ? `https://www.youtube.com/playlist?list=${playlistOverride}`
      : channelIdentifier
        ? toChannelPublicUrl(channelIdentifier)
        : input.canonicalUrl || input.url

    const requestOptions: BuildYoutubeDataApiRequestOptions = {
      apiKey: context?.youtubeApiKey ?? process.env.YOUTUBE_API_KEY ?? undefined,
      baseUrl: context?.youtubeApiBaseUrl ?? process.env.YOUTUBE_DATA_API_BASE_URL ?? undefined,
      maxResults: context?.youtubeMaxResults,
    }

    const requestsMetadata: YoutubeApiRequestMetadata[] = []

    let request: YoutubeDataApiRequest
    try {
      request = buildYoutubeDataApiRequest(publicUrl, requestOptions)
    } catch (error) {
      return {
        ok: false,
        failureReason: 'unknown_error',
        error: error as Error,
        metadata: {
          adapter: 'youtube',
          message: 'Failed to build YouTube Data API request',
        },
      }
    }

    let finalResponse: YoutubeApiSuccess | null = null
    let resolvedChannelId: string | null = null
    let playlistId = playlistOverride ?? null

    for (let hop = 0; hop < 2; hop++) {
      const apiResult = await fetchYoutubeApi(fetcher, request, context?.signal)
      requestsMetadata.push({ type: request.type, url: request.url, status: apiResult.status })

      if (!apiResult.ok) {
        return {
          ok: false,
          failureReason: apiResult.failureReason,
          raw: {
            status: apiResult.status,
            headers: apiResult.headers,
            body: apiResult.body,
          },
          retryInMinutes: apiResult.failureReason === 'http_5xx' ? 5 : null,
          metadata: {
            adapter: 'youtube',
            status: apiResult.status,
            requests: requestsMetadata,
          },
        }
      }

      if (request.type === 'channelUploads') {
        finalResponse = apiResult
        resolvedChannelId = request.channelId
        playlistId = request.playlistId
        break
      }

      if (request.type === 'playlistItems') {
        finalResponse = apiResult
        break
      }

      const derivedChannelId = extractChannelIdFromLookup(request, apiResult.json)
      if (!derivedChannelId) {
        return {
          ok: false,
          failureReason: 'youtube_not_found',
          raw: {
            status: apiResult.status,
            headers: apiResult.headers,
            body: apiResult.body,
          },
          metadata: {
            adapter: 'youtube',
            status: apiResult.status,
            requests: requestsMetadata,
            message: 'Unable to resolve channel identifier from YouTube response',
          },
        }
      }

      resolvedChannelId = derivedChannelId
      const uploadsUrl = `https://www.youtube.com/channel/${derivedChannelId}`
      request = buildYoutubeDataApiRequest(uploadsUrl, requestOptions)
    }

    if (!finalResponse) {
      return {
        ok: false,
        failureReason: 'unknown_error',
        metadata: {
          adapter: 'youtube',
          message: 'Failed to retrieve playlist items after request hops',
          requests: requestsMetadata,
        },
      }
    }

    const parsed = ((): YoutubeApiResponse | null => {
      const candidates = (finalResponse.json as { items?: unknown })?.items
      if (!Array.isArray(candidates)) {
        return { items: [] }
      }
      return { items: candidates as YoutubeApiItem[] }
    })()

    const items = Array.isArray(parsed?.items) ? parsed.items : []
    const now = context?.now?.() ?? new Date()

    const skipped: Array<{ reason: string; videoId: string | null; detail?: string }> = []

    const normalizedItems = items.flatMap((item) => {
      const videoId = extractVideoId(item)
      if (!videoId) {
        skipped.push({ reason: 'missing_video_id', videoId: null })
        return []
      }

      const snippet = item.snippet ?? {}
      const description = snippet.description ?? ''
      const { text: transcriptText, available: transcriptAvailable } = toTranscriptText(item.transcript)
      const bodySource = transcriptText || description
      const extracted = sanitizeHtmlContent(bodySource || snippet.title || '')
      if (!extracted) {
        skipped.push({ reason: 'empty_body', videoId })
        return []
      }

      const published = derivePublishedAt([snippet.publishedAt], now, 'api', 'fallback')
      const durationSeconds = isoDurationToSeconds(item.contentDetails?.duration)

      const candidate = {
        externalId: videoId,
        title: (snippet.title ?? `YouTube Video ${videoId}`).slice(0, 500) || `YouTube Video ${videoId}`,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        contentType: 'youtube' as const,
        publishedAt: published.publishedAt,
        publishedAtSource: published.source,
        fetchedAt: now.toISOString(),
        extractedBody: extracted,
        excerpt: createExcerpt(extracted),
      }

      const validated = normalizedDiscoveryAdapterItemSchema.safeParse(candidate)
      if (!validated.success) {
        skipped.push({
          reason: 'validation_error',
          videoId,
          detail: validated.error.issues.map((issue) => issue.message).join(', '),
        })
        return []
      }

      const metadata: YoutubeSourceMetadata = {
        contentType: 'youtube',
        videoId,
        channelId: snippet.channelId ?? resolvedChannelId ?? null,
        playlistId: playlistId ?? undefined,
        transcriptAvailable,
        durationSeconds,
      }

      return [
        {
          rawPayload: item as Record<string, unknown>,
          normalized: validated.data,
          sourceMetadata: metadata,
        },
      ]
    })

    return {
      ok: true,
      items: normalizedItems,
      raw: {
        status: finalResponse.status,
        headers: finalResponse.headers,
      },
      metadata: {
        adapter: 'youtube',
        itemCount: normalizedItems.length,
        totalItems: items.length,
        skippedCount: skipped.length,
        skipped,
        requests: requestsMetadata,
        channelId: resolvedChannelId,
        playlistId,
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
        adapter: 'youtube',
        message: err.message,
      },
    }
  }
}

export default fetchYoutubeSource
