import { EventEmitter } from 'node:events'
import type { FlexEvent, FlexEventType, FlexFacetProvenanceMap } from '@awesomeposter/shared'
import { getLogger } from './logger'

export type FlexTelemetryEvent = FlexEvent & {
  planVersion?: number
  facetProvenance?: FlexFacetProvenanceMap
}

type LabelValue = string | number | boolean | null | undefined

type MetricLabels = Record<string, LabelValue>

type CounterState = Map<string, number>

type HistogramBucket = {
  count: number
  sum: number
  min: number
  max: number
}

type HistogramState = Map<string, HistogramBucket>

export type TelemetryMetricsSnapshot = {
  counters: Record<string, number>
  histograms: Record<string, HistogramBucket>
}

type SubscriptionOptions = {
  types?: FlexEventType[]
}

const LIFECYCLE_EVENT_TYPES: FlexEventType[] = [
  'plan_requested',
  'plan_rejected',
  'plan_generated',
  'plan_updated',
  'policy_triggered'
]

class TelemetryService {
  private readonly emitter = new EventEmitter()
  private readonly counters: CounterState = new Map()
  private readonly histograms: HistogramState = new Map()
  private readonly lastPlanVersion = new Map<string, number>()

  createRunEmitter(
    base: { runId: string; correlationId?: string | null },
    sink: (event: FlexTelemetryEvent) => Promise<void>
  ): (event: FlexTelemetryEvent) => Promise<void> {
    const correlationId = base.correlationId ?? undefined
    let currentPlanVersion: number | undefined

    return async (frame: FlexTelemetryEvent) => {
      if (typeof frame.planVersion === 'number') {
        currentPlanVersion = frame.planVersion
      }

      const event: FlexTelemetryEvent = {
        ...frame,
        runId: frame.runId ?? base.runId,
        correlationId: frame.correlationId ?? correlationId,
        planVersion: typeof frame.planVersion === 'number' ? frame.planVersion : currentPlanVersion
      }

      this.process(event)
      await sink(event)
    }
  }

  process(event: FlexTelemetryEvent) {
    try {
      if (event.runId && typeof event.planVersion === 'number') {
        this.lastPlanVersion.set(event.runId, event.planVersion)
      }
      this.logEvent(event)
      this.trackMetrics(event)
    } catch (error) {
      try {
        getLogger().warn('flex_telemetry_process_error', {
          error: error instanceof Error ? error.message : String(error),
          eventType: event.type
        })
      } catch {}
    }

    this.emitter.emit('event', event)
  }

  subscribe(listener: (event: FlexTelemetryEvent) => void, options?: SubscriptionOptions): () => void {
    const allowed = options?.types ? new Set(options.types) : null
    const handler = (event: FlexTelemetryEvent) => {
      if (!allowed || allowed.has(event.type)) {
        listener(event)
      }
    }
    this.emitter.on('event', handler)
    return () => {
      this.emitter.off('event', handler)
    }
  }

  subscribeToLifecycle(listener: (event: FlexTelemetryEvent) => void): () => void {
    return this.subscribe(listener, { types: LIFECYCLE_EVENT_TYPES })
  }

  recordRunStatus(
    status: 'completed' | 'awaiting_hitl' | 'failed' | 'cancelled',
    context: { runId: string; correlationId?: string | null; planVersion?: number }
  ) {
    const planVersion =
      typeof context.planVersion === 'number'
        ? context.planVersion
        : this.lastPlanVersion.get(context.runId)

    const event: FlexTelemetryEvent = {
      type: 'log',
      timestamp: new Date().toISOString(),
      runId: context.runId,
      correlationId: context.correlationId ?? undefined,
      planVersion,
      payload: { status }
    }

    this.recordCounter('flex.run.status', { status }, event)

    try {
      getLogger().info('flex_run_status', {
        runId: event.runId,
        correlationId: event.correlationId,
        planVersion: event.planVersion,
        status
      })
    } catch {}
  }

  recordHitlRejection(context: {
    runId: string
    action: 'fail' | 'emit'
    nodeId?: string | null
    correlationId?: string | null
    planVersion?: number
    reason?: string | null
  }) {
    const planVersion =
      typeof context.planVersion === 'number'
        ? context.planVersion
        : this.lastPlanVersion.get(context.runId)

    const event: FlexTelemetryEvent = {
      type: 'log',
      timestamp: new Date().toISOString(),
      runId: context.runId,
      nodeId: context.nodeId ?? undefined,
      correlationId: context.correlationId ?? undefined,
      planVersion,
      payload: {
        action: context.action,
        reason: context.reason ?? undefined
      }
    }

    const labels: MetricLabels = {
      action: context.action,
      ...(context.nodeId ? { nodeId: context.nodeId } : {})
    }

    this.recordCounter('flex.hitl.rejected', labels, event)

    try {
      getLogger().info('flex_hitl_rejection', {
        runId: event.runId,
        nodeId: event.nodeId,
        action: context.action,
        correlationId: event.correlationId,
        planVersion: event.planVersion,
        reason: context.reason ?? undefined
      })
    } catch {}
  }

