// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { getApprovalStore } from '../src/services/approval-store'
import { RESUME_STORE } from '../src/services/orchestrator-engine'

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
  const approvalStore = getApprovalStore()

  beforeEach(async () => {
    const mod = await import('@openai/agents') as { __clearAgentResponses: () => void }
    mod.__clearAgentResponses()
    approvalStore.clear()
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

  it('pauses execution on approval wait until a decision arrives', async () => {
    const originalFlag = process.env.ENABLE_HITL_APPROVALS
    process.env.ENABLE_HITL_APPROVALS = 'true'

    try {
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

      let generationCall = 0
      const generationPrompts: string[] = []
      __setAgentResponse('Content Generator', (prompt: string) => {
        generationPrompts.push(prompt)
        generationCall += 1
        if (generationCall === 1) {
          return { finalOutput: 'IPO Hook\n\nOur IPO guarantees 100% returns for every investor. {{CTA}}' }
        }
        expect(prompt).toMatch(/reviewerNotes/)
        return { finalOutput: 'Updated post with compliant messaging.' }
      })

      let qaCall = 0
      __setAgentResponse('Quality Assurance', () => {
        qaCall += 1
        if (qaCall === 1) {
          return {
            finalOutput: JSON.stringify({
              compliance: false,
              brandRisk: 0.6,
              composite: 0.62,
              contentRecommendations: ['Needs legal review before publishing']
            })
          }
        }
        return {
          finalOutput: JSON.stringify({
            compliance: true,
            brandRisk: 0.1,
            composite: 0.85,
            contentRecommendations: []
          })
        }
      })

      const orch = new OrchestratorAgent(runtime)
      const events: any[] = []
      const req = {
        mode: 'app',
        objective: 'Plan IPO announcement with aggressive targets.',
        threadId: 'thread_hitl_wait',
        options: {
          toolsAllowlist: [...STRATEGY_TOOLS, ...CONTENT_TOOLS, ...QA_TOOLS]
        }
      }

      const runPromise = orch.run(req as any, (e) => events.push(e), 'cid_wait')

      await new Promise((resolve) => setTimeout(resolve, 5))

      const pending = approvalStore.listByThread('thread_hitl_wait')
      expect(pending).toHaveLength(1)
      const checkpointId = pending[0]!.checkpointId

      const sawApprovalPhase = events.some((e) => e?.type === 'phase' && e?.phase === 'approval')
      expect(sawApprovalPhase).toBe(true)

      approvalStore.resolve(checkpointId, { status: 'rejected', decidedBy: 'qa_lead', decisionNotes: 'Remove absolute guarantees.' })

      const { final } = await runPromise

      expect(generationPrompts.length).toBeGreaterThanOrEqual(2)
      expect(generationPrompts[generationPrompts.length - 1]).toMatch(/reviewerNotes/)
      expect(final?.result?.content).toBe('Updated post with compliant messaging.')

      const decisionEvent = events.find((e) => e?.type === 'message' && e?.message === 'approval_decision')
      expect(decisionEvent?.data?.status).toBe('rejected')
      expect(decisionEvent?.data?.checkpointId).toBe(checkpointId)

      const replanPatch = events
        .filter((e) => e?.type === 'plan_update')
        .some((evt) => {
          const add = evt?.data?.patch?.stepsAdd as any[] | undefined
          return Array.isArray(add) && add.some((step) => step?.capabilityId === 'generation' && /approval/i.test(String(step?.note || '')))
        })
      expect(replanPatch).toBe(true)


    } finally {
      process.env.ENABLE_HITL_APPROVALS = originalFlag
      approvalStore.clear()
    }
  })

  it('finalizes immediately when rejection behavior is finalize', async () => {
    const originalFlag = process.env.ENABLE_HITL_APPROVALS
    process.env.ENABLE_HITL_APPROVALS = 'true'

    try {
      const [{ OrchestratorAgent }, { AgentRuntime }] = await Promise.all([
        import('../src/services/orchestrator-agent'),
        import('../src/services/agent-runtime')
      ])
      const { __setAgentResponse } = (await import('@openai/agents')) as {
        __setAgentResponse: (name: string, handler: (prompt: string, opts?: { stream?: boolean }) => { finalOutput?: string }) => void
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
            audience: 'Investors',
            tone: 'Formal',
            hooks: ['Growth story'],
            cta: 'Register now',
            platform: 'linkedin'
          },
          knobs: { formatType: 'text' }
        })
      }))

      let generationCall = 0
      __setAgentResponse('Content Generator', () => {
        generationCall += 1
        return { finalOutput: 'IPO Hook\n\nOur IPO guarantees 100% returns for every investor. {{CTA}}' }
      })

      let qaCall = 0
      __setAgentResponse('Quality Assurance', () => {
        qaCall += 1
        throw new Error('QA should not run when rejection finalizes the run')
      })

      const orch = new OrchestratorAgent(runtime)
      const events: any[] = []
      const req = {
        mode: 'app',
        objective: 'Plan IPO announcement with aggressive targets.',
        threadId: 'thread_hitl_finalize',
        options: {
          toolsAllowlist: [...STRATEGY_TOOLS, ...CONTENT_TOOLS, ...QA_TOOLS],
          hitlPolicy: { rejectionBehavior: 'finalize' }
        }
      }

      const runPromise = orch.run(req as any, (e) => events.push(e), 'cid_finalize')

      await new Promise((resolve) => setTimeout(resolve, 5))

      const pending = approvalStore.listByThread('thread_hitl_finalize')
      expect(pending).toHaveLength(1)
      const checkpointId = pending[0]!.checkpointId

      approvalStore.resolve(checkpointId, {
        status: 'rejected',
        decidedBy: 'legal_team',
        decisionNotes: 'Rejected pending further review.'
      })

      const { final } = await runPromise

      expect(generationCall).toBe(1)
      expect(qaCall).toBe(0)

      expect(events.some((e) => e?.type === 'warning' && e?.message === 'approval_rejected_finalized')).toBe(true)
      const decisionEvent = events.find((e) => e?.type === 'message' && e?.message === 'approval_decision')
      expect(decisionEvent?.data?.behavior).toBe('finalize')
      expect(decisionEvent?.data?.originCapabilityId).toBe('generation')

      expect(final?.result?.content).toBe('')
      expect(final?.result?.failureStatus).toBe('approval_rejected')
      expect(final?.result?.reviewerDecision?.status).toBe('rejected')
      expect(final?.result?.reviewerDecision?.checkpointId).toBe(checkpointId)
      expect(final?.['acceptance-report']?.overall).toBe(false)
      const approvalCriterion = (final?.['acceptance-report']?.criteria || []).find((c: any) => c?.criterion === 'approval_status')
      expect(approvalCriterion?.passed).toBe(false)
      expect(final?.quality?.pass).toBe(false)

      const finalizeEvent = events.find((e) => e?.type === 'plan_update' && Array.isArray(e?.data?.patch?.stepsUpdate))
      expect(finalizeEvent).toBeTruthy()
    } finally {
      process.env.ENABLE_HITL_APPROVALS = originalFlag
      approvalStore.clear()
    }
  })

  it('resumes a pending approval checkpoint from snapshot', async () => {
    const originalFlag = process.env.ENABLE_HITL_APPROVALS
    process.env.ENABLE_HITL_APPROVALS = 'true'

    const threadId = 'resume_thread'
    const checkpointId = 'approval_resume'

    const advisory = {
      severity: 'warn' as const,
      reason: 'Manual approval required',
      evidenceRefs: ['qa.brandRisk']
    }

    const pendingEntry = {
      checkpointId,
      reason: advisory.reason,
      requestedBy: 'QA Specialist',
      requestedAt: new Date().toISOString(),
      requiredRoles: [],
      evidenceRefs: advisory.evidenceRefs || [],
      advisory,
      status: 'waiting',
      threadId
    }

    RESUME_STORE.set(threadId, {
      plan: {
        version: 1,
        steps: [
          { id: checkpointId, action: 'approval.wait' as any, status: 'pending', note: 'Await human approval' },
          { id: 'auto_finalize_1', action: 'finalize' as any, status: 'pending', note: 'Final review' }
        ]
      },
      history: [],
      runReport: { steps: [] },
      pendingApprovals: [pendingEntry],
      updatedAt: Date.now()
    } as any)

    const [{ OrchestratorAgent }, { AgentRuntime }] = await Promise.all([
      import('../src/services/orchestrator-agent'),
      import('../src/services/agent-runtime')
    ])

    const orch = new OrchestratorAgent(new AgentRuntime())
    const events: any[] = []

    const runPromise = orch.run({
      mode: 'app',
      objective: 'Resume approval checkpoint',
      threadId,
      options: { toolsAllowlist: [] }
    } as any, (e) => events.push(e), 'cid_resume')

    setTimeout(() => {
      approvalStore.resolve(checkpointId, { status: 'approved', decidedBy: 'qa_lead', decisionNotes: 'All good' })
    }, 5)

    const { final } = await runPromise

    expect(events.some((e) => e?.type === 'phase' && e?.phase === 'approval')).toBe(true)
    const decisionEvent = events.find((e) => e?.type === 'message' && e?.message === 'approval_decision')
    expect(decisionEvent?.data?.status).toBe('approved')
    expect(decisionEvent?.data?.checkpointId).toBe(checkpointId)
    expect(approvalStore.listByThread(threadId)[0]?.status).toBe('approved')
    expect(final).toBeTruthy()

    approvalStore.clear()
    RESUME_STORE.delete(threadId)
    process.env.ENABLE_HITL_APPROVALS = originalFlag
  })

})
