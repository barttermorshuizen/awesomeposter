import { z } from 'zod'
import { HitlResponseInputSchema } from '@awesomeposter/shared'
import { requireApiAuth } from '../../utils/api-auth'
import { getOrchestratorPersistence } from '../../../packages/agents-server/src/services/orchestrator-persistence'
import { getHitlService } from '../../../packages/agents-server/src/services/hitl-service'
import { createError } from 'h3'
import { getLogger } from '../../../packages/agents-server/src/services/logger'

const ResumeRequestSchema = z
  .object({
    runId: z.string().optional(),
    threadId: z.string().optional(),
    requestId: z.string().min(1),
    responses: z.array(HitlResponseInputSchema).min(1),
    operator: z
      .object({
        id: z.string().optional(),
        displayName: z.string().optional(),
        email: z.string().optional()
      })
      .optional(),
    note: z.string().optional()
  })
  .refine((data) => data.runId || data.threadId, {
    message: 'runId or threadId is required',
    path: ['runId']
  })
  .refine((data) => data.responses.every((res) => res.requestId === data.requestId), {
    message: 'responses must reference requestId',
    path: ['responses']
  })

export default defineEventHandler(async (event) => {
  requireApiAuth(event)
  const body = await readBody(event)
  const payload = ResumeRequestSchema.parse(body)

  const persistence = getOrchestratorPersistence()
  let resolvedRunId = payload.runId ?? null
  let snapshot = resolvedRunId ? await persistence.load(resolvedRunId) : null

  if (!resolvedRunId && payload.threadId) {
    const found = await persistence.findByThreadId(payload.threadId)
    if (!found) {
      throw createError({ statusCode: 404, statusMessage: 'Thread not found' })
    }
    resolvedRunId = found.runId
    snapshot = found.snapshot
  }

  if (!resolvedRunId || !snapshot) {
    throw createError({ statusCode: 404, statusMessage: 'Run not found' })
  }

  const pendingRequest = snapshot.hitlState.requests.find((req) => req.id === payload.requestId)
  if (!pendingRequest) {
    throw createError({ statusCode: 404, statusMessage: 'Request not found for run' })
  }
  if (pendingRequest.status !== 'pending') {
    throw createError({ statusCode: 409, statusMessage: 'Request already resolved' })
  }
  if (snapshot.pendingRequestId && snapshot.pendingRequestId !== payload.requestId) {
    throw createError({ statusCode: 409, statusMessage: 'Run waiting on a different request' })
  }

  // Record responses and refresh HITL state
  const hitlService = getHitlService()
  const updatedState = await hitlService.applyResponses(resolvedRunId, payload.responses)

  const refreshed = await persistence.load(resolvedRunId)
  const metadata = (refreshed.runnerMetadata as Record<string, unknown>) || {}
  const auditLog = Array.isArray((metadata as any).auditLog) ? [...((metadata as any).auditLog as any[])] : []
  auditLog.push({
    action: 'resume',
    requestId: payload.requestId,
    operator: payload.operator ?? null,
    note: payload.note ?? null,
    at: new Date().toISOString()
  })

  const runnerMetadata = {
    ...metadata,
    auditLog,
    lastResumeAt: new Date().toISOString(),
    lastOperator: payload.operator ?? (metadata as any).lastOperator ?? null
  }

  await persistence.save(resolvedRunId, {
    pendingRequestId: updatedState.pendingRequestId ?? null,
    status: 'running',
    runnerMetadata
  })

  try {
    getLogger().info('hitl_resume_api', {
      runId: resolvedRunId,
      requestId: payload.requestId,
      responses: updatedState.responses.length
    })
  } catch {}

  return {
    ok: true,
    runId: resolvedRunId,
    status: 'running',
    pendingRequestId: updatedState.pendingRequestId ?? null,
    requests: updatedState.requests,
    responses: updatedState.responses
  }
})