  recordPlannerPromptSize(context: {
    systemCharacters: number
    userCharacters: number
    facetRows: number
    capabilityRows: number
  }) {
    const totalCharacters = context.systemCharacters + context.userCharacters
    const labels: MetricLabels = {
      facetRows: context.facetRows,
      capabilityRows: context.capabilityRows
    }

    this.recordHistogram('flex.planner.prompt.total_chars', totalCharacters, labels)
    this.recordHistogram('flex.planner.prompt.system_chars', context.systemCharacters, labels)
    this.recordHistogram('flex.planner.prompt.user_chars', context.userCharacters, labels)

    try {
      getLogger().info('flex_planner_prompt_metrics', {
        totalCharacters,
        systemCharacters: context.systemCharacters,
        userCharacters: context.userCharacters,
        facetRows: context.facetRows,
        capabilityRows: context.capabilityRows
      })
    } catch {}
  }

  getMetricsSnapshot(): TelemetryMetricsSnapshot {
    const counters: Record<string, number> = {}
    for (const [key, value] of this.counters.entries()) {
      counters[key] = value
    }
    const histograms: Record<string, HistogramBucket> = {}
    for (const [key, bucket] of this.histograms.entries()) {
      histograms[key] = { ...bucket }
    }
    return { counters, histograms }
  }

  resetForTest() {
    this.counters.clear()
    this.histograms.clear()
    this.lastPlanVersion.clear()
    this.emitter.removeAllListeners()
  }

  private logEvent(event: FlexTelemetryEvent) {
    const logger = getLogger()
    const base = {
      runId: event.runId,
      nodeId: event.nodeId,
      correlationId: event.correlationId,
      planVersion: event.planVersion,
      facetProvenance: event.facetProvenance
    }
    const payload = (event.payload ?? {}) as Record<string, unknown>

    switch (event.type) {
      case 'plan_requested': {
        logger.info('flex_plan_requested', {
          ...base,
          attempt: payload.attempt,
          phase: payload.phase,
          variantCount: payload.variantCount
        })
        break
      }
      case 'plan_rejected': {
        logger.warn('flex_plan_rejected', {
          ...base,
          attempt: payload.attempt,
          phase: payload.phase,
          diagnostics: payload.diagnostics
        })
        break
      }
      case 'plan_generated': {
        const plan = payload.plan as Record<string, unknown> | undefined
        logger.info('flex_plan_generated', {
          ...base,
          version: plan?.version ?? event.planVersion,
          nodeCount: Array.isArray(plan?.nodes) ? plan?.nodes.length : undefined,
          metadata: plan?.metadata
        })
        break
      }
      case 'plan_updated': {
        logger.info('flex_plan_updated', {
          ...base,
          previousVersion: payload.previousVersion,
          version: payload.version,
          trigger: payload.trigger
        })
        break
      }
      case 'node_start': {
        logger.info('flex_node_start', {
          ...base,
          capabilityId: payload.capabilityId,
          label: payload.label,
          startedAt: payload.startedAt
        })
        break
      }
      case 'node_complete': {
        logger.info('flex_node_complete', {
          ...base,
          capabilityId: payload.capabilityId,
          label: payload.label,
          durationMs: payload.durationMs,
          completedAt: payload.completedAt,
          outputPreview: summarizeValue(payload.output)
        })
        break
      }
      case 'node_error': {
        logger.error('flex_node_error', {
          ...base,
          capabilityId: payload.capabilityId,
          error: summarizeValue(payload.error)
        })
        break
      }
      case 'validation_error': {
        const errors = Array.isArray(payload.errors) ? payload.errors.length : undefined
        logger.warn('flex_validation_failed', {
          ...base,
          scope: payload.scope,
          errorCount: errors
        })
        break
      }
      case 'policy_triggered': {
        logger.info('flex_policy_triggered', {
          ...base,
          trigger: payload.trigger
        })
        break
      }
      case 'hitl_request': {
        const request = payload.request as Record<string, unknown> | undefined
        logger.info('flex_hitl_request', {
          ...base,
          requestId: request?.id,
          originAgent: request?.originAgent,
          nodeId: event.nodeId,
          createdAt: request?.createdAt
        })
        break
      }
      case 'hitl_resolved': {
        const request = payload.request as Record<string, unknown> | undefined
        logger.info('flex_hitl_resolved', {
          ...base,
          requestId: request?.id,
          originAgent: request?.originAgent,
          resolvedAt: request?.resolvedAt
        })
        break
      }
      case 'complete': {
        const payloadRecord = (event.payload ?? {}) as Record<string, unknown>
        const status =
          typeof payloadRecord.status === 'string' ? payloadRecord.status : 'completed'
        const logPayload: Record<string, unknown> = {
          ...base,
          status
        }
        if (Object.prototype.hasOwnProperty.call(payloadRecord, 'output')) {
          logPayload.outputPreview = summarizeValue((payloadRecord as any).output)
        }
        if (Object.prototype.hasOwnProperty.call(payloadRecord, 'error')) {
          logPayload.error = summarizeValue((payloadRecord as any).error)
        }
        logger.info('flex_run_complete', logPayload)
        break
      }
      default: {
        if (event.type === 'log') {
          logger.info('flex_log', { ...base, message: event.message ?? payload?.message })
        }
        break
      }
    }
  }

