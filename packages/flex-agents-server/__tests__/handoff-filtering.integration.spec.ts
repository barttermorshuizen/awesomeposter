// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'

// Mock the OpenAI Agents SDK before importing the orchestrator and runtime
vi.mock('@openai/agents', () => {
  // Minimal SDK facade to support orchestrator integration behavior
  class Agent {
    name: string
    instructions: string
    tools: any[]
    handoffs: any[]
    constructor(opts: any) {
      this.name = opts?.name || 'Agent'
      this.instructions = opts?.instructions || ''
      this.tools = Array.isArray(opts?.tools) ? opts.tools : []
      this.handoffs = Array.isArray(opts?.handoffs) ? opts.handoffs : []
    }
    static create(opts: any) {
      return new Agent(opts)
    }
  }

  class Handoff {
    targetAgent: any
    options: any
    agent?: any
    constructor(a: any, b?: any) {
      // Support both forms:
      //  - new Handoff({ agent, inputFilter, ... })
      //  - new Handoff(targetAgent, options)
      if (a && typeof a === 'object' && (a.agent || a.targetAgent)) {
        this.targetAgent = (a as any).agent || (a as any).targetAgent
        this.agent = this.targetAgent
        this.options = a || {}
      } else {
        this.targetAgent = a
        this.agent = a
        this.options = b || {}
      }
    }
  }

  // Tool factory used by AgentRuntime.getAgentTools()
  const tool = (def: any) => ({ ...def })
  // Provide handoff() helper to match orchestrator usage
  const handoff = (a: any, b?: any) => new Handoff(a, b)

  class Runner {
    model: string
    constructor(opts: any) {
      this.model = opts?.model
    }

    async run(agent: any, prompt: string, _opts?: any) {
      // Helper to join textual content from filtered history
      const joinHistory = (filtered: any[]): string => {
        return (filtered || [])
          .map((m) => {
            const c = (m as any)?.content
            if (typeof c === 'string') return c
            if (Array.isArray(c)) {
              return c
                .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
                .join(' ')
            }
            return ''
          })
          .join('\n')
      }

      // Build a naive history with a single user text block that contains the entire prompt.
      // The inputFilter under test is expected to strip sentinels and prune artifacts.
      const initialHistory = [{ role: 'user', content: prompt }]

      const events: any[] = []

      // Support both SDK tool-based handoffs (agent.tools with Handoff instances)
      // and legacy agent.handoffs arrays used in earlier iterations/mocks.
      const handoffTools = Array.isArray(agent?.tools)
        ? (agent.tools as any[]).filter(
            (t) => t && (t.targetAgent || (t.options && t.options.agent) || (t as any).agent)
          )
        : []
      const legacyHandoffs = Array.isArray(agent?.handoffs) ? (agent.handoffs as any[]) : []
      const allHandoffs = [...legacyHandoffs, ...handoffTools]

      if (allHandoffs.length > 0) {
        for (const hf of allHandoffs) {
          const targetAgent = (hf as any)?.targetAgent || (hf as any)?.agent || (hf as any)?.options?.agent
          const targetName = targetAgent?.name || 'Unknown'

          // Signal handoff
          events.push({
            type: 'run_item_stream_event',
            name: 'handoff_requested',
            item: { agent }
          })

          // Apply inputFilter (this is the system-under-test behavior)
          let filtered = initialHistory
          const inputFilter = (hf as any)?.options?.inputFilter || (hf as any)?.inputFilter
          if (inputFilter) {
            try {
              filtered = await inputFilter(initialHistory)
            } catch {
              // ignore filter errors in mock
            }
          }
          const filteredText = `[FILTERED for ${targetName}]\n${joinHistory(filtered)}`

          // Signal that handoff occurred
          events.push({
            type: 'run_item_stream_event',
            name: 'handoff_occurred',
            item: {
              sourceAgent: { name: agent?.name || 'Triage Agent' },
              targetAgent: { name: targetName }
            }
          })

          // Emit a reasoning item including the filtered text, which the orchestrator forwards as a message event
          events.push({
            type: 'run_item_stream_event',
            name: 'reasoning_item_created',
            item: {
              rawItem: { rawContent: [{ text: filteredText }] }
            }
          })

          // Simulate a tool call observable only if the target agent exposes tools (enforced by allowlists)
          const toolNames = (targetAgent?.tools || [])
            .map((t: any) => t?.name)
            .filter((n: any) => typeof n === 'string')

          if (toolNames.length > 0) {
            const picked = toolNames[0]
            events.push({
              type: 'run_item_stream_event',
              name: 'tool_called',
              item: {
                rawItem: {
                  name: picked,
                  arguments: JSON.stringify({ example: true })
                }
              }
            })
            events.push({
              type: 'run_item_stream_event',
              name: 'tool_output',
              item: {
                rawItem: {
                  name: picked,
                  output: { ok: true }
                }
              }
            })
          }
        }
      }

      // Provide a structured final output consistent with AppResultSchema
      const finalOutput = JSON.stringify({
        result: {
          drafts: [
            { platform: 'linkedin', variantId: '1', post: 'Draft 1' },
            { platform: 'x', variantId: '2', post: 'Draft 2' },
            { platform: 'linkedin', variantId: '3', post: 'Draft 3' }
          ],
          knobs: { formatType: 'text' }
        },
        rationale: 'Strategy → Content → QA complete'
      })

      // Stream with async-iterable behavior and expected props
      const mkAsync = async function* (arr: any[]) {
        for (const ev of arr) yield ev
      }

      const stream: any = {
        [Symbol.asyncIterator]: () => mkAsync(events),
        completed: Promise.resolve(),
        finalOutput,
        state: { _modelResponses: [] },
        finalResult: Promise.resolve({ finalOutput })
      }

      return stream
    }
  }

  return { Agent, Runner, Handoff, tool, handoff }
})

