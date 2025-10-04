import { z } from 'zod'

export const discoverySourceTypeSchema = z.enum([
  'rss',
  'youtube-channel',
  'youtube-playlist',
  'web-page',
])

export type DiscoverySourceType = z.infer<typeof discoverySourceTypeSchema>

export const discoveryIngestionFailureReasonSchema = z.enum([
  'network_error',
  'http_4xx',
  'http_5xx',
  'youtube_quota',
  'youtube_not_found',
  'timeout',
  'parser_error',
  'unknown_error',
])

export type DiscoveryIngestionFailureReason = z.infer<typeof discoveryIngestionFailureReasonSchema>

export const normalizedDiscoveryItemSchema = z.object({
  externalId: z.string().min(1),
  url: z.string().url(),
  title: z.string().max(300),
  summary: z.string().optional().nullable(),
  publishedAt: z.string().optional().nullable(),
  author: z.string().optional().nullable(),
  thumbnailUrl: z.string().url().optional().nullable(),
  raw: z.unknown().optional(),
})

export type NormalizedDiscoveryItem = z.infer<typeof normalizedDiscoveryItemSchema>

export const createDiscoverySourceInputSchema = z.object({
  clientId: z.string().uuid(),
  url: z.string().min(1, 'URL is required'),
  notes: z.string().max(2000).optional().nullable(),
})

export type CreateDiscoverySourceInput = z.infer<typeof createDiscoverySourceInputSchema>

export type NormalizedDiscoverySource = {
  url: string
  canonicalUrl: string
  sourceType: DiscoverySourceType
  identifier: string
}

const KEYWORD_MAX_LENGTH = 40
const ASCII_PATTERN = /^[\x20-\x7E]+$/

export type NormalizedDiscoveryKeyword = {
  /** Collapsed + trimmed keyword preserving user casing */
  cleaned: string
  /** Lowercase canonical keyword as persisted */
  canonical: string
  /** Duplicate key that merges whitespace + hyphen variants */
  duplicateKey: string
}

function collapseInternalWhitespace(value: string) {
  return value.replace(/\s+/g, ' ')
}

function buildDuplicateKey(canonical: string) {
  return canonical.replace(/[-\s]+/g, ' ').trim()
}

export function normalizeDiscoveryKeyword(raw: string): NormalizedDiscoveryKeyword {
  if (typeof raw !== 'string') {
    throw new Error('Keyword is required')
  }

  const trimmed = raw.trim()
  if (!trimmed) {
    throw new Error('Keyword is required')
  }

  const collapsed = collapseInternalWhitespace(trimmed)
  if (collapsed.length > KEYWORD_MAX_LENGTH) {
    throw new Error(`Keywords must be ${KEYWORD_MAX_LENGTH} characters or fewer`)
  }

  if (!ASCII_PATTERN.test(collapsed)) {
    throw new Error('Keywords must use ASCII characters only')
  }

  const canonical = collapsed.toLowerCase()
  const duplicateKey = buildDuplicateKey(canonical)

  return {
    cleaned: collapsed,
    canonical,
    duplicateKey,
  }
}

export function deriveDiscoveryKeywordDuplicateKey(input: string | NormalizedDiscoveryKeyword) {
  if (typeof input === 'string') {
    return normalizeDiscoveryKeyword(input).duplicateKey
  }
  return buildDuplicateKey(input.canonical)
}

const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:'])

const RSS_PATH_HINTS = [
  '/feed',
  '/feeds',
  '.rss',
  '.xml',
  '.atom',
  '.rdf',
]

function trimTrailingSlash(path: string) {
  if (path === '/') return '/'
  return path.replace(/\/+$/g, '') || '/'
}

function canonicalizeYoutubeIdentifier(pathSegments: string[], search: URLSearchParams) {
  if (search.has('list')) {
    const listId = search.get('list')!.trim()
    if (!listId) return null
    return { type: 'youtube-playlist' as const, identifier: listId }
  }

  if (pathSegments.length === 0) return null
  const [first, second] = pathSegments
  if (first.startsWith('@')) {
    return { type: 'youtube-channel' as const, identifier: first }
  }
  if (first === 'channel' && second) {
    return { type: 'youtube-channel' as const, identifier: second }
  }
  if (first === 'c' && second) {
    return { type: 'youtube-channel' as const, identifier: `c:${second}` }
  }
  if (first === 'user' && second) {
    return { type: 'youtube-channel' as const, identifier: `user:${second}` }
  }
  return null
}

function isLikelyRss(pathname: string, hostname: string) {
  const lowerPath = pathname.toLowerCase()
  if (hostname.startsWith('feeds.')) return true
  return RSS_PATH_HINTS.some((hint) => lowerPath.endsWith(hint) || lowerPath.includes(`${hint}/`))
}

export function normalizeDiscoverySourceUrl(rawUrl: string): NormalizedDiscoverySource {
  const trimmed = rawUrl.trim()
  if (!trimmed) {
    throw new Error('URL is required')
  }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch (err) {
    throw new Error('Enter a valid URL with http:// or https://')
  }
  if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error('Only HTTP(S) URLs are supported')
  }

  parsed.username = ''
  parsed.password = ''

  if ((parsed.protocol === 'http:' && parsed.port === '80') || (parsed.protocol === 'https:' && parsed.port === '443')) {
    parsed.port = ''
  }

  const hostname = parsed.hostname.toLowerCase()
  const pathname = trimTrailingSlash(decodeURIComponent(parsed.pathname || '/'))

  const search = parsed.searchParams
  const isYoutube = /(^|\.)youtube\.com$/.test(hostname) || hostname === 'youtu.be'
  let detected: { type: DiscoverySourceType; identifier: string } | null = null

  if (isYoutube) {
    const segments = pathname.split('/').filter(Boolean)
    detected = canonicalizeYoutubeIdentifier(segments, search)
    if (detected?.type === 'youtube-playlist') {
      // Only keep the list param for canonical playlist URLs
      const listId = detected.identifier
      parsed.search = ''
      parsed.searchParams.set('list', listId)
    } else {
      parsed.search = ''
    }
  } else {
    // Strip tracking parameters for non-YouTube URLs
    const preserved = new URLSearchParams()
    for (const key of search.keys()) {
      const lowerKey = key.toLowerCase()
      if (lowerKey === 'utm') continue
      if (lowerKey.startsWith('utm_')) continue
      if (lowerKey === 'fbclid') continue
      preserved.set(key, search.get(key)!)
    }
    parsed.search = preserved.toString() ? `?${preserved.toString()}` : ''
  }

  const canonicalHost = hostname
  const canonicalPath = pathname
  const canonicalSearch = parsed.search
  parsed.hostname = canonicalHost
  parsed.pathname = canonicalPath
  const canonicalUrl = `${parsed.protocol}//${canonicalHost}${canonicalPath}${canonicalSearch}`

  if (detected) {
    return {
      url: parsed.toString(),
      canonicalUrl,
      sourceType: detected.type,
      identifier: detected.identifier,
    }
  }

  if (isLikelyRss(pathname, canonicalHost)) {
    return {
      url: parsed.toString(),
      canonicalUrl,
      sourceType: 'rss',
      identifier: canonicalUrl,
    }
  }

  return {
    url: parsed.toString(),
    canonicalUrl,
    sourceType: 'web-page',
    identifier: `${canonicalHost}${canonicalPath}${canonicalSearch}`,
  }
}

export function deriveDuplicateKey(ns: NormalizedDiscoverySource) {
  return `${ns.sourceType}::${ns.identifier.toLowerCase()}`
}
