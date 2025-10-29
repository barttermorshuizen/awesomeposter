// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import type { TaskEnvelope, FlexPlan, CapabilityRecord } from '@awesomeposter/shared'
import { getMarketingCapabilitiesSnapshot } from '@awesomeposter/shared'
import { getHitlContext } from '../src/services/hitl-context'
import { resetHitlService } from '../src/services/hitl-service'
import { FlexRunCoordinator } from '../src/services/flex-run-coordinator'
import { FlexExecutionEngine } from '../src/services/flex-execution-engine'

class StubPersistence {
  async createOrUpdateRun() {}
  async updateStatus() {}
  async savePlanSnapshot() {}
  async markNode() {}
  async recordResult() {}
  async ensure() {}
  async recordPendingResult() {}
  async saveRunContext() {}
  async loadFlexRun() {
    return null
  }
  async findFlexRunByThreadId() {
    return null
  }
}

class PlannerStub {
  constructor(private readonly plan: FlexPlan) {}
  async buildPlan() {
    return this.plan
  }
}

class CapabilityRegistryStub {
  constructor(private readonly record: CapabilityRecord) {}
  async register() {
    throw new Error('not implemented')
  }
  async listActive() {
    return [this.record]
  }
  async getCapabilityById(capabilityId: string) {
    return capabilityId === this.record.capabilityId ? this.record : undefined
  }
  async getSnapshot() {
    return {
      active: [this.record],
      all: [this.record]
    }
  }
  invalidate() {}
}

class HitlRuntimeStub {
  async runStructured() {
    const ctx = getHitlContext()
    if (!ctx) throw new Error('HITL context unavailable')
    const result = await ctx.hitlService.raiseRequest({
      question: 'Requires human approval.',
      kind: 'approval'
    })
    expect(result.status).toBe('pending')
    return {}
  }
}

describe('FlexRunCoordinator hitl pause behaviour', () => {
  beforeEach(() => {
    resetHitlService()
  })

  it('pauses execution when a capability raises a hitl_request', async () => {
    const persistence = new StubPersistence()
    const runtime = new HitlRuntimeStub()

    const capability =
      getMarketingCapabilitiesSnapshot().active.find(
        (entry) => entry.capabilityId === 'strategist.SocialPosting'
      ) ?? (() => {
        throw new Error('strategist.SocialPosting capability not available')
      })()

    const registry = new CapabilityRegistryStub(capability)
    const engine = new FlexExecutionEngine(persistence as any, {
      runtime,
      capabilityRegistry: registry as any
    })

    const runId = 'run-hitl'
    const plan: FlexPlan = {
      runId,
      version: 1,
      createdAt: new Date().toISOString(),
      nodes: [
        {
          id: 'node-hitl',
          kind: 'execution',
          capabilityId: capability.capabilityId,
          capabilityLabel: capability.displayName,
          capabilityVersion: capability.version,
          derivedCapability: undefined,
          label: capability.displayName,
          bundle: {
            runId,
            nodeId: 'node-hitl',
            objective: 'Smoke test HITL pause',
            instructions: [],
            inputs: {
              post_context: {
                campaign: 'Launch',
                type: 'launch',
                summary: 'Introduce the new product.',
                audience: { persona: 'Marketing lead' },
                channels: ['linkedin']
              },
              feedback: []
            },
            policies: {},
            contract: {
              input: capability.inputContract,
              output: capability.outputContract
            }
          },
          contracts: {
            input: capability.inputContract,
            output: capability.outputContract
          },
          facets: {
            input: capability.inputFacets ?? [],
            output: capability.outputFacets ?? []
          },
          provenance: { input: [], output: [] },
          rationale: ['Exercise hitl_request tool'],
          metadata: { plannerStage: 'test' }
        }
      ],
      edges: [],
      metadata: {
        variantCount: 1,
        plannerContext: {
          channel: 'linkedin',
          platform: null,
          formats: ['short_form'],
          languages: ['en'],
          audiences: ['marketing'],
          tags: [],
          specialInstructions: []
        },
        plannerAttempts: 1
      }
    }

    const planner = new PlannerStub(plan) as any

    const coordinator = new FlexRunCoordinator(
      persistence as any,
      planner,
      engine
    )

    const envelope: TaskEnvelope = {
      objective: 'Smoke test HITL pause',
      inputs: {
        post_context: {
          campaign: 'Launch',
          type: 'launch',
          summary: 'Introduce the new product.',
          audience: {
            persona: 'Marketing lead',
            industry: 'SaaS'
          },
          channels: ['linkedin']
        },
        feedback: []
      },
      policies: {
        runtime: []
      },
      outputContract: capability.outputContract
    }

    const events: Array<{ type: string }> = []
    const result = await coordinator.run(envelope, {
      correlationId: 'cid-hitl',
      onEvent: async (event) => {
        events.push({ type: event.type })
      }
    })

    expect(result.status).toBe('awaiting_hitl')
    expect(events.some((evt) => evt.type === 'hitl_request')).toBe(true)
  })
})
