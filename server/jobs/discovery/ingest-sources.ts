import { randomUUID } from 'node:crypto'
import { defineTask } from 'nitropack/runtime'
import type { DiscoveryAdapterResult } from '@awesomeposter/shared'
import {
  executeIngestionAdapter,
  discoveryIngestionFailureReasonSchema,
  FEATURE_DISCOVERY_AGENT,
  type DiscoveryIngestionFailureReason,
} from '@awesomeposter/shared'
import {
  listDiscoverySourcesDue,
  claimDiscoverySourceForFetch,
  completeDiscoverySourceFetch,
  releaseDiscoverySourceAfterFailedCompletion,
  saveDiscoveryItems,
  persistDiscoveryScores,
  resetDiscoveryItemsToPending,
  countPendingDiscoveryItemsForClient,
  type DiscoverySourceWithCadence,
  type DiscoverySourceHealthUpdate,
} from '../../utils/discovery-repository'
import { emitDiscoveryEvent } from '../../utils/discovery-events'
import { publishSourceHealthStatus } from '../../utils/discovery-health'
import { isFeatureEnabled } from '../../utils/client-config/feature-flags'
import {
  scoreDiscoveryItems,
  type ScoreDiscoveryError,
  type ScoreDiscoveryItemsSuccess,
} from '../../utils/discovery/scoring'

const DEFAULT_WORKER_LIMIT = 3
const MAX_BATCH_MULTIPLIER = 4
const EVENT_VERSION = 1
const DEFAULT_MAX_RETRY_ATTEMPTS = 3
const DEFAULT_MAX_RETRY_DELAY_MINUTES = 15
const BASE_RETRY_DELAY_MINUTES = 1
const YOUTUBE_MAX_RESULTS_CAP = 50
const DEFAULT_SCORING_PENDING_THRESHOLD = 500
const SCORING_EVENT_VERSION = 1

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

