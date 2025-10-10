// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resetHitlRepository } from '../src/services/hitl-repository'
import { registerHitlTools } from '../src/tools/hitl'

vi.mock('@openai/agents', () => {
  class Agent {
    name: string
    tools: any[]
    constructor(opts: any) {
      this.name = opts?.name || 'Agent'
      this.tools = opts?.tools || []
    }
  }
  class Runner {
    model: string
    constructor(opts: any) {
      this.model = opts?.model
    }
    async run(agent: any, _prompt: string, opts?: any) {
      const useStream = opts?.stream === true
      if (useStream) {
        return {
          toTextStream: () => ({
            [Symbol.asyncIterator]: async function* () { /* no deltas */ }
          }),
          completed: Promise.resolve(),
          finalResult: Promise.resolve({ finalOutput: '' })
        }
      }
      const tool = Array.isArray(agent?.tools)
        ? agent.tools.find((t: any) => t?.name === 'hitl_request')
        : undefined
      if (tool) {
        await tool.execute({
          question: 'Which hook should we use?',
          kind: 'choice',
          options: [
            { id: 'hook_a', label: 'Hook A' },
            { id: 'hook_b', label: 'Hook B' }
          ],
          allowFreeForm: false,
          urgency: 'normal'
        })
      }
      return { finalOutput: JSON.stringify({ ok: true }) }
    }
  }
  const tool = (def: any) => ({ ...def })
  return { Agent, Runner, tool }
})

describe('orchestrator HITL handling', () => {
  beforeEach(() => {
    resetHitlRepository()
  })

  it('emits pending completion when a specialist raises a HITL request', async () => {
    const [{ OrchestratorAgent }, { AgentRuntime }] = await Promise.all([
      import('../src/services/orchestrator-agent'),
      import('../src/services/agent-runtime')
    ])

    ;(AgentRuntime as any).prototype.runChat = vi.fn(async () => ({
      content: JSON.stringify({
        stepsAdd: [
          { id: 's1', capabilityId: 'strategy', status: 'pending', note: 'Strategy pass' },
          { id: 'f1', action: 'finalize', status: 'pending', note: 'Finalize' }
        ]
      })
    }))

    const runtime = new AgentRuntime()
    registerHitlTools(runtime)
    const orch = new OrchestratorAgent(runtime)
    const events: any[] = []
    await orch.run({ mode: 'app', objective: 'Need HITL', threadId: 'th_hitl_test' } as any, (e) => events.push(e), 'cid_hitl')

    const hitlEvent = events.find((e) => e?.type === 'message' && e?.message === 'hitl_request')
    expect(hitlEvent).toBeTruthy()
    const complete = events.find((e) => e?.type === 'complete')
    expect(complete).toBeTruthy()
    expect(complete?.data?.status).toBe('pending_hitl')
    expect(complete?.data?.pendingRequestId).toBeDefined()
  })
})
