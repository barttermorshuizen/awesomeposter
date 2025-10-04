import { randomUUID } from 'node:crypto'
import { defineTask } from 'nitropack/runtime'
import type { DiscoveryAdapterResult } from '@awesomeposter/shared'
import {
  executeIngestionAdapter,
  discoveryIngestionFailureReasonSchema,
  type DiscoveryIngestionFailureReason,
} from '@awesomeposter/shared'
import {
  listDiscoverySourcesDue,
  claimDiscoverySourceForFetch,
  completeDiscoverySourceFetch,
  releaseDiscoverySourceAfterFailedCompletion,
  type DiscoverySourceWithCadence,
} from '../../utils/discovery-repository'
import { emitDiscoveryEvent } from '../../utils/discovery-events'

const DEFAULT_WORKER_LIMIT = 3
const MAX_BATCH_MULTIPLIER = 4
const EVENT_VERSION = 1

type IngestionRunnerOptions = {
  now: () => Date
  fetch?: typeof globalThis.fetch
}

export type DiscoveryIngestionJobOptions = {
  now?: () => Date
  workerLimit?: number
  fetch?: typeof globalThis.fetch
  batchSize?: number
}

export type DiscoveryIngestionJobResult = {
  totalDue: number
  processed: number
  succeeded: number
  failed: number
  skipped: number
}

function parseWorkerLimit(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed
  }
  return DEFAULT_WORKER_LIMIT
}

function resolveFailureReason(raw: unknown): DiscoveryIngestionFailureReason {
  if (typeof raw === 'string') {
    const result = discoveryIngestionFailureReasonSchema.safeParse(raw)
    if (result.success) return result.data
  }
  return 'unknown_error'
}

function coerceTimestamp(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function emitDiscoveryEventSafely(event: Parameters<typeof emitDiscoveryEvent>[0]) {
  try {
    emitDiscoveryEvent(event)
  } catch (error) {
    console.error('[discovery.ingest] failed to emit discovery event', {
      type: event.type,
      sourceId: 'payload' in event ? (event as { payload?: { sourceId?: string } }).payload?.sourceId : undefined,
      error,
    })
  }
}

function buildAdapterTelemetry(result: DiscoveryAdapterResult) {
  if (result.ok) {
    return {
      adapter: result.metadata?.adapter ?? 'unknown',
      itemsFetched: result.items.length,
      metadata: result.metadata ?? null,
    }
  }

  return {
    adapter: result.metadata?.adapter ?? 'unknown',
    metadata: result.metadata ?? null,
    error: {
      message: result.error?.message ?? null,
      name: result.error?.name ?? null,
    },
  }
}

async function processSource(
  source: DiscoverySourceWithCadence,
  options: IngestionRunnerOptions,
  stats: DiscoveryIngestionJobResult,
): Promise<void> {
  const claimed = await claimDiscoverySourceForFetch(source.id, options.now())
  if (!claimed) {
    stats.skipped += 1
    return
  }

  const runId = randomUUID()
  const startedAt = options.now()
  const scheduledAt = coerceTimestamp(source.nextFetchAt) ?? startedAt

  emitDiscoveryEventSafely({
    type: 'ingestion.started',
    version: EVENT_VERSION,
    payload: {
      runId,
      clientId: claimed.clientId,
      sourceId: claimed.id,
      sourceType: claimed.sourceType,
      scheduledAt: scheduledAt.toISOString(),
      startedAt: startedAt.toISOString(),
    },
  })

  let success = false
  let failureReason: DiscoveryIngestionFailureReason | null = null
  let retryInMinutes: number | null = null
  let adapterResult: DiscoveryAdapterResult | null = null

  try {
    adapterResult = await executeIngestionAdapter(
      {
        sourceId: claimed.id,
        clientId: claimed.clientId,
        sourceType: claimed.sourceType,
        url: claimed.url,
        canonicalUrl: claimed.canonicalUrl,
        config: claimed.configJson ?? null,
      },
      { fetch: options.fetch, now: options.now },
    )

    if (adapterResult.ok) {
      success = true
    } else {
      success = false
      failureReason = adapterResult.failureReason
      retryInMinutes = adapterResult.retryInMinutes ?? null
    }
  } catch (error) {
    success = false
    failureReason = resolveFailureReason((error as Error)?.cause ?? null)
    adapterResult = {
      ok: false,
      failureReason,
      error: error as Error,
      retryInMinutes: null,
      metadata: { adapter: 'unknown' },
    }
  } finally {
    if (!success && !failureReason) {
      failureReason = 'unknown_error'
    }

    const completedAt = options.now()
    const durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime())

    try {
      await completeDiscoverySourceFetch({
        runId,
        sourceId: claimed.id,
        clientId: claimed.clientId,
        startedAt,
        completedAt,
        fetchIntervalMinutes: claimed.fetchIntervalMinutes,
        success,
        failureReason,
        retryInMinutes,
        telemetry: {
          durationMs,
          ...(adapterResult ? buildAdapterTelemetry(adapterResult) : {}),
        },
      })
    } catch (error) {
      console.error('[discovery.ingest] failed to persist completion', {
        sourceId: claimed.id,
        runId,
        error,
      })
      try {
        await releaseDiscoverySourceAfterFailedCompletion({
          sourceId: claimed.id,
          completedAt,
          fetchIntervalMinutes: claimed.fetchIntervalMinutes,
          success,
          failureReason,
          retryInMinutes,
        })
      } catch (fallbackError) {
        console.error('[discovery.ingest] failed to reset source after completion error', {
          sourceId: claimed.id,
          runId,
          error: fallbackError,
        })
      }
    }

    emitDiscoveryEventSafely({
      type: 'ingestion.completed',
      version: EVENT_VERSION,
      payload: {
        runId,
        clientId: claimed.clientId,
        sourceId: claimed.id,
        sourceType: claimed.sourceType,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs,
        success,
        failureReason: failureReason ?? undefined,
        retryInMinutes: retryInMinutes ?? undefined,
      },
    })
  }

  if (success) {
    stats.succeeded += 1
  } else {
    stats.failed += 1
  }
}

