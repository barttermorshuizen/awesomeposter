import { defineTask } from 'nitropack/runtime'
import {
  markStaleDiscoverySources,
  type MarkedStaleDiscoverySource,
} from '../../utils/discovery-repository'
import { publishSourceHealthStatus } from '../../utils/discovery-health'

const DEFAULT_WARNING_THRESHOLD_HOURS = 24

function resolveWarningThresholdHours(): number {
  const raw = process.env.DISCOVERY_STALE_WARNING_HOURS
  if (!raw) {
    return DEFAULT_WARNING_THRESHOLD_HOURS
  }
  const parsed = Number.parseInt(raw, 10)
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed
  }
  return DEFAULT_WARNING_THRESHOLD_HOURS
}

export async function runMarkStaleDiscoverySourcesJob(now = new Date()) {
  const thresholdHours = resolveWarningThresholdHours()
  const cutoff = new Date(now.getTime() - thresholdHours * 60 * 60 * 1000)

  let updates: MarkedStaleDiscoverySource[] = []
  try {
    updates = await markStaleDiscoverySources(cutoff, now)
  } catch (error) {
    console.error('[discovery.mark-stale] failed to evaluate stale sources', {
      error,
    })
    throw error
  }

  for (const { clientId, sourceId, sourceType, health } of updates) {
    const {
      status,
      observedAt,
      lastFetchedAt,
      consecutiveFailures,
      failureReason,
      staleSince,
    } = health

    publishSourceHealthStatus({
      clientId,
      sourceId,
      sourceType,
      status,
      observedAt,
      lastFetchedAt: lastFetchedAt ?? null,
      failureReason: failureReason ?? undefined,
      consecutiveFailures,
      staleSince: staleSince ?? null,
    })
  }

  return {
    updated: updates.length,
    thresholdHours,
  }
}

export default defineTask({
  meta: {
    name: 'discovery-mark-stale-sources',
    description: 'Mark discovery sources as warning when no fetch has succeeded in the threshold window',
  },
  async run() {
    const result = await runMarkStaleDiscoverySourcesJob()
    return result
  },
})
