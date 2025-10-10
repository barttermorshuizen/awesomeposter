import { AgentRunRequestSchema } from '@awesomeposter/shared'
import { createSse } from '../../../../src/utils/sse'
import { withSseConcurrency, sseSemaphore, isBacklogFull, backlogSnapshot } from '../../../../src/utils/concurrency'
import { setHeader, getMethod, getHeader, sendNoContent } from 'h3'

export default defineEventHandler(async (event) => {
  const method = getMethod(event)

  if (method === 'OPTIONS') {
    const origin = getHeader(event, 'origin')
    if (origin) {
      setHeader(event, 'Vary', 'Origin')
      setHeader(event, 'Access-Control-Allow-Origin', origin)
    }
    setHeader(event, 'Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    setHeader(event, 'Access-Control-Allow-Headers', getHeader(event, 'access-control-request-headers') || 'content-type,accept,authorization,x-correlation-id')
    setHeader(event, 'Access-Control-Max-Age', 600)
    return sendNoContent(event, 204)
  }

  const origin = getHeader(event, 'origin')
  if (origin) {
    setHeader(event, 'Vary', 'Origin')
    setHeader(event, 'Access-Control-Allow-Origin', origin)
    setHeader(event, 'Access-Control-Allow-Credentials', 'true')
  }
  setHeader(event, 'Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  setHeader(event, 'Access-Control-Allow-Headers', 'content-type,accept,authorization,x-correlation-id')
  setHeader(event, 'Access-Control-Expose-Headers', 'content-type,x-correlation-id')

  const body = (event as any).context?.body ?? (await readBody(event))
  const req = AgentRunRequestSchema.parse(body)
  // Forward-compat: merge original options to preserve unknown future fields (e.g., targetAgentId)
  const rawOptions = (typeof body === 'object' && body && 'options' in (body as any)) ? (body as any).options : undefined
  const finalReq: any = { ...req, options: { ...(rawOptions || {}), ...(req.options || {}) } }
  // Ensure threadId for resumability
  try {
    if (!finalReq.threadId) {
      const { genCorrelationId } = await import('../../../../src/services/logger')
      finalReq.threadId = genCorrelationId()
    }
  } catch {}

  if (req.mode === 'chat') {
    const enabled = process.env.ENABLE_CHAT_SANDBOX === 'true' || process.env.NODE_ENV !== 'production'
    if (!enabled) {
      throw createError({ statusCode: 403, statusMessage: 'Chat sandbox disabled' })
    }
  }

  const cid = getHeader(event, 'x-correlation-id') || (event as any).context?.correlationId || undefined

  // Debug: log incoming run request mode and targetAgentId
  try {
    const { getLogger } = await import('../../../../src/services/logger')
    getLogger().info('run_stream_request', {
      mode: req.mode,
      targetAgentId: (finalReq?.options as any)?.targetAgentId,
      toolPolicy: (finalReq?.options as any)?.toolPolicy,
      trace: (finalReq?.options as any)?.trace,
      correlationId: cid
    })
  } catch {}

  // Backlog protection: reject with 503 before opening SSE when queue is large
  if (isBacklogFull()) {
    const snap = backlogSnapshot()
    try {
      const { getLogger } = await import('../../../../src/services/logger')
      getLogger().warn('sse_backlog_reject', { ...snap, correlationId: cid })
    } catch {}
    setHeader(event, 'Retry-After', 2)
    setHeader(event, 'Cache-Control', 'no-store')
    setHeader(event, 'X-Backlog-Pending', String(snap.pending))
    setHeader(event, 'X-Backlog-Limit', String(snap.limit))
    throw createError({ statusCode: 503, statusMessage: 'Server busy. Please retry.' })
  }

  const sse = createSse(event, { correlationId: cid, heartbeatMs: 15000 })

  try {
    if (sseSemaphore.pending > 0 || sseSemaphore.used > 0) {
      try {
        const { getLogger } = await import('../../../../src/services/logger')
        getLogger().info('sse_queue', { used: sseSemaphore.used, pending: sseSemaphore.pending, correlationId: cid })
      } catch {}
    }
    try {
      const { getLogger } = await import('../../../../src/services/logger')
      getLogger().info('orchestrator_run_begin', {
        correlationId: cid,
        threadId: finalReq.threadId,
        mode: finalReq.mode,
        hasObjective: typeof finalReq.objective === 'string' && finalReq.objective.length > 0,
        options: finalReq.options
      })
    } catch {}
    await withSseConcurrency(async () => {
      const injected = (event as any).context?.orch
      const orch = injected || (await import('../../../../src/services/orchestrator-agent')).getOrchestrator()
      await orch.run(finalReq, (e: any) => sse.send(e), cid)
      // Orchestrator emits 'complete'; do not duplicate here
    })
  } catch (error: any) {
    const message = error?.statusMessage || error?.message || 'Unknown error'
    await sse.send({ type: 'error', message })
  } finally {
    sse.close()
  }
})
