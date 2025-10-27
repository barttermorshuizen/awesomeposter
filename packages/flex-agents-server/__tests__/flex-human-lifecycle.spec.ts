// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import type { FlexEvent, TaskEnvelope } from '@awesomeposter/shared'
import { FlexExecutionEngine, AwaitingHumanInputError } from '../src/services/flex-execution-engine'
import { FlexPlanner } from '../src/services/flex-planner'
import { HUMAN_CLARIFY_CAPABILITY, HUMAN_CLARIFY_CAPABILITY_ID } from '../src/agents/human-clarify-brief'

class InMemoryFlexPersistence {
  statuses = new Map<string, string>()
  snapshots = new Map<string, any>()
  nodes = new Map<string, any>()

  async createOrUpdateRun(record: { runId: string; envelope: TaskEnvelope; status: string; metadata?: Record<string, unknown> | null }) {
    this.statuses.set(record.runId, record.status)
  }

  async markNode(runId: string, nodeId: string, updates: any) {
    const key = `${runId}:${nodeId}`
    const current = this.nodes.get(key) ?? { runId, nodeId }
    this.nodes.set(key, { ...current, ...updates })
  }

  async savePlanSnapshot(runId: string, planVersion: number, nodes: any[], options: any = {}) {
    this.snapshots.set(runId, {
      planVersion,
      snapshot: {
        nodes,
        pendingState: options.pendingState ?? null
      }
    })
  }

  async updateStatus(runId: string, status: string) {
    this.statuses.set(runId, status)
  }

  async saveRunContext() {
    // noop for test
  }
}

describe('FlexExecutionEngine human lifecycle', () => {
  it('pauses and surfaces assignment metadata for human executor nodes', async () => {
    const persistence = new InMemoryFlexPersistence()
    const runtime = { runStructured: vi.fn() }
    const capabilityRegistry = {
      async getSnapshot() {
        const active = [HUMAN_CLARIFY_CAPABILITY]
        return { active, all: active }
      },
      async getCapabilityById(id: string) {
        if (id === HUMAN_CLARIFY_CAPABILITY.capabilityId) return HUMAN_CLARIFY_CAPABILITY
        return undefined
      }
    }

   const plannerService = {
     async proposePlan() {
       return {
         nodes: [
           {
             stage: 'clarify',
             kind: 'execution',
             capabilityId: HUMAN_CLARIFY_CAPABILITY_ID,
             inputFacets: HUMAN_CLARIFY_CAPABILITY.inputContract.mode === 'facets' ? HUMAN_CLARIFY_CAPABILITY.inputContract.facets : [],
             outputFacets: HUMAN_CLARIFY_CAPABILITY.outputContract.mode === 'facets' ? HUMAN_CLARIFY_CAPABILITY.outputContract.facets : [],
             rationale: ['Need human clarification']
           }
         ]
       }
     }
   }

    const validationService = {
      validate: () => ({ ok: true, diagnostics: [] })
    }

    const planner = new FlexPlanner(
      {
        capabilityRegistry: capabilityRegistry as any,
        plannerService: plannerService as any,
        validationService: validationService as any
      }
    )

    const engine = new FlexExecutionEngine(persistence as any, {
      runtime: runtime as any,
      capabilityRegistry: capabilityRegistry as any
    })

    const runId = 'run_human_1'
    const envelope: TaskEnvelope = {
      objective: 'Clarify client brief',
      inputs: {
        objectiveBrief: {
          goal: 'Understand missing details'
        },
        audienceProfile: {
          persona: 'Strategist'
        },
        toneOfVoice: 'confident',
        writerBrief: {
          summary: 'Draft copy information'
        },
        clarificationRequest: {
          fields: ['budget', 'timeline']
        }
      },
      outputContract: HUMAN_CLARIFY_CAPABILITY.outputContract
    }

    await persistence.createOrUpdateRun({ runId, envelope, status: 'pending' })

    const plan = await planner.buildPlan(runId, envelope)

    const events: FlexEvent[] = []
    const opts = {
      onEvent: async (event: FlexEvent) => {
        events.push(event)
      },
      correlationId: 'cid_human'
    }

    await expect(
      engine.execute(runId, envelope, plan, opts)
    ).rejects.toBeInstanceOf(AwaitingHumanInputError)

    expect(persistence.statuses.get(runId)).toBe('awaiting_human')
    const snapshot = persistence.snapshots.get(runId)
    expect(snapshot?.snapshot?.pendingState?.mode).toBe('human')

    const startEvent = events.find((evt) => evt.type === 'node_start')
    expect(startEvent).toBeTruthy()
    expect((startEvent?.payload as any)?.executorType).toBe('human')
    expect((startEvent?.payload as any)?.assignment).toMatchObject({
      runId,
      nodeId: plan.nodes[0]?.id,
      role: HUMAN_CLARIFY_CAPABILITY.assignmentDefaults?.role
    })
    expect(runtime.runStructured).not.toHaveBeenCalled()
  })
})
