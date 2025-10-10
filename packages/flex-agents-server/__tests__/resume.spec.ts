// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { InMemoryOrchestratorPersistence, setOrchestratorPersistence, getOrchestratorPersistence } from '../src/services/orchestrator-persistence'
import { InMemoryHitlRepository, setHitlRepository, resetHitlRepository } from '../src/services/hitl-repository'
import { resetHitlService } from '../src/services/hitl-service'

describe('threadId-based resume restores plan/history', () => {
  beforeEach(() => {
    setOrchestratorPersistence(new InMemoryOrchestratorPersistence() as any)
    resetHitlRepository()
    setHitlRepository(new InMemoryHitlRepository())
    resetHitlService()
  })

  it('stores run state under threadId and resumes on subsequent call', async () => {
    const [{ OrchestratorAgent }, { AgentRuntime }] = await Promise.all([
      import('../src/services/orchestrator-agent'),
      import('../src/services/agent-runtime')
    ])

    ;(AgentRuntime as any).prototype.runChat = vi.fn(async () => ({
      content: JSON.stringify({ stepsAdd: [{ id: 'f1', action: 'finalize', status: 'pending' }] })
    }))

    const runtime = new AgentRuntime()
    const orch = new OrchestratorAgent(runtime)
    const threadId = 'th_resume_1'

    const events1: any[] = []
    await orch.run({ mode: 'app', objective: 'First run', threadId } as any, (e) => events1.push(e), 'cid_r1')

    const persistence = getOrchestratorPersistence() as InMemoryOrchestratorPersistence
    await persistence.save(threadId, {
      plan: {
        version: 1,
        steps: [
          { id: 'resume_step', capabilityId: 'strategy', status: 'pending', note: 'Resume pending' }
        ]
      },
      status: 'running'
    })

    const events2: any[] = []
    await orch.run({ mode: 'app', objective: 'Second run', threadId } as any, (e) => events2.push(e), 'cid_r2')
    const resumedMsg = events2.find((e) => e?.type === 'message' && /Resuming existing thread state/i.test(String(e?.message || '')))
    expect(resumedMsg).toBeTruthy()
  })
})
