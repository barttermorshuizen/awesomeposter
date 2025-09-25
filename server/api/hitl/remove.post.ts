import { z } from 'zod'
import { requireApiAuth } from '../../utils/api-auth'
import { getOrchestratorPersistence } from '../../../packages/agents-server/src/services/orchestrator-persistence'
import { getHitlService } from '../../../packages/agents-server/src/services/hitl-service'
import { createError } from 'h3'
import { getLogger } from '../../../packages/agents-server/src/services/logger'

const RemoveRequestSchema = z
  .object({
    runId: z.string().optional(),
    threadId: z.string().optional(),
    requestId: z.string().optional(),
    reason: z.string().min(1),
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

export default defineEventHandler(async (event) => {
  requireApiAuth(event)
  const body = await readBody(event)
  const payload = RemoveRequestSchema.parse(body)

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

  const targetRequestId = payload.requestId ?? snapshot.pendingRequestId ?? null
  if (!targetRequestId) {
    throw createError({ statusCode: 409, statusMessage: 'Run has no pending requests to remove' })
  }

  const requestRecord = snapshot.hitlState.requests.find((req) => req.id === targetRequestId)
  if (!requestRecord) {
    throw createError({ statusCode: 404, statusMessage: 'Request not found for run' })
  }
  if (requestRecord.status !== 'pending') {
    throw createError({ statusCode: 409, statusMessage: 'Request already resolved' })
  }

  const hitlService = getHitlService()
  await hitlService.registerDenied(targetRequestId, payload.reason)
  const updatedState = await hitlService.loadRunState(resolvedRunId)

  const refreshed = await persistence.load(resolvedRunId)
  const metadata = (refreshed.runnerMetadata as Record<string, unknown>) || {}
  const auditLog = Array.isArray((metadata as any).auditLog) ? [...((metadata as any).auditLog as any[])] : []
  auditLog.push({
    action: 'cancel',
    requestId: targetRequestId,
    reason: payload.reason,
    operator: payload.operator ?? null,
    note: payload.note ?? null,
    at: new Date().toISOString()
  })

  const runnerMetadata = {
    ...metadata,
    auditLog,
    lastCancelAt: new Date().toISOString(),
    lastOperator: payload.operator ?? (metadata as any).lastOperator ?? null
  }

  await persistence.save(resolvedRunId, {
    pendingRequestId: null,
    status: 'cancelled',
    runnerMetadata
  })

  try {
    getLogger().info('hitl_cancel_api', {
      runId: resolvedRunId,
      requestId: targetRequestId,
      reason: payload.reason
    })
  } catch {}

  return {
    ok: true,
    runId: resolvedRunId,
    status: 'cancelled',
    pendingRequestId: null,
    requests: updatedState.requests,
    responses: updatedState.responses
  }
})