export async function runDiscoveryIngestionJob(
  opts: DiscoveryIngestionJobOptions = {},
): Promise<DiscoveryIngestionJobResult> {
  const nowFn = opts.now ?? (() => new Date())
  const workerLimit = opts.workerLimit ?? parseWorkerLimit(process.env.DISCOVERY_INGEST_WORKERS)
  const fetchImpl = opts.fetch ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch : undefined)
  const batchSize = opts.batchSize ?? Math.max(workerLimit * MAX_BATCH_MULTIPLIER, workerLimit)

  const dueSources = await listDiscoverySourcesDue(batchSize, nowFn())

  const stats: DiscoveryIngestionJobResult = {
    totalDue: dueSources.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
  }

  if (dueSources.length === 0) {
    return stats
  }

  const runnerOptions: IngestionRunnerOptions = {
    now: nowFn,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  }

  const queue: DiscoverySourceWithCadence[] = [...dueSources]
  const active = new Set<Promise<void>>()

  const launch = (source: DiscoverySourceWithCadence) => {
    const task = (async () => {
      stats.processed += 1
      await processSource(source, runnerOptions, stats)
    })().catch((error) => {
      console.error('[discovery.ingest] failed to process source', {
        sourceId: source.id,
        error,
      })
      stats.failed += 1
    })

    const tracked = task.finally(() => {
      active.delete(tracked)
    })
    active.add(tracked)
  }

  const refill = () => {
    while (active.size < workerLimit && queue.length > 0) {
      const next = queue.shift()!
      launch(next)
    }
  }

  refill()

  while (active.size > 0) {
    await Promise.race(active)
    refill()
  }

  return stats
}

export default defineTask({
  meta: {
    name: 'discovery-ingestion',
    description: 'Fetch discovery sources on cadence',
  },
  async run() {
    const result = await runDiscoveryIngestionJob()
    return { result }
  },
})
