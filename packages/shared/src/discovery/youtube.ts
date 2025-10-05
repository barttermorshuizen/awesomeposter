import { normalizeDiscoverySourceUrl } from '../discovery.js'

const DEFAULT_YOUTUBE_DATA_API_BASE = 'https://www.googleapis.com/youtube/v3/'

export type YoutubeDataApiRequest =
  | {
      type: 'channelUploads'
      channelId: string
      playlistId: string
      url: string
      params: Record<string, string>
    }
  | {
      type: 'resolveHandle'
      handle: string
      url: string
      params: Record<string, string>
    }
  | {
      type: 'resolveUsername'
      username: string
      url: string
      params: Record<string, string>
    }
  | {
      type: 'searchChannel'
      query: string
      url: string
      params: Record<string, string>
    }
  | {
      type: 'playlistItems'
      playlistId: string
      url: string
      params: Record<string, string>
    }

export type BuildYoutubeDataApiRequestOptions = {
  apiKey?: string
  baseUrl?: string
  maxResults?: number
}

function toBaseUrl(raw?: string): string {
  if (!raw) return DEFAULT_YOUTUBE_DATA_API_BASE
  return raw.endsWith('/') ? raw : `${raw}/`
}

function buildUrl(baseUrl: string, path: string, params: Record<string, string>, apiKey?: string): {
  url: string
  params: Record<string, string>
} {
  const searchParams = new URLSearchParams(params)
  if (apiKey) {
    searchParams.set('key', apiKey)
  }
  const url = new URL(path, baseUrl)
  url.search = searchParams.toString()
  return { url: url.toString(), params }
}

function clampMaxResults(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 50
  }
  return Math.min(Math.max(Math.floor(value), 1), 50)
}

function isChannelId(identifier: string): boolean {
  return /^UC[0-9A-Za-z_-]{3,}$/.test(identifier)
}

function toUploadsPlaylistId(channelId: string): string {
  return `UU${channelId.slice(2)}`
}

export function buildYoutubeDataApiRequest(
  rawUrl: string,
  options: BuildYoutubeDataApiRequestOptions = {},
): YoutubeDataApiRequest {
  const { apiKey, baseUrl, maxResults } = options
  const normalized = normalizeDiscoverySourceUrl(rawUrl)

  const effectiveBase = toBaseUrl(baseUrl)
  const effectiveMaxResults = clampMaxResults(maxResults)

  if (normalized.sourceType === 'youtube-playlist') {
    const params: Record<string, string> = {
      part: 'snippet,contentDetails',
      playlistId: normalized.identifier,
      maxResults: String(effectiveMaxResults),
    }
    const built = buildUrl(effectiveBase, 'playlistItems', params, apiKey)
    return {
      type: 'playlistItems',
      playlistId: normalized.identifier,
      url: built.url,
      params,
    }
  }

  if (normalized.sourceType !== 'youtube-channel') {
    throw new Error('URL does not represent a YouTube channel or playlist')
  }

  const identifier = normalized.identifier

  if (isChannelId(identifier)) {
    const playlistId = toUploadsPlaylistId(identifier)
    const params: Record<string, string> = {
      part: 'snippet,contentDetails',
      playlistId,
      maxResults: String(effectiveMaxResults),
    }
    const built = buildUrl(effectiveBase, 'playlistItems', params, apiKey)
    return {
      type: 'channelUploads',
      channelId: identifier,
      playlistId,
      url: built.url,
      params,
    }
  }

  if (identifier.startsWith('@')) {
    const params: Record<string, string> = {
      part: 'id',
      forHandle: identifier,
    }
    const built = buildUrl(effectiveBase, 'channels', params, apiKey)
    return {
      type: 'resolveHandle',
      handle: identifier,
      url: built.url,
      params,
    }
  }

  if (identifier.startsWith('user:')) {
    const username = identifier.slice('user:'.length)
    const params: Record<string, string> = {
      part: 'id',
      forUsername: username,
    }
    const built = buildUrl(effectiveBase, 'channels', params, apiKey)
    return {
      type: 'resolveUsername',
      username,
      url: built.url,
      params,
    }
  }

  if (identifier.startsWith('c:')) {
    const query = identifier.slice('c:'.length)
    const params: Record<string, string> = {
      part: 'snippet',
      type: 'channel',
      q: query,
      maxResults: '5',
    }
    const built = buildUrl(effectiveBase, 'search', params, apiKey)
    return {
      type: 'searchChannel',
      query,
      url: built.url,
      params,
    }
  }

  // Fallback for any other identifier form
  const params: Record<string, string> = {
    part: 'snippet',
    type: 'channel',
    q: identifier,
    maxResults: '5',
  }
  const built = buildUrl(effectiveBase, 'search', params, apiKey)
  return {
    type: 'searchChannel',
    query: identifier,
    url: built.url,
    params,
  }
}

