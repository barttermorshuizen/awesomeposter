import { WorkflowRequestSchema } from '@awesomeposter/shared'
import { createSse } from '../../../../src/utils/sse'
import { withSseConcurrency, sseSemaphore, isBacklogFull, backlogSnapshot } from '../../../../src/utils/concurrency'
import { setHeader } from 'h3'

export default defineEventHandler(async (event) => {
  const body = (event as any).context?.body ?? (await readBody(event))
  const request = WorkflowRequestSchema.parse(body)

  const cid = getHeader(event, 'x-correlation-id') || (event as any).context?.correlationId || undefined

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
    await withSseConcurrency(async () => {
      const { getAgents } = await import('../../../../src/services/agents-container')
      const { strategy, generator, qa } = getAgents()
      const orchestrator = new (await import('../../../../src/services/workflow-orchestrator')).WorkflowOrchestrator(
        strategy,
        generator,
        qa
      )
      const result = await orchestrator.executeWorkflowWithProgress(request, (progress) =>
        sse.send({ type: 'progress', data: progress })
      )
      await sse.send({ type: 'complete', data: result })
    })
  } catch (error: any) {
    const message = error?.statusMessage || error?.message || 'Unknown error'
    await sse.send({ type: 'error', message })
  } finally {
    sse.close()
  }
})
