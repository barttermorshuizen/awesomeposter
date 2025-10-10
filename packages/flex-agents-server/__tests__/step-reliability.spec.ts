// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'

// Mock the OpenAI Agents SDK to control runner timing
vi.mock('@openai/agents', () => {
  class Agent {
    name: string
    tools: any[]
    constructor(opts: any) {
      this.name = opts?.name || 'Agent'
      this.tools = Array.isArray(opts?.tools) ? opts.tools : []
    }
  }
  class Runner {
    model: string
    constructor(opts: any) {
      this.model = opts?.model
    }
    async run(agent: any, _prompt: string, opts?: any) {
      // For generation/qa when stream=true, return a never-resolving promise to trigger timeout
      const name = agent?.name || ''
      if (opts?.stream && (/(Content|Quality)/i.test(String(name)))) {
        return new Promise((_resolve) => {})
      }
      // Non-stream path: return immediate final output
      return { finalOutput: JSON.stringify({ ok: true, agent: name }) }
    }
  }
  const tool = (def: any) => ({ ...def })
  return { Agent, Runner, tool }
})

describe('step reliability: timeouts and retries', () => {
  afterEach(() => {
    try { vi.useRealTimers() } catch {}
  })

  it('generation step times out, retries once, then proceeds best-effort with warnings and metrics', async () => {
    vi.useFakeTimers()
    const [{ OrchestratorAgent }, { AgentRuntime }] = await Promise.all([
      import('../src/services/orchestrator-agent'),
      import('../src/services/agent-runtime')
    ])

    // Stub planner to propose generation then finalize
    ;(AgentRuntime as any).prototype.runChat = vi.fn(async () => {
      return {
        content: JSON.stringify({
          stepsAdd: [
            { id: 'g1', capabilityId: 'generation', status: 'pending' },
            { id: 'f1', action: 'finalize', status: 'pending' }
          ]
        })
      }
    })

    const runtime = new AgentRuntime()
    const orch = new OrchestratorAgent(runtime)
    const events: any[] = []
    const req = { mode: 'app', objective: 'Generate a post that will timeout.' }

    const runPromise = orch.run(req as any, (e) => events.push(e), 'cid_timeout')

    // First attempt timeout
    await vi.advanceTimersByTimeAsync(35_000)
    // Second attempt timeout
    await vi.advanceTimersByTimeAsync(35_000)

    const { final } = await runPromise
    expect(final).toBeTruthy()

    const retryWarn = events.find((e) => e?.type === 'warning' && /retrying/i.test(String(e?.message || '')))
    const bestEffortWarn = events.find((e) => e?.type === 'warning' && /proceeding best-effort/i.test(String(e?.message || '')))
    const missingGenWarn = events.find((e) => e?.type === 'warning' && /No content generated/i.test(String(e?.message || '')))
    expect(retryWarn).toBeTruthy()
    expect(bestEffortWarn).toBeTruthy()
    expect(missingGenWarn).toBeTruthy()

    // Metrics frame should be emitted after the step concludes
    const metrics = events.filter((e) => e?.type === 'metrics')
    expect(metrics.length).toBeGreaterThan(0)
  })
})

