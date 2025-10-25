import {
  HitlRequestPayloadSchema,
  HitlRequestRecord,
  HitlRunState,
  HitlResponse,
  HitlResponseInput,
  HitlResponseInputSchema,
  HitlOriginAgent,
  HitlStateEnvelopeSchema,
  HitlRequestMetadata
} from '@awesomeposter/shared'
import type { HitlStateEnvelope } from '@awesomeposter/shared'
import { getHitlRepository } from './hitl-repository'
import { getHitlContext } from './hitl-context'
import { genCorrelationId, getLogger } from './logger'
import { DEFAULT_FALLBACK_QUESTION } from '../tools/hitl'

const DEFAULT_MAX_REQUESTS = Number.parseInt(process.env.HITL_MAX_REQUESTS || '', 10) || 3

export type HitlRequestResult =
  | { status: 'pending'; request: HitlRequestRecord }
  | { status: 'denied'; reason: string; request: HitlRequestRecord }

export class HitlService {
  constructor(private readonly repo = getHitlRepository()) {}

  getMaxRequestsPerRun() {
    return DEFAULT_MAX_REQUESTS
  }

  async loadRunState(runId: string): Promise<HitlRunState> {
    return this.repo.getRunState(runId)
  }

  async persistRunState(runId: string, state: HitlRunState): Promise<void> {
    await this.repo.setRunState(runId, state)
  }

  async raiseRequest(rawPayload: unknown, metadata?: HitlRequestMetadata): Promise<HitlRequestResult> {
    const ctx = getHitlContext()
    if (!ctx) {
      throw new Error('HITL context unavailable for request')
    }
    const payload = HitlRequestPayloadSchema.parse(rawPayload)
    if (payload.question === DEFAULT_FALLBACK_QUESTION) {
      try {
        getLogger().warn('hitl_request_fallback_used', { runId: ctx.runId, capabilityId: ctx.capabilityId })
      } catch {}
    }
    const originAgent = (ctx.capabilityId ?? 'strategy') as HitlOriginAgent
    const limitMax = ctx.limit.max
    const currentAccepted = ctx.limit.current
    const reasonTooMany = 'Too many HITL requests'

    const now = new Date()
    const pendingNodeId = metadata?.pendingNodeId ?? ctx.stepId
    const request: HitlRequestRecord = {
      id: genCorrelationId(),
      runId: ctx.runId,
      threadId: ctx.threadId,
      stepId: ctx.stepId,
      stepStatusAtRequest: undefined,
      originAgent,
      payload,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      metrics: { attempt: currentAccepted + 1 },
      pendingNodeId: pendingNodeId ?? undefined,
      operatorPrompt: metadata?.operatorPrompt ?? undefined,
      contractSummary: metadata?.contractSummary
    }

    if (currentAccepted >= limitMax) {
      request.status = 'denied'
      request.denialReason = reasonTooMany
      await this.repo.create(request)
      ctx.snapshot = {
        ...ctx.snapshot,
        requests: [...ctx.snapshot.requests.filter((r) => r.id !== request.id), request],
        pendingRequestId: ctx.snapshot.pendingRequestId ?? null,
        deniedCount: ctx.snapshot.deniedCount + 1
      }
      await this.repo.setRunState(ctx.runId, ctx.snapshot)
      try {
        getLogger().info('hitl_request_denied', {
          requestId: request.id,
          runId: ctx.runId,
          originAgent,
          limitMax,
          limitUsed: currentAccepted,
          reason: reasonTooMany
        })
      } catch {}
      ctx.onDenied(reasonTooMany, ctx.snapshot)
      return { status: 'denied', reason: reasonTooMany, request }
    }

    await this.repo.create(request)
    ctx.limit.current = currentAccepted + 1
    ctx.snapshot = {
      ...ctx.snapshot,
      requests: [...ctx.snapshot.requests.filter((r) => r.id !== request.id), request],
      pendingRequestId: request.id,
      deniedCount: ctx.snapshot.deniedCount
    }
    await this.repo.setRunState(ctx.runId, ctx.snapshot)
    try {
      getLogger().info('hitl_request_created', {
        requestId: request.id,
        runId: ctx.runId,
        originAgent,
        limitUsed: ctx.limit.current,
        limitMax
      })
    } catch {}
    ctx.onRequest(request, ctx.snapshot)
    return { status: 'pending', request }
  }

