// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

describe('threadId-based resume restores plan/history', () => {
  it('stores run state under threadId and resumes on subsequent call', async () => {
    const [{ OrchestratorAgent }, { AgentRuntime }, { RESUME_STORE }] = await Promise.all([
      import('../src/services/orchestrator-agent'),
      import('../src/services/agent-runtime'),
      import('../src/services/orchestrator-engine')
    ])

    // Minimal planner to always add finalize so orchestration completes
    ;(AgentRuntime as any).prototype.runChat = vi.fn(async () => ({
      content: JSON.stringify({ stepsAdd: [ { id: 'f1', action: 'finalize', status: 'pending' } ] })
    }))

    const runtime = new AgentRuntime()
    const orch = new OrchestratorAgent(runtime)
    const threadId = 'th_resume_1'

    const events1: any[] = []
    await orch.run({ mode: 'app', objective: 'First run', threadId } as any, (e) => events1.push(e), 'cid_r1')

    // Store should have snapshot for threadId
    expect(RESUME_STORE.has(threadId)).toBe(true)
    const snap = RESUME_STORE.get(threadId) as any
    expect(snap?.plan).toBeTruthy()

    const events2: any[] = []
    await orch.run({ mode: 'app', objective: 'Second run', threadId } as any, (e) => events2.push(e), 'cid_r2')
    const resumedMsg = events2.find((e) => e?.type === 'message' && /Resuming existing thread state/i.test(String(e?.message || '')))
    expect(resumedMsg).toBeTruthy()
  })
})

