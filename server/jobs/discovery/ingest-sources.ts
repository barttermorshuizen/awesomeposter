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
import { publishSourceHealthStatus } from '../../utils/discovery-health'

const DEFAULT_WORKER_LIMIT = 3
const MAX_BATCH_MULTIPLIER = 4
const EVENT_VERSION = 1
const DEFAULT_MAX_RETRY_ATTEMPTS = 3
const DEFAULT_MAX_RETRY_DELAY_MINUTES = 15
const BASE_RETRY_DELAY_MINUTES = 1

type IngestionRunnerOptions = {
  now: () => Date
  fetch?: typeof globalThis.fetch
}

type RetryClassification = {
  retryable: boolean
  delayMinutes: number | null
  reason: 'transient' | 'permanent' | 'exhausted' | 'none'
  fromRetryAfterHeader?: boolean
}

type AttemptTelemetry = {
  attempt: number
  startedAt: string
  completedAt: string
  success: boolean
  failureReason?: DiscoveryIngestionFailureReason
  retryInMinutes?: number | null
  nextRetryAt?: string | null
  retryReason?: RetryClassification['reason']
  retryAfterOverride?: boolean
  durationMs: number
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

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  { min = 1, max = Number.POSITIVE_INFINITY }: { min?: number; max?: number } = {},
): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  if (Number.isFinite(parsed) && parsed >= min && parsed <= max) {
    return parsed
  }
  return fallback
}

function resolveMaxAttempts(): number {
  return parsePositiveInt(process.env.INGESTION_RETRY_MAX_ATTEMPTS, DEFAULT_MAX_RETRY_ATTEMPTS, { min: 1, max: 10 })
}

