import type {
  DiscoverySourceType,
  NormalizedDiscoveryAdapterItem,
  DiscoverySourceMetadata,
  DiscoveryIngestionFailureReason,
} from '../discovery.js'
import { discoverySourceTypeSchema } from '../discovery.js'
import type { DiscoverySourceConfig } from './config.js'
import { fetchHttpSource } from './adapters/http.js'
import { fetchRssSource } from './adapters/rss.js'
import { fetchYoutubeSource } from './adapters/youtube.js'

export type DiscoveryIngestionAdapterContext = {
  fetch?: typeof globalThis.fetch
  signal?: AbortSignal
  now?: () => Date
  youtubeApiKey?: string
  youtubeApiBaseUrl?: string
  youtubeMaxResults?: number
}

export type DiscoveryIngestionAdapterInput = {
  sourceId: string
  clientId: string
  sourceType: DiscoverySourceType
  url: string
  canonicalUrl: string
  config: DiscoverySourceConfig | null
}

export type NormalizedDiscoveryItemEnvelope = {
  rawPayload: unknown
  normalized: NormalizedDiscoveryAdapterItem
  sourceMetadata: DiscoverySourceMetadata
}

export type DiscoveryAdapterSuccess = {
  ok: true
  items: NormalizedDiscoveryItemEnvelope[]
  raw?: unknown
  metadata?: Record<string, unknown>
}

export type DiscoveryAdapterFailure = {
  ok: false
  failureReason: DiscoveryIngestionFailureReason
  retryInMinutes?: number | null
  error?: Error
  raw?: unknown
  metadata?: Record<string, unknown>
}

export type DiscoveryAdapterResult = DiscoveryAdapterSuccess | DiscoveryAdapterFailure

export type DiscoveryIngestionAdapter = (
  input: DiscoveryIngestionAdapterInput,
  context?: DiscoveryIngestionAdapterContext,
) => Promise<DiscoveryAdapterResult>

const ADAPTERS: Record<DiscoverySourceType, DiscoveryIngestionAdapter> = {
  'web-page': fetchHttpSource,
  rss: fetchRssSource,
  'youtube-channel': fetchYoutubeSource,
  'youtube-playlist': fetchYoutubeSource,
}

export function getIngestionAdapter(type: DiscoverySourceType): DiscoveryIngestionAdapter {
  const adapter = ADAPTERS[type]
  if (!adapter) {
    throw new Error(`No ingestion adapter registered for type ${type}`)
  }
  return adapter
}

export function assertValidSourceType(type: string): asserts type is DiscoverySourceType {
  discoverySourceTypeSchema.parse(type)
}

export async function executeIngestionAdapter(
  input: DiscoveryIngestionAdapterInput,
  context?: DiscoveryIngestionAdapterContext,
): Promise<DiscoveryAdapterResult> {
  const adapter = getIngestionAdapter(input.sourceType)
  return adapter(input, context)
}
