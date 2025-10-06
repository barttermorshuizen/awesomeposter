import type {
  DiscoveryIngestionFailureReason,
  DiscoverySourceType,
} from '@awesomeposter/shared'
import { emitDiscoveryEvent } from './discovery-events'

export type SourceHealthStatus = 'healthy' | 'warning' | 'error'

export type PublishSourceHealthStatusInput = {
  clientId: string
  sourceId: string
  sourceType: DiscoverySourceType
  status: SourceHealthStatus
  lastFetchedAt?: Date | string | null
  failureReason?: DiscoveryIngestionFailureReason | null
  observedAt?: Date | string
  consecutiveFailures?: number
  attempt?: number
  staleSince?: Date | string | null
}

function normalizeTimestamp(value: Date | string | null | undefined): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

export function publishSourceHealthStatus(input: PublishSourceHealthStatusInput) {
  const observedAtIso = normalizeTimestamp(input.observedAt) ?? new Date().toISOString()
  const lastFetchedAtIso = normalizeTimestamp(input.lastFetchedAt)
  const staleSinceIso = normalizeTimestamp(input.staleSince)

  emitDiscoveryEvent({
    type: 'source.health',
    version: 1,
    payload: {
      clientId: input.clientId,
      sourceId: input.sourceId,
      sourceType: input.sourceType,
      status: input.status,
      lastFetchedAt: lastFetchedAtIso,
      observedAt: observedAtIso,
      ...(input.failureReason ? { failureReason: input.failureReason } : {}),
      ...(typeof input.consecutiveFailures === 'number'
        ? { consecutiveFailures: input.consecutiveFailures }
        : {}),
      ...(typeof input.attempt === 'number' ? { attempt: input.attempt } : {}),
      ...(staleSinceIso ? { staleSince: staleSinceIso } : {}),
    },
  })
}
