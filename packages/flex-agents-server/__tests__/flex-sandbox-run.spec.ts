// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import type { FlexEvent, TaskEnvelope, FlexPlan } from '@awesomeposter/shared'
import { FlexRunCoordinator } from '../src/services/flex-run-coordinator'

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

class StubPlanner {
  constructor(private readonly plan: FlexPlan) {}

  async buildPlan() {
    return this.plan
  }
}

class StubEngine {
  async execute(runId: string, _envelope: TaskEnvelope, _plan: FlexPlan, opts: any) {
    await opts.onEvent({
      type: 'complete',
      timestamp: new Date().toISOString(),
      runId,
      payload: { output: { ok: true } }
    })
    return { runId, status: 'completed', output: { ok: true } }
  }
}

class StubHitlService {
  getMaxRequestsPerRun() {
    return 3
  }

  async loadRunState() {
    return { requests: [], responses: [], pendingRequestId: null, deniedCount: 0 }
  }

  async raiseRequest() {
    return { status: 'pending', request: { id: 'req', runId: 'run', threadId: 'thread', payload: {} } }
  }
}

describe('FlexRunCoordinator sandbox emission', () => {
  it('emits plan metadata suitable for sandbox inspector', async () => {
    const envelope: TaskEnvelope = {
      objective: 'Validate plan stream',
      inputs: {},
      policies: { runtime: [] },
      specialInstructions: [],
      outputContract: { mode: 'json_schema', schema: { type: 'object', additionalProperties: true } }
    }

    const plan: FlexPlan = {
      runId: 'run-test',
      version: 1,
      createdAt: new Date().toISOString(),
      nodes: [
        {
          id: 'node-1',
          kind: 'execution',
          capabilityId: 'writer.v1',
          capabilityLabel: 'Writer',
          capabilityVersion: '1.0',
          derivedCapability: undefined,
          label: 'Draft content',
          bundle: {
            runId: 'run-test',
            nodeId: 'node-1',
            objective: envelope.objective,
            instructions: [],
            contract: {
              output: { mode: 'json_schema', schema: { type: 'object' } }
            }
          } as any,
          contracts: {
            input: undefined,
            output: { mode: 'json_schema', schema: { type: 'object' } }
          },
          facets: { input: ['objectiveBrief'], output: ['copyVariants'] },
          provenance: { input: [], output: [] },
          rationale: [],
          metadata: { derived: false, plannerStage: 'execution' }
        },
        {
          id: 'node-2',
          kind: 'validation',
          capabilityId: 'qa.v1',
          capabilityLabel: 'QA Agent',
          capabilityVersion: '1.0',
          derivedCapability: { fromCapabilityId: 'writer.v1' },
          label: 'QA review',
          bundle: {
            runId: 'run-test',
            nodeId: 'node-2',
            objective: envelope.objective,
            instructions: [],
            contract: {
              output: { mode: 'json_schema', schema: { type: 'object' } }
            }
          } as any,
          contracts: {
            input: undefined,
            output: { mode: 'json_schema', schema: { type: 'object' } }
          },
          facets: { input: ['copyVariants'], output: ['qaFindings'] },
          provenance: { input: [], output: [] },
          rationale: [],
          metadata: { derived: true, plannerStage: 'validation' }
        }
      ],
      edges: [],
      metadata: {
        variantCount: 1,
        plannerContext: {
          channel: 'sandbox',
          platform: null,
          formats: ['sandbox'],
          languages: [],
          audiences: [],
          tags: [],
          specialInstructions: []
        },
        plannerAttempts: 1
      }
    }

    const events: FlexEvent[] = []
    const coordinator = new FlexRunCoordinator(
      new StubPersistence() as any,
      new StubPlanner(plan) as any,
      new StubEngine() as any,
      new StubHitlService() as any
    )

    await coordinator.run(envelope, {
      correlationId: 'corr-1',
      onEvent: async (event: FlexEvent) => {
        events.push(event)
      }
    })

    const generated = events.find((evt) => evt.type === 'plan_generated')
    expect(generated).toBeTruthy()
    const planPayload = (generated?.payload as any)?.plan
    expect(planPayload).toBeTruthy()
    expect(planPayload).toMatchObject({
      metadata: expect.objectContaining({
        plannerAttempts: 1,
        plannerContext: expect.objectContaining({ channel: 'sandbox' })
      }),
      nodes: [
        expect.objectContaining({
          id: 'node-1',
          kind: 'execution',
          status: 'pending',
          facets: { input: ['objectiveBrief'], output: ['copyVariants'] },
          metadata: expect.objectContaining({ plannerStage: 'execution' })
        }),
        expect.objectContaining({
          id: 'node-2',
          derivedCapability: { fromCapabilityId: 'writer.v1' },
          metadata: expect.objectContaining({ derived: true })
        })
      ]
    })
  })
})