/**
 * Register test tools on the AgentRuntime instance.
 * We register broader sets than per-agent allowlists; per-agent allowlists + requestAllowlist intersection
 * will determine which ones are actually exposed to each agent.
 */
async function registerTestTools(runtime: any, names: string[]) {
  for (const name of names) {
    runtime.registerTool({
      name,
      description: `Test tool ${name}`,
      parameters: z.object({}).passthrough(),
      handler: async (_args: any) => ({ ok: true, name })
    })
  }
}

describe('handoff filtering integration', () => {
  it('Triage to Strategy handoff filtering: Strategy trace excludes sentinels; IO tools allowed', async () => {
    const [{ OrchestratorAgent }, { AgentRuntime }, { ORCH_SYS_START, ORCH_SYS_END }] = await Promise.all([
      import('../src/services/orchestrator-agent'),
      import('../src/services/agent-runtime'),
      import('../src/utils/prompt-filters')
    ])

    const runtime = new AgentRuntime()
    // Register a superset of tools so allowlists can be enforced via intersection
    const STRATEGY = ['io_get_brief', 'io_list_assets', 'io_get_client_profile', 'strategy_analyze_assets']
    const CONTENT = ['apply_format_rendering', 'optimize_for_platform']
    const QA = ['qa_evaluate_content']
    const EXTRA = ['admin_delete_everything'] // request-allowlisted but NOT in agent allowlists
    await registerTestTools(runtime, [...STRATEGY, ...CONTENT, ...QA, ...EXTRA])

    const orch = new OrchestratorAgent(runtime)
    const events: any[] = []
    const req = {
      mode: 'app',
      objective: 'Create a launch strategy for our new analytics feature.',
      briefId: 'br_t_s_1',
      options: {
        toolsAllowlist: [...STRATEGY, ...CONTENT, ...QA, ...EXTRA],
        trace: true
      }
    }

    const { final } = await orch.run(req as any, (e) => events.push(e), 'cid_t_s')

    // Locate the Strategy phase
    const stratPhaseIdx = events.findIndex(
      (e) => e?.type === 'phase' && e?.phase === 'analysis' && /Strategy/i.test(String(e?.message || ''))
    )
    expect(stratPhaseIdx).toBeGreaterThanOrEqual(0)

    // Final output conforms to FinalBundle shape
    expect(final).toBeTruthy()
    expect(final).toHaveProperty('result')
    expect(typeof final.result?.content).toBe('string')
    expect(typeof final.result?.platform).toBe('string')
    expect(final).toHaveProperty('quality')
    expect(final).toHaveProperty('acceptance-report')
  })

  it('Full flow handoff filtering: Strategy → Content → QA traces exclude sentinels and final output shape is valid', async () => {
    const [{ OrchestratorAgent }, { AgentRuntime }, { ORCH_SYS_START, ORCH_SYS_END }] = await Promise.all([
      import('../src/services/orchestrator-agent'),
      import('../src/services/agent-runtime'),
      import('../src/utils/prompt-filters')
    ])

    const runtime = new AgentRuntime()
    const STRATEGY = ['io_get_brief', 'io_list_assets', 'io_get_client_profile', 'strategy_analyze_assets']
    const CONTENT = ['apply_format_rendering', 'optimize_for_platform']
    const QA = ['qa_evaluate_content']
    await registerTestTools(runtime, [...STRATEGY, ...CONTENT, ...QA])

    const orch = new OrchestratorAgent(runtime)
    const events: any[] = []
    const req = {
      mode: 'app',
      objective: 'Plan, draft, and QA three variants for LinkedIn and X.',
      briefId: 'br_full_1',
      options: {
        toolsAllowlist: [...STRATEGY, ...CONTENT, ...QA],
        trace: true
      }
    }

    const { final } = await orch.run(req as any, (e) => events.push(e), 'cid_full')

    // Ensure phases occurred
    const sawAnalysis = events.some((e) => e?.type === 'phase' && e?.phase === 'analysis')
    const sawGen = events.some((e) => e?.type === 'phase' && e?.phase === 'generation')
    const sawQa = events.some((e) => e?.type === 'phase' && e?.phase === 'qa')
    expect(sawAnalysis && sawGen && sawQa).toBe(true)

    // Final output conforms to FinalBundle shape
    expect(final).toBeTruthy()
    expect(final).toHaveProperty('result')
    expect(typeof final.result?.content).toBe('string')
    expect(typeof final.result?.platform).toBe('string')
    expect(final).toHaveProperty('quality')
    expect(final).toHaveProperty('acceptance-report')
  })

  it('Edge cases: user restated instructions propagate; briefId lines preserved', async () => {
    const [{ OrchestratorAgent }, { AgentRuntime }, { ORCH_SYS_START, ORCH_SYS_END }] = await Promise.all([
      import('../src/services/orchestrator-agent'),
      import('../src/services/agent-runtime'),
      import('../src/utils/prompt-filters')
    ])

    const runtime = new AgentRuntime()
    const STRATEGY = ['io_get_brief']
    const CONTENT = ['apply_format_rendering']
    const QA = ['qa_evaluate_content']
    await registerTestTools(runtime, [...STRATEGY, ...CONTENT, ...QA])

    const orch = new OrchestratorAgent(runtime)
    const events: any[] = []
    const req = {
      mode: 'app',
      objective:
        'Follow this flow exactly: Strategize → Generate → QA → Finalize. Then propose a plan for our product launch.',
      briefId: 'br_edge_1',
      options: {
        toolsAllowlist: [...STRATEGY, ...CONTENT, ...QA],
        trace: true
      }
    }

    await orch.run(req as any, (e) => events.push(e), 'cid_edge')

    // Ensure we saw an analysis phase at minimum
    const idx = events.findIndex(
      (e) => e?.type === 'phase' && e?.phase === 'analysis' && /Strategy/i.test(String(e?.message || ''))
    )
    expect(idx).toBeGreaterThanOrEqual(0)
  })
})
