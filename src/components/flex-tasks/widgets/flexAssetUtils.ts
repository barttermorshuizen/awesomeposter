function toTrimmed(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function extractMetaString(
  meta: Record<string, unknown> | null,
  keys: string[]
): string | null {
  if (!meta) return null
  for (const key of keys) {
    const candidate = toTrimmed(meta[key as keyof typeof meta])
    if (candidate) return candidate
  }
  return null
}

function extractAssetIdFromUrl(url: string | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    const segments = parsed.pathname.split('/').filter(Boolean)
    if (!segments.length) return null
    const last = segments[segments.length - 1] ?? ''
    const dotIndex = last.indexOf('.')
    const candidate = dotIndex >= 0 ? last.slice(0, dotIndex) : last
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (uuidRegex.test(candidate)) {
      return candidate
    }
    return null
  } catch {
    return null
  }
}

export interface FlexAssetDescriptor {
  assetId?: string | null
  url?: string | null
  meta?: Record<string, unknown> | null
}

export interface FlexAssetResolution {
  assetId: string | null
  url: string
}

export function resolveFlexAssetSource(descriptor: FlexAssetDescriptor): FlexAssetResolution {
  const meta = descriptor.meta ?? null
  const candidateAssetId =
    toTrimmed(descriptor.assetId) ??
    extractMetaString(meta, ['assetId', 'asset_id', 'id']) ??
    null

  const previewCandidate = extractMetaString(meta, [
    'previewUrl',
    'preview_url',
    'thumbnailUrl',
    'thumbnail_url'
  ])

  const directCandidateUrls = [
    toTrimmed(descriptor.url),
    extractMetaString(meta, ['url', 'href', 'sourceUrl', 'source_url'])
  ].filter((entry): entry is string => Boolean(entry))

  if (candidateAssetId) {
    return {
      assetId: candidateAssetId,
      url: `/api/flex/assets/${encodeURIComponent(candidateAssetId)}/download`
    }
  }

  if (previewCandidate) {
    return {
      assetId: null,
      url: previewCandidate
    }
  }

  const fallbackUrl = directCandidateUrls.find(Boolean) ?? ''
  const derivedAssetId = extractAssetIdFromUrl(fallbackUrl)
  if (derivedAssetId) {
    return {
      assetId: derivedAssetId,
      url: `/api/flex/assets/${encodeURIComponent(derivedAssetId)}/download`
    }
  }

  return {
    assetId: null,
    url: fallbackUrl
  }
}
