// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { z } from 'zod'

describe('specialist tools policy and orchestrator toollessness', () => {
  it('enforces per-agent allowlists intersected with request allowlist; orchestrator has no tools', async () => {
    const [
      { AgentRuntime },
      { createStrategyAgent },
      { createContentAgent },
      { createQaAgent },
      { OrchestratorAgent }
    ] = await Promise.all([
      import('../src/services/agent-runtime'),
      import('../src/agents/strategy-manager'),
      import('../src/agents/content-generator'),
      import('../src/agents/quality-assurance'),
      import('../src/services/orchestrator-agent')
    ])

    const runtime = new AgentRuntime()
    // Register a superset of tools
    const ALL = [
      'strategy_analyze_assets',
      'strategy_plan_knobs',
      'apply_format_rendering',
      'optimize_for_platform',
      'qa_evaluate_content',
      'admin_delete_everything'
    ]
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

    const strat = createStrategyAgent(runtime, undefined, { policy, requestAllowlist }, 'app') as any
    const gen = createContentAgent(runtime, undefined, { policy, requestAllowlist }, 'app') as any
    const qa = createQaAgent(runtime, undefined, { policy, requestAllowlist }) as any

    const names = (agent: any) => (Array.isArray(agent?.tools) ? agent.tools.map((t: any) => t?.name) : [])
    const sNames = names(strat)
    const gNames = names(gen)
    const qNames = names(qa)

    // Strategy should not inherit admin or content/qa tools
    expect(sNames).toContain('strategy_analyze_assets')
    expect(sNames).toContain('strategy_plan_knobs')
    expect(sNames).not.toContain('admin_delete_everything')
    expect(sNames).not.toContain('apply_format_rendering')
    expect(sNames).not.toContain('qa_evaluate_content')

    // Content restricted to its tools
    expect(gNames).toContain('apply_format_rendering')
    expect(gNames).toContain('optimize_for_platform')
    expect(gNames).not.toContain('admin_delete_everything')
    expect(gNames).not.toContain('strategy_analyze_assets')

    // QA restricted to its tool
    expect(qNames).toContain('qa_evaluate_content')
    expect(qNames).not.toContain('admin_delete_everything')

    // Orchestrator agent is not an Agents-SDK agent; it should have no tools configured
    const orch = new OrchestratorAgent(runtime) as any
    expect(orch.tools).toBeUndefined()
  })
})

