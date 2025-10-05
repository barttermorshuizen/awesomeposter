import type { DiscoveryAdapterResult, DiscoveryIngestionAdapter } from '../ingestion.js'
import type { DiscoveryIngestionFailureReason } from '../../discovery.js'
import {
  normalizedDiscoveryAdapterItemSchema,
  type YoutubeSourceMetadata,
} from '../../discovery.js'
import { sanitizeHtmlContent, createExcerpt, derivePublishedAt } from '../normalization.js'

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

function resolveFailureReason(status: number): DiscoveryIngestionFailureReason {
  if (status === 403 || status === 429) return 'youtube_quota'
  if (status === 404) return 'youtube_not_found'
  if (status >= 500) return 'http_5xx'
  if (status >= 400) return 'http_4xx'
  return 'unknown_error'
}

function parseBody(body: string): YoutubeApiResponse | null {
  try {
    const parsed = JSON.parse(body) as YoutubeApiResponse
    if (parsed && typeof parsed === 'object') {
      return parsed
    }
    return null
  } catch {
    return null
  }
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

function resolvePlaylistId(config: Record<string, unknown> | null): string | null {
  if (!config || typeof config !== 'object') return null
  const youtubeConfig = (config as { youtube?: Record<string, unknown> }).youtube
  if (youtubeConfig && typeof youtubeConfig === 'object') {
    const playlist = youtubeConfig.playlist ?? youtubeConfig.playlistId
    if (typeof playlist === 'string' && playlist.trim()) {
      return playlist.trim()
    }
  }
  return null
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
          adapter: 'youtube',
          status,
        },
      }
    }

    const parsed = parseBody(body)
    if (!parsed) {
      return {
        ok: false,
        failureReason: 'parser_error',
        raw: {
          status,
          headers,
          body,
        },
        metadata: {
          adapter: 'youtube',
          status,
          message: 'Unable to parse YouTube API response',
        },
      }
    }

    const items = Array.isArray(parsed.items) ? parsed.items : []
    const now = context?.now?.() ?? new Date()
    const playlistId = resolvePlaylistId(input.config)

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
        channelId: snippet.channelId ?? null,
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
        status,
        headers,
      },
      metadata: {
        adapter: 'youtube',
        itemCount: normalizedItems.length,
        totalItems: items.length,
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
        adapter: 'youtube',
        message: err.message,
      },
    }
  }
}

export default fetchYoutubeSource
