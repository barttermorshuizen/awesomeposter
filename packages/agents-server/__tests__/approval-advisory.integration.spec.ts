// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const responseRegistry = vi.hoisted(() => new Map<string, (prompt: string, opts?: { stream?: boolean }) => { finalOutput?: string; streamChunks?: string[] }>)

vi.mock('@openai/agents', () => {
  class Agent {
    name: string
    instructions: string
    tools: any[]
    constructor(opts: any = {}) {
      this.name = opts.name || 'Agent'
      this.instructions = opts.instructions || ''
      this.tools = Array.isArray(opts.tools) ? opts.tools : []
    }
  }

  class Handoff {
    constructor(public targetAgent: any, public options?: any) {}
  }

  const tool = (def: any) => ({ ...def })
  const handoff = (target: any, options?: any) => new Handoff(target, options)

  class Runner {
    model: string | undefined
    constructor(opts?: { model?: string }) {
      this.model = opts?.model
    }

    async run(agent: any, _prompt: string, opts?: { stream?: boolean }) {
      const handler = responseRegistry.get(agent?.name || '')
      const res = handler ? handler(_prompt, opts) : {}
      const finalOutput = typeof res?.finalOutput === 'string' ? res.finalOutput : ''
      if (opts?.stream) {
        const chunks = res?.streamChunks && res.streamChunks.length > 0 ? res.streamChunks : [finalOutput]
        const textStream = {
          async *[Symbol.asyncIterator]() {
            for (const chunk of chunks) {
              if (typeof chunk === 'string' && chunk.length > 0) {
                yield chunk
              }
            }
          }
        }
        return {
          toTextStream: () => textStream,
          completed: Promise.resolve(),
          finalResult: Promise.resolve({ finalOutput }),
          state: { _modelResponses: [] }
        }
      }
      return { finalOutput }
    }
  }

  return {
    Agent,
    Runner,
    Handoff,
    tool,
    handoff,
    __setAgentResponse: (name: string, handler: (prompt: string, opts?: { stream?: boolean }) => { finalOutput?: string; streamChunks?: string[] }) => {
      responseRegistry.set(name, handler)
    },
    __clearAgentResponses: () => responseRegistry.clear()
  }
})

async function registerTestTools(runtime: any, names: string[]) {
  for (const name of names) {
    runtime.registerTool({
      name,
      description: `Test tool ${name}`,
      parameters: z.object({}).passthrough(),
      handler: async () => ({ ok: true, name })
    })
  }
}

describe('human-in-the-loop advisory integration', () => {
  beforeEach(async () => {
    const mod = await import('@openai/agents') as { __clearAgentResponses: () => void }
    mod.__clearAgentResponses()
  })

  it('captures advisory metadata from strategy, generation, and QA steps', async () => {
    const [{ OrchestratorAgent }, { AgentRuntime }] = await Promise.all([
      import('../src/services/orchestrator-agent'),
      import('../src/services/agent-runtime')
    ])
    const { __setAgentResponse } = (await import('@openai/agents')) as {
      __setAgentResponse: (name: string, handler: (prompt: string, opts?: { stream?: boolean }) => { finalOutput?: string; streamChunks?: string[] }) => void
    }

    const runtime = new AgentRuntime()
    const STRATEGY_TOOLS = ['strategy_analyze_assets', 'strategy_plan_knobs']
    const CONTENT_TOOLS = ['apply_format_rendering', 'optimize_for_platform']
    const QA_TOOLS = ['qa_evaluate_content']
    await registerTestTools(runtime, [...STRATEGY_TOOLS, ...CONTENT_TOOLS, ...QA_TOOLS])

    __setAgentResponse('Orchestrator', () => ({
      finalOutput: JSON.stringify({
        stepsAdd: [
          { id: 'strategy_1', capabilityId: 'strategy', status: 'pending', note: 'Strategy plan' },
          { id: 'generation_1', capabilityId: 'generation', status: 'pending', note: 'Draft content' },
          { id: 'qa_1', capabilityId: 'qa', status: 'pending', note: 'QA review' }
        ]
      })
    }))

    __setAgentResponse('Strategy Manager', () => ({
      finalOutput: JSON.stringify({
        rationale: 'IPO requires cautious messaging.',
        writerBrief: {
          clientName: 'Acme Corp',
          audience: '',
          tone: '',
          hooks: [],
          cta: '',
          platform: 'linkedin'
        },
        knobs: { formatType: 'text' }
      })
    }))

    __setAgentResponse('Content Generator', () => ({
      finalOutput: 'IPO Hook\n\nOur IPO guarantees 100% returns for every investor. {{CTA}}'
    }))

    __setAgentResponse('Quality Assurance', () => ({
      finalOutput: JSON.stringify({
        compliance: false,
        brandRisk: 0.6,
        composite: 0.62,
        contentRecommendations: ['Needs legal review before publishing']
      })
    }))

    const orch = new OrchestratorAgent(runtime)
    const events: any[] = []
    const req = {
      mode: 'app',
      objective: 'Prepare IPO announcement with aggressive targets.',
      options: {
        toolsAllowlist: [...STRATEGY_TOOLS, ...CONTENT_TOOLS, ...QA_TOOLS]
      }
    }

    await orch.run(req as any, (e) => events.push(e), 'cid_hitl')

    const runReportEvent = events.find((e) => e?.type === 'message' && e?.message === 'run_report')
    expect(runReportEvent).toBeTruthy()
    const steps = Array.isArray(runReportEvent?.data?.steps) ? runReportEvent.data.steps : []

    const strategyStep = steps.find((s: any) => s?.metrics?.capabilityId === 'strategy')
    const generationStep = steps.find((s: any) => s?.metrics?.capabilityId === 'generation')
    const qaStep = steps.find((s: any) => s?.metrics?.capabilityId === 'qa')

    expect(strategyStep?.approvalAdvisory?.severity).toBe('block')
    expect(strategyStep?.approvalAdvisory?.suggestedRoles).toContain('legal')

    expect(generationStep?.approvalAdvisory?.severity).toBe('block')
    expect(generationStep?.approvalAdvisory?.autoEscalate).toBe(true)

    expect(qaStep?.approvalAdvisory?.severity).toBe('block')
    expect(qaStep?.approvalAdvisory?.suggestedRoles).toContain('compliance')
  })
})
