import { WorkflowRequestSchema } from '@awesomeposter/shared'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const request = WorkflowRequestSchema.parse(body)
  const { getAgents } = await import('../../../../src/services/agents-container')
  const { strategy, generator, qa } = getAgents()
  const orchestrator = new (await import('../../../../src/services/workflow-orchestrator')).WorkflowOrchestrator(
    strategy,
    generator,
    qa
  )
  const result = await orchestrator.executeWorkflow(request)
  return {
    success: true,
    workflowId: result.workflowId,
    finalState: result.finalState,
    metrics: result.metrics
  }
})