  async registerDenied(requestId: string, reason: string) {
    await this.repo.updateStatus(requestId, 'denied', { denialReason: reason })
  }

  async applyResponses(runId: string, responses: HitlResponseInput[]): Promise<HitlRunState> {
    if (!responses || responses.length === 0) return this.repo.getRunState(runId)
    const parsed = responses.map((r) => HitlResponseInputSchema.parse(r))
    for (const response of parsed) {
      const existing = await this.repo.getRequestById(response.requestId)
      if (!existing) continue
      const record: HitlResponse = {
        id: genCorrelationId(),
        requestId: response.requestId,
        responseType: response.responseType || (typeof response.approved === 'boolean' ? (response.approved ? 'approval' : 'rejection') : (response.selectedOptionId ? 'option' : 'freeform')),
        selectedOptionId: response.selectedOptionId,
        freeformText: response.freeformText,
        approved: response.approved,
        responderId: response.responderId,
        responderDisplayName: response.responderDisplayName,
        createdAt: new Date(),
        metadata: response.metadata
      }
      await this.repo.appendResponse(record)
      try {
        getLogger().info('hitl_response_recorded', {
          requestId: record.requestId,
          runId,
          responseType: record.responseType
        })
      } catch {}
    }
    return this.repo.getRunState(runId)
  }

  parseEnvelope(raw: unknown): { responses: HitlResponseInput[] } | null {
    if (!raw) return null
    const parsed = HitlStateEnvelopeSchema.safeParse(raw)
    if (!parsed.success) return null
    const responses = parsed.data.responses ?? []
    return { responses }
  }
}

let singleton: HitlService | null = null

export function getHitlService() {
  if (!singleton) singleton = new HitlService()
  return singleton
}

export function resetHitlService() {
  singleton = null
}

export type HitlDecision = {
  kind: 'approve' | 'reject'
  request: HitlRequestRecord
  response: HitlResponse
}

export type HitlDecisionAction =
  | { type: 'fail'; message?: string }
  | { type: 'emit'; event?: string; payload?: unknown; message?: string }
  | { type: 'resume' }

export function resolveHitlDecision(state: HitlRunState, requestId: string): HitlDecision | null {
  const request = state.requests.find((r) => r.id === requestId)
  if (!request || request.status !== 'resolved') return null
  const responses = state.responses.filter((res) => res.requestId === requestId)
  if (!responses.length) return null
  const latest = responses[responses.length - 1]
  let kind: HitlDecision['kind'] | null = null
  if (typeof latest.approved === 'boolean') {
    kind = latest.approved ? 'approve' : 'reject'
  } else if (latest.responseType === 'approval') {
    kind = 'approve'
  } else if (latest.responseType === 'rejection') {
    kind = 'reject'
  }
  if (!kind) return null
  return { kind, request, response: latest }
}

export function parseHitlDecisionAction(response: HitlResponse): HitlDecisionAction | null {
  const metadata = response.metadata
  if (!metadata || typeof metadata !== 'object') return null
  const action = (metadata as Record<string, unknown>).action
  if (!action || typeof action !== 'object') return null
  const actionRecord = action as Record<string, unknown>
  const typeRaw = typeof actionRecord.type === 'string' ? actionRecord.type.trim().toLowerCase() : ''
  if (!typeRaw) return null
  switch (typeRaw) {
    case 'fail':
      return {
        type: 'fail',
        message: typeof actionRecord.message === 'string' ? actionRecord.message : undefined
      }
    case 'emit':
      return {
        type: 'emit',
        event: typeof actionRecord.event === 'string' ? actionRecord.event : undefined,
        payload: actionRecord.payload,
        message: typeof actionRecord.message === 'string' ? actionRecord.message : undefined
      }
    case 'resume':
    case 'continue':
      return { type: 'resume' }
    default:
      return null
  }
}
