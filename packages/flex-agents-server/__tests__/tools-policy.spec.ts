// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { z } from 'zod'

describe('specialist tools policy and orchestrator toollessness', () => {
  it('enforces per-agent allowlists intersected with request allowlist; orchestrator has no tools', async () => {
    const [
      { AgentRuntime },
      { HITL_TOOL_NAME },
      { createStrategistSocialPostingAgent },
      { createStrategistPositioningAgent },
      { createCopywriterSocialDraftingAgent },
      { createCopywriterMessagingAgent },
      { OrchestratorAgent }
    ] = await Promise.all([
      import('../src/services/agent-runtime'),
      import('../src/tools/hitl'),
      import('../src/agents/marketing/strategist-social-posting'),
      import('../src/agents/marketing/strategist-positioning'),
      import('../src/agents/marketing/copywriter-socialpost-drafting'),
      import('../src/agents/marketing/copywriter-messaging'),
      import('../src/services/orchestrator-agent')
    ])

    const runtime = new AgentRuntime()
    // Register a superset of tools
    const ALL = [HITL_TOOL_NAME, 'admin_delete_everything']
    for (const name of ALL) {
      runtime.registerTool({
        name,
        description: `Test ${name}`,
        parameters: z.object({}).passthrough(),
        handler: async () => ({ ok: true })
      })
    }

    const requestAllowlist = [...ALL]
    const policy: 'auto' = 'auto'

    const strategistSocial = createStrategistSocialPostingAgent(runtime, undefined, { policy, requestAllowlist }, 'app') as any
    const strategistPositioning = createStrategistPositioningAgent(runtime, undefined, { policy, requestAllowlist }, 'app') as any
    const copywriterDrafting = createCopywriterSocialDraftingAgent(runtime, undefined, { policy, requestAllowlist }, 'app') as any
    const copywriterMessaging = createCopywriterMessagingAgent(runtime, undefined, { policy, requestAllowlist }, 'app') as any

    const names = (agent: any) => (Array.isArray(agent?.tools) ? agent.tools.map((t: any) => t?.name) : [])
    const strategistSocialTools = names(strategistSocial)
    const strategistPositioningTools = names(strategistPositioning)
    const copywriterDraftingTools = names(copywriterDrafting)
    const copywriterMessagingTools = names(copywriterMessaging)

    const expected = [HITL_TOOL_NAME]

    expect(strategistSocialTools).toEqual(expected)
    expect(strategistPositioningTools).toEqual(expected)
    expect(copywriterDraftingTools).toEqual(expected)
    expect(copywriterMessagingTools).toEqual(expected)

    // Orchestrator agent is not an Agents-SDK agent; it should have no tools configured
    const orch = new OrchestratorAgent(runtime) as any
    expect(orch.tools).toBeUndefined()
  })
})
