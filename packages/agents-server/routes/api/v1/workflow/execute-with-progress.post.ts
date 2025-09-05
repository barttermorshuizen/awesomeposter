import { WorkflowRequestSchema } from '@awesomeposter/shared'
import { createSse } from '../../../../src/utils/sse'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const request = WorkflowRequestSchema.parse(body)

  const cid = getHeader(event, 'x-correlation-id') || (event as any).context?.correlationId || undefined
  const sse = createSse(event, { correlationId: cid, heartbeatMs: 15000 })

  try {
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
  } catch (error: any) {
    const message = error?.statusMessage || error?.message || 'Unknown error'
    await sse.send({ type: 'error', message })
  } finally {
    sse.close()
  }
})