  private trackMetrics(event: FlexTelemetryEvent) {
    switch (event.type) {
      case 'plan_requested': {
        this.recordCounter(
          'flex.planner.requests',
          { phase: (event.payload as any)?.phase ?? 'initial' },
          event
        )
        break
      }
      case 'plan_rejected': {
        this.recordCounter('flex.planner.rejections', undefined, event)
        break
      }
      case 'plan_generated': {
        this.recordCounter('flex.planner.generated', undefined, event)
        break
      }
      case 'plan_updated': {
        this.recordCounter('flex.planner.updated', undefined, event)
        break
      }
      case 'policy_triggered': {
        this.recordCounter('flex.policy.triggers', undefined, event)
        break
      }
      case 'hitl_request': {
        this.recordCounter('flex.hitl.requests', { nodeId: event.nodeId }, event)
        break
      }
      case 'hitl_resolved': {
        this.recordCounter('flex.hitl.resolved', { nodeId: event.nodeId }, event)
        break
      }
      case 'validation_error': {
        this.recordCounter(
          'flex.validation.retries',
          { scope: (event.payload as any)?.scope },
          event
        )
        break
      }
      case 'node_complete': {
        const payload = event.payload as Record<string, unknown> | undefined
        const duration = typeof payload?.durationMs === 'number' ? payload.durationMs : undefined
        if (typeof duration === 'number' && Number.isFinite(duration)) {
          this.recordHistogram(
            'flex.node.duration_ms',
            duration,
            {
              capabilityId: typeof payload?.capabilityId === 'string' ? payload.capabilityId : 'unknown'
            },
            event
          )
        }
        break
      }
      case 'complete': {
        const payloadRecord = (event.payload ?? {}) as Record<string, unknown>
        const status =
          typeof payloadRecord.status === 'string' ? payloadRecord.status : 'completed'
        if (status === 'completed') {
          this.recordRunStatus('completed', {
            runId: event.runId ?? 'unknown',
            correlationId: event.correlationId,
            planVersion: event.planVersion
          })
        }
        break
      }
      default:
        break
    }
  }

  private recordCounter(name: string, labels?: MetricLabels, event?: FlexTelemetryEvent) {
    const key = this.metricKey(name, labels)
    const next = (this.counters.get(key) ?? 0) + 1
    this.counters.set(key, next)

    try {
      getLogger().info('flex_metric', {
        kind: 'counter',
        name,
        value: next,
        increment: 1,
        labels,
        runId: event?.runId,
        correlationId: event?.correlationId,
        planVersion: event?.planVersion
      })
    } catch {}
  }

  private recordHistogram(name: string, value: number, labels?: MetricLabels, event?: FlexTelemetryEvent) {
    const key = this.metricKey(name, labels)
    const bucket = this.histograms.get(key) ?? { count: 0, sum: 0, min: Number.POSITIVE_INFINITY, max: 0 }
    bucket.count += 1
    bucket.sum += value
    bucket.min = Math.min(bucket.min, value)
    bucket.max = Math.max(bucket.max, value)
    this.histograms.set(key, bucket)

    try {
      getLogger().info('flex_metric', {
        kind: 'histogram',
        name,
        value,
        labels,
        runId: event?.runId,
        correlationId: event?.correlationId,
        planVersion: event?.planVersion
      })
    } catch {}
  }

  private metricKey(name: string, labels?: MetricLabels) {
    if (!labels || Object.keys(labels).length === 0) return name
    const serialized = Object.entries(labels)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${String(value)}`)
      .sort()
      .join('|')
    return serialized ? `${name}|${serialized}` : name
  }
}

function summarizeValue(value: unknown): string | undefined {
  if (value == null) return undefined
  if (typeof value === 'string') {
    return value.length > 120 ? `${value.slice(0, 117)}...` : value
  }
  try {
    const json = JSON.stringify(value)
    return json.length > 120 ? `${json.slice(0, 117)}...` : json
  } catch {
    return String(value)
  }
}

let telemetryService: TelemetryService | null = null

export function getTelemetryService(): TelemetryService {
  if (!telemetryService) {
    telemetryService = new TelemetryService()
  }
  return telemetryService
}

export function __resetTelemetryServiceForTest() {
  telemetryService?.resetForTest()
}