function resolveMaxRetryDelayMinutes(): number {
  return parsePositiveInt(process.env.INGESTION_RETRY_MAX_DELAY_MINUTES, DEFAULT_MAX_RETRY_DELAY_MINUTES, {
    min: BASE_RETRY_DELAY_MINUTES,
    max: 60,
  })
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

function toSafeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function extractStatusCode(result: DiscoveryAdapterResult): number | null {
  const status = toSafeNumber(result.metadata?.status)
  if (status !== null) return Math.trunc(status)
  const rawStatus = (result.raw as { status?: unknown } | undefined)?.status
  const coerced = toSafeNumber(rawStatus)
  return coerced !== null ? Math.trunc(coerced) : null
}

function extractRetryAfterMinutes(result: DiscoveryAdapterResult, now: Date): number | null {
  const rawHeaders = (result.raw as { headers?: unknown } | undefined)?.headers
  if (!rawHeaders || typeof rawHeaders !== 'object') return null
  const headerEntries = Object.entries(rawHeaders as Record<string, unknown>)
  const header = headerEntries.find(([key]) => key.toLowerCase() === 'retry-after')
  if (!header) return null
  const [, value] = header
  if (typeof value === 'number') {
    return Math.max(0, Math.ceil(value / 60))
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const numeric = Number.parseInt(trimmed, 10)
    if (Number.isFinite(numeric)) {
      return Math.max(0, Math.ceil(numeric / 60))
    }
    const parsedDate = new Date(trimmed)
    if (!Number.isNaN(parsedDate.getTime())) {
      const diffMs = parsedDate.getTime() - now.getTime()
      if (diffMs <= 0) return 0
      return Math.max(0, Math.ceil(diffMs / 60_000))
    }
  }
  return null
}

function classifyFailure(
  result: DiscoveryAdapterResult,
  attempt: number,
  maxAttempts: number,
  now: Date,
): RetryClassification {
  const failureReason = result.ok ? null : result.failureReason
  if (!failureReason) {
    return { retryable: false, delayMinutes: null, reason: 'none' }
  }

  const status = extractStatusCode(result)
  const maxDelay = resolveMaxRetryDelayMinutes()
  const suggestedRetry = typeof result.retryInMinutes === 'number' && Number.isFinite(result.retryInMinutes)
    ? result.retryInMinutes
    : null
  const retryAfter = extractRetryAfterMinutes(result, now)
  const baseDelay = Math.min(Math.pow(2, Math.max(0, attempt - 1)) * BASE_RETRY_DELAY_MINUTES, maxDelay)

  const computeDelay = () => {
    const overrides: Array<number | null> = [baseDelay]
    overrides.push(suggestedRetry)
    if (retryAfter !== null) overrides.push(retryAfter)
    const filtered = overrides.filter((value): value is number => typeof value === 'number' && value >= 0)
    if (filtered.length === 0) return baseDelay
    const delay = Math.min(maxDelay, Math.max(...filtered))
    return Math.max(BASE_RETRY_DELAY_MINUTES, delay)
  }

  const retryableFailureReasons: DiscoveryIngestionFailureReason[] = [
    'network_error',
    'timeout',
    'http_5xx',
    'youtube_quota',
  ]

  const isRetryableReason = retryableFailureReasons.includes(failureReason)
    || (failureReason === 'http_4xx' && status === 429)

  if (!isRetryableReason) {
    return { retryable: false, delayMinutes: null, reason: 'permanent' }
  }

  if (attempt >= maxAttempts) {
    const delay = computeDelay()
    return {
      retryable: false,
      delayMinutes: delay,
      reason: 'exhausted',
      fromRetryAfterHeader: retryAfter !== null,
    }
  }

  const delay = computeDelay()
  return {
    retryable: true,
    delayMinutes: delay,
    reason: 'transient',
    fromRetryAfterHeader: retryAfter !== null,
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

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
  let nextRetryAt: Date | null = null
  let adapterResult: DiscoveryAdapterResult | null = null
  const attempts: AttemptTelemetry[] = []
  const maxAttempts = resolveMaxAttempts()
  let permanentFailureNotice: { failureReason: DiscoveryIngestionFailureReason; attempt: number } | null = null

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const attemptStartedAt = options.now()
      let result: DiscoveryAdapterResult
      try {
        result = await executeIngestionAdapter(
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
      } catch (error) {
        const derivedFailure = resolveFailureReason((error as Error)?.cause ?? null)
        result = {
          ok: false,
          failureReason: derivedFailure,
          error: error as Error,
          retryInMinutes: null,
          metadata: { adapter: 'unknown' },
        }
      }

      adapterResult = result
      const attemptCompletedAt = options.now()
      const attemptDurationMs = Math.max(0, attemptCompletedAt.getTime() - attemptStartedAt.getTime())

      if (result.ok) {
        success = true
        failureReason = null
        retryInMinutes = null
        nextRetryAt = null
        attempts.push({
          attempt,
          startedAt: attemptStartedAt.toISOString(),
          completedAt: attemptCompletedAt.toISOString(),
          durationMs: attemptDurationMs,
          success: true,
          retryInMinutes: null,
          nextRetryAt: null,
        })
        break
      }

      failureReason = result.failureReason

      const classification = classifyFailure(result, attempt, maxAttempts, attemptCompletedAt)
      retryInMinutes = classification.delayMinutes ?? null
      nextRetryAt = retryInMinutes != null ? new Date(attemptCompletedAt.getTime() + retryInMinutes * 60_000) : null

      attempts.push({
        attempt,
        startedAt: attemptStartedAt.toISOString(),
        completedAt: attemptCompletedAt.toISOString(),
        durationMs: attemptDurationMs,
        success: false,
        failureReason,
        retryInMinutes,
        nextRetryAt: nextRetryAt ? nextRetryAt.toISOString() : null,
        retryReason: classification.reason,
        retryAfterOverride: classification.fromRetryAfterHeader ?? false,
      })

      if (!classification.retryable) {
        if (classification.reason === 'permanent') {
          permanentFailureNotice = {
            failureReason,
            attempt,
          }
        }
        break
      }

      if (retryInMinutes && retryInMinutes > 0) {
        await sleep(retryInMinutes * 60_000)
      }
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
          attempts,
          attemptCount: attempts.length,
          maxAttempts,
          nextRetryAt: nextRetryAt ? nextRetryAt.toISOString() : null,
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
        attempt: attempts.length,
        maxAttempts,
        attempts,
        nextRetryAt: nextRetryAt ? nextRetryAt.toISOString() : undefined,
      },
    })

    if (!success) {
      emitDiscoveryEventSafely({
        type: 'ingestion.failed',
        version: EVENT_VERSION,
        payload: {
          runId,
          clientId: claimed.clientId,
          sourceId: claimed.id,
          sourceType: claimed.sourceType,
          failureReason: failureReason ?? 'unknown_error',
          attempt: attempts.length,
          maxAttempts,
          retryInMinutes: retryInMinutes ?? undefined,
          nextRetryAt: nextRetryAt ? nextRetryAt.toISOString() : undefined,
        },
      })

      if (permanentFailureNotice) {
        publishSourceHealthStatus({
          clientId: claimed.clientId,
          sourceId: claimed.id,
          sourceType: claimed.sourceType,
          status: 'error',
          lastFetchedAt: completedAt,
          observedAt: completedAt,
          failureReason: permanentFailureNotice.failureReason,
          attempt: permanentFailureNotice.attempt,
        })
      }
    }
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
