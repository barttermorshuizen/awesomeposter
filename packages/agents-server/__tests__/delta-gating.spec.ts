// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

// Mock the OpenAI Agents SDK to support streaming deltas for Content/QA only
vi.mock('@openai/agents', () => {
  class Agent { constructor(public opts: any) { this.name = opts?.name || 'Agent'; this.tools = opts?.tools || [] } name: string; tools: any[] }
  class Runner {
    model: string
    constructor(opts: any) { this.model = opts?.model }
    async run(agent: any, _prompt: string, opts?: any) {
      const name = String(agent?.name || '')
      const isStream = opts?.stream === true
      const isDeltaAgent = /Content Generator|Quality Assurance/i.test(name)
      if (isStream && isDeltaAgent) {
        const chunks = ['part-1 ', 'part-2 ', 'part-3']
        const toTextStream = () => ({
          [Symbol.asyncIterator]: async function* () { for (const c of chunks) yield c }
        })
        return {
          toTextStream,
          completed: Promise.resolve(),
          finalResult: Promise.resolve({ finalOutput: 'final streamed output' })
        } as any
      }
      return { finalOutput: JSON.stringify({ ok: true, agent: name }) }
    }
  }
  const tool = (def: any) => ({ ...def })
  return { Agent, Runner, tool }
})

describe('delta gating: deltas only during generation/qa', () => {
  it('emits delta frames only between generation and finalization phases', async () => {
    const [{ OrchestratorAgent }, { AgentRuntime }] = await Promise.all([
      import('../src/services/orchestrator-agent'),
      import('../src/services/agent-runtime')
    ])

    // Seed the planner to schedule strategy → generation → qa → finalize
    ;(AgentRuntime as any).prototype.runChat = vi.fn(async () => ({
      content: JSON.stringify({ stepsAdd: [
        { id: 's1', capabilityId: 'strategy', status: 'pending' },
        { id: 'g1', capabilityId: 'generation', status: 'pending' },
        { id: 'q1', capabilityId: 'qa', status: 'pending' },
        { id: 'f1', action: 'finalize', status: 'pending' }
      ] })
    }))

    const runtime = new AgentRuntime()
    const orch = new OrchestratorAgent(runtime)
    const events: any[] = []
    const req = { mode: 'app', objective: 'Test delta gating.' }
    await orch.run(req as any, (e) => events.push(e), 'cid_delta')

    const idxGen = events.findIndex((e) => e?.type === 'phase' && e?.phase === 'generation')
    const idxQa = events.findIndex((e) => e?.type === 'phase' && e?.phase === 'qa')
    const idxFin = events.findIndex((e) => e?.type === 'phase' && e?.phase === 'finalization')
    expect(idxGen).toBeGreaterThanOrEqual(0)
    expect(idxQa).toBeGreaterThanOrEqual(0)
    expect(idxFin).toBeGreaterThan(idxQa)

    const deltaIdxs = events.map((e, i) => ({ e, i })).filter((x) => x.e?.type === 'delta').map((x) => x.i)
    expect(deltaIdxs.length).toBeGreaterThan(0)
    // No deltas before generation phase
    expect(Math.min(...deltaIdxs)).toBeGreaterThanOrEqual(idxGen)
    // No deltas after finalization phase appears
    expect(Math.max(...deltaIdxs)).toBeLessThan(idxFin)
  })
})

