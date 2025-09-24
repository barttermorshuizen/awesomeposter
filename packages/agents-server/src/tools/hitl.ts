import { AgentRuntime } from '../services/agent-runtime'
import { HitlRequestPayloadSchema } from '@awesomeposter/shared'
import { getHitlService } from '../services/hitl-service'

export const HITL_TOOL_NAME = 'hitl_request'

export function registerHitlTools(runtime: AgentRuntime) {
  const service = getHitlService()
  runtime.registerTool({
    name: HITL_TOOL_NAME,
    description: 'Request human-in-the-loop input (question, approval, or choice).',
    parameters: HitlRequestPayloadSchema,
    handler: async (raw: unknown) => {
      const result = await service.raiseRequest(raw)
      if (result.status === 'denied') {
        return {
          status: 'denied',
          reason: result.reason,
          requestId: result.request.id
        }
      }
      return {
        status: 'pending',
        requestId: result.request.id,
        originAgent: result.request.originAgent,
        urgency: result.request.payload.urgency,
        kind: result.request.payload.kind
      }
    }
  })
}