type InlineScoringMetrics = {
  attempted: boolean
  durationMs?: number
  pendingBefore?: number
  pendingAfter?: number
  scoredCount?: number
  suppressedCount?: number
  skippedReason?: 'no_new_items' | 'feature_disabled' | 'backlog' | 'error'
  errorCode?: string
  errorMessage?: string
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

function resolveYoutubeMaxResults(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return undefined
  const clamped = Math.min(Math.max(parsed, 1), YOUTUBE_MAX_RESULTS_CAP)
  return clamped
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

let cachedScoringPendingThreshold: number | null = null

function resolveScoringPendingThreshold(): number {
  if (cachedScoringPendingThreshold !== null) {
    return cachedScoringPendingThreshold
  }

  const raw = Number.parseInt(process.env.DISCOVERY_SCORING_PENDING_THRESHOLD ?? '', 10)
  if (Number.isFinite(raw) && raw >= 0) {
    cachedScoringPendingThreshold = raw === 0 ? Number.POSITIVE_INFINITY : Math.min(Math.max(raw, 1), 100_000)
    return cachedScoringPendingThreshold
  }

  cachedScoringPendingThreshold = DEFAULT_SCORING_PENDING_THRESHOLD
  return cachedScoringPendingThreshold
}

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY ?? undefined
const YOUTUBE_API_BASE_URL = process.env.YOUTUBE_DATA_API_BASE_URL ?? undefined
const YOUTUBE_API_MAX_RESULTS = resolveYoutubeMaxResults(process.env.YOUTUBE_API_MAX_RESULTS)

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

function extractItemIdsFromError(error: ScoreDiscoveryError['error']): string[] {
  const { details } = error
  if (!details || typeof details !== 'object') {
    return []
  }

  const fromItemIds = Array.isArray((details as { itemIds?: unknown }).itemIds)
    ? ((details as { itemIds: unknown[] }).itemIds)
        .map((value) => (typeof value === 'string' ? value : null))
        .filter((value): value is string => Boolean(value))
    : []

  if (fromItemIds.length) {
    return fromItemIds
  }

  const invalidItems = Array.isArray((details as { invalidItems?: unknown }).invalidItems)
    ? ((details as { invalidItems: Array<{ itemId?: unknown }> }).invalidItems)
    : []

  if (invalidItems.length) {
    const collected = invalidItems
      .map((entry) => (typeof entry.itemId === 'string' ? entry.itemId : null))
      .filter((value): value is string => Boolean(value))
    return collected
  }

  return []
}

async function runInlineScoring({
  clientId,
  sourceId,
  itemIds,
  now,
}: {
  clientId: string
  sourceId: string
  itemIds: string[]
  now: () => Date
}): Promise<InlineScoringMetrics> {
  if (itemIds.length === 0) {
    return { attempted: false, skippedReason: 'no_new_items' }
  }

  const metrics: InlineScoringMetrics = { attempted: false }
  const threshold = resolveScoringPendingThreshold()

  try {
    const enabled = await isFeatureEnabled(clientId, FEATURE_DISCOVERY_AGENT)
    if (!enabled) {
      metrics.skippedReason = 'feature_disabled'
      console.info('[discovery.ingest] inline scoring skipped; feature disabled', { clientId, sourceId })
      return metrics
    }

    const pendingBefore = await countPendingDiscoveryItemsForClient(clientId)
    metrics.pendingBefore = pendingBefore

    if (pendingBefore > threshold) {
      metrics.skippedReason = 'backlog'
      console.warn('[discovery.ingest] inline scoring deferred due to backlog', {
        clientId,
        sourceId,
        pending: pendingBefore,
        threshold,
      })
      emitDiscoveryEventSafely({
        type: 'discovery.queue.updated',
        version: SCORING_EVENT_VERSION,
        payload: {
          clientId,
          pendingCount: pendingBefore,
          updatedAt: now().toISOString(),
          reason: 'backlog',
        },
      })
      return metrics
    }

    metrics.attempted = true
    const scoringStart = now()
    const response = await scoreDiscoveryItems(itemIds, { now })
    const scoringEnd = now()
    metrics.durationMs = Math.max(0, scoringEnd.getTime() - scoringStart.getTime())

    if (!response.ok) {
      metrics.skippedReason = 'error'
      metrics.errorCode = response.error.code
      metrics.errorMessage = response.error.message
      const failedIds = extractItemIdsFromError(response.error)
      const resetIds = failedIds.length ? failedIds : itemIds
      await resetDiscoveryItemsToPending(resetIds)
      emitDiscoveryEventSafely({
        type: 'discovery.scoring.failed',
        version: SCORING_EVENT_VERSION,
        payload: {
          clientId,
          itemIds: resetIds,
          errorCode: response.error.code,
          errorMessage: response.error.message,
          details: response.error.details ?? undefined,
          occurredAt: scoringEnd.toISOString(),
        },
      })
      console.error('[discovery.ingest] inline scoring failed', {
        clientId,
        sourceId,
        error: response.error,
      })
      return metrics
    }

    metrics.scoredCount = response.results.filter((result) => result.status === 'scored').length
    metrics.suppressedCount = response.results.filter((result) => result.status === 'suppressed').length

    const scoredAt = now()
    const scoredAtIso = scoredAt.toISOString()

    await persistDiscoveryScores(
      response.results.map((result) => ({
        itemId: result.itemId,
        clientId: result.clientId,
        sourceId: result.sourceId,
        score: result.score,
        keywordScore: result.components.keyword,
        recencyScore: result.components.recency,
        sourceScore: result.components.source,
        appliedThreshold: result.appliedThreshold,
        status: result.status,
        weightsVersion: result.weightsVersion,
        components: result.components,
        metadata: {
          configSnapshot: response.config,
          topics: result.matchedKeywords,
        },
        scoredAt,
      })),
    )

    const pendingAfter = await countPendingDiscoveryItemsForClient(clientId)
    metrics.pendingAfter = pendingAfter

    for (const result of response.results) {
      emitDiscoveryEventSafely({
        type: 'discovery.score.complete',
        version: SCORING_EVENT_VERSION,
        payload: {
          clientId: result.clientId,
          itemId: result.itemId,
          sourceId: result.sourceId,
          score: result.score,
          status: result.status,
          components: result.components,
          appliedThreshold: result.appliedThreshold,
          weightsVersion: result.weightsVersion,
          scoredAt: scoredAtIso,
        },
      })
    }

    emitDiscoveryEventSafely({
      type: 'discovery.queue.updated',
      version: SCORING_EVENT_VERSION,
      payload: {
        clientId,
        pendingCount: pendingAfter,
        scoredDelta: metrics.scoredCount ?? 0,
        suppressedDelta: metrics.suppressedCount ?? 0,
        updatedAt: scoredAtIso,
        reason: 'scoring',
      },
    })
  } catch (error) {
    metrics.skippedReason = 'error'
    metrics.errorMessage = (error as Error).message
    console.error('[discovery.ingest] inline scoring encountered unexpected error', {
      clientId,
      sourceId,
      error,
    })
  }

  return metrics
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
  let nextRetryAt: Date | null = null
  let adapterResult: DiscoveryAdapterResult | null = null
  const attempts: AttemptTelemetry[] = []
  const maxAttempts = resolveMaxAttempts()
  let permanentFailureNotice: { failureReason: DiscoveryIngestionFailureReason; attempt: number } | null = null
  const runMetrics: Record<string, unknown> = {}
  const ingestionIssues: Array<{ reason: string; count: number; details?: unknown }> = []
  let healthUpdate: DiscoverySourceHealthUpdate | null = null

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
          {
            fetch: options.fetch,
            now: options.now,
            youtubeApiKey: YOUTUBE_API_KEY,
            youtubeApiBaseUrl: YOUTUBE_API_BASE_URL,
            youtubeMaxResults: YOUTUBE_API_MAX_RESULTS,
          },
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
      const adapterName = typeof result.metadata?.adapter === 'string' ? result.metadata!.adapter : runMetrics.adapter ?? 'unknown'
      runMetrics.adapter = adapterName

      if (result.ok) {
        const metadata = result.metadata ?? {}
        const skippedDetails = Array.isArray((metadata as { skipped?: unknown[] }).skipped)
          ? ((metadata as { skipped: unknown[] }).skipped)
          : []
        if (typeof (metadata as { entryCount?: number }).entryCount === 'number') {
          runMetrics.entryCount = (metadata as { entryCount: number }).entryCount
        }
        if (typeof (metadata as { totalItems?: number }).totalItems === 'number') {
          runMetrics.totalItems = (metadata as { totalItems: number }).totalItems
        }
        runMetrics.normalizedCount = result.items.length
        runMetrics.skippedCount = skippedDetails.length

        if (skippedDetails.length) {
          ingestionIssues.push({
            reason: 'adapter_skipped',
            count: skippedDetails.length,
            details: skippedDetails,
          })
        }

        let persistence: Awaited<ReturnType<typeof saveDiscoveryItems>> | null = null
        try {
          persistence = await saveDiscoveryItems({
            clientId: claimed.clientId,
            sourceId: claimed.id,
            items: result.items.map((item) => ({
              normalized: item.normalized,
              rawPayload: item.rawPayload,
              sourceMetadata: item.sourceMetadata,
            })),
          })
        } catch (persistError) {
          result = {
            ok: false,
            failureReason: 'unknown_error',
            error: persistError as Error,
            metadata: {
              adapter: adapterName,
            },
          }
          adapterResult = result
        }

        if (result.ok && persistence) {
          runMetrics.insertedCount = persistence.inserted.length
          runMetrics.duplicateCount = persistence.duplicates.length
          if (persistence.duplicates.length) {
            ingestionIssues.push({ reason: 'duplicate', count: persistence.duplicates.length })
          }

          const scoringMetrics = await runInlineScoring({
            clientId: claimed.clientId,
            sourceId: claimed.id,
            itemIds: persistence.inserted.map((item) => item.id),
            now: options.now,
          })
          runMetrics.scoring = scoringMetrics

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

    if (failureReason) {
      runMetrics.failureReason = failureReason
    }

    try {
      healthUpdate = await completeDiscoverySourceFetch({
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
        metrics: {
          ...runMetrics,
          issues: ingestionIssues,
        },
      })
    } catch (error) {
      console.error('[discovery.ingest] failed to persist completion', {
        sourceId: claimed.id,
        runId,
        error,
      })
      try {
        healthUpdate = await releaseDiscoverySourceAfterFailedCompletion({
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
        metrics: runMetrics,
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
    } else if (ingestionIssues.length) {
      emitDiscoveryEventSafely({
        type: 'ingest.error',
        version: EVENT_VERSION,
        payload: {
          runId,
          clientId: claimed.clientId,
          sourceId: claimed.id,
          sourceType: claimed.sourceType,
          issues: ingestionIssues,
        },
      })
    }

    if (healthUpdate) {
      publishSourceHealthStatus({
        clientId: claimed.clientId,
        sourceId: claimed.id,
        sourceType: claimed.sourceType,
        status: healthUpdate.status,
        lastFetchedAt: healthUpdate.lastFetchedAt ?? undefined,
        observedAt: healthUpdate.observedAt,
        failureReason: healthUpdate.failureReason ?? undefined,
        consecutiveFailures: healthUpdate.consecutiveFailures,
        attempt: !success ? permanentFailureNotice?.attempt ?? attempts.length : undefined,
        staleSince: healthUpdate.staleSince ?? undefined,
      })
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
