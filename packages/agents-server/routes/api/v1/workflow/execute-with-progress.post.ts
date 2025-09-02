import { WorkflowRequestSchema } from '@awesomeposter/shared'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const request = WorkflowRequestSchema.parse(body)

  setHeader(event, 'Content-Type', 'text/event-stream')
  setHeader(event, 'Cache-Control', 'no-cache')
  setHeader(event, 'Connection', 'keep-alive')

  const write = (data: any) => {
    // @ts-ignore
    event.node.res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  try {
    const { getAgents } = await import('../../../../src/services/agents-container')
    const { strategy, generator, qa } = getAgents()
    const orchestrator = new (await import('../../../../src/services/workflow-orchestrator')).WorkflowOrchestrator(
      strategy,
      generator,
      qa
    )
    const result = await orchestrator.executeWorkflowWithProgress(request, (progress) => write(progress))
    write({ type: 'complete', result })
  } catch (error: any) {
    write({ type: 'error', error: error?.message || 'Unknown error' })
  } finally {
    // @ts-ignore
    event.node.res.end()
  }
})
