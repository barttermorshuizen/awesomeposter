// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import type { FlexEvent, TaskEnvelope } from '@awesomeposter/shared'
import { FlexRunCoordinator } from '../src/services/flex-run-coordinator'
import type { FlexPlan, FlexPlanNode } from '../src/services/flex-planner'
import type { FlexPlanNodeSnapshot } from '../src/services/orchestrator-persistence'
import { PolicyNormalizer } from '../src/services/policy-normalizer'

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
      policies: { planner: undefined, runtime: [] },
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
          status: 'pending',
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
            instructions: []
          } as any,
          contracts: {
            output: { mode: 'json_schema', schema: { type: 'object' } }
          },
          facets: { input: ['objectiveBrief'], output: ['copyVariants'] },
          provenance: { input: [], output: [] },
          rationale: [],
          metadata: { derived: false, plannerStage: 'execution' }
        },
        {
          id: 'node-2',
          status: 'pending',
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
            instructions: []
          } as any,
          contracts: {
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

  it('preserves snapshot ordering when rehydrating a plan', () => {
    const coordinator = new FlexRunCoordinator(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      new PolicyNormalizer(),
      new Map()
    )
    const envelope: TaskEnvelope = {
      objective: 'Rehydrate',
      outputContract: { mode: 'json_schema', schema: { type: 'object' } }
    } as TaskEnvelope
    const existingNodes: FlexPlanNodeSnapshot[] = [
      {
        nodeId: 'copywriter_SocialpostDrafting_2',
        capabilityId: 'copywriter.SocialpostDrafting',
        label: 'Copywriter',
        status: 'running',
        context: null,
        output: null,
        error: null,
        facets: null,
        contracts: null,
        provenance: null,
        metadata: null,
        rationale: null,
        executor: null
      },
      {
        nodeId: 'strategist_SocialPosting_1',
        capabilityId: 'strategist.SocialPosting',
        label: 'Strategist',
        status: 'completed',
        context: null,
        output: null,
        error: null,
        facets: null,
        contracts: null,
        provenance: null,
        metadata: null,
        rationale: null,
        executor: null
      },
      {
        nodeId: 'designer_VisualDesign_3',
        capabilityId: 'designer.VisualDesign',
        label: 'Designer',
        status: 'pending',
        context: null,
        output: null,
        error: null,
        facets: null,
        contracts: null,
        provenance: null,
        metadata: null,
        rationale: null,
        executor: null
      }
    ]

    const plan = (coordinator as any).rehydratePlan(
      {
        run: {
          runId: 'flex_resume_order',
          envelope,
          status: 'awaiting_hitl',
          schemaHash: null,
          metadata: null,
          result: null,
          planVersion: 3
        },
        nodes: existingNodes
      },
      envelope,
      {
        runId: 'flex_resume_order',
        planVersion: 3,
        snapshot: {
          nodes: [
            { nodeId: 'strategist_SocialPosting_1', status: 'completed', metadata: { plannerStage: 'structuring' } },
            { nodeId: 'copywriter_SocialpostDrafting_2', status: 'running', metadata: { plannerStage: 'execution' } },
            { nodeId: 'designer_VisualDesign_3', status: 'pending', metadata: { plannerStage: 'transformation' } }
          ],
          edges: [
            { from: 'strategist_SocialPosting_1', to: 'copywriter_SocialpostDrafting_2', reason: 'sequence' },
            { from: 'copywriter_SocialpostDrafting_2', to: 'designer_VisualDesign_3', reason: 'sequence' }
          ],
          metadata: {}
        },
        facets: null,
        schemaHash: null,
        pendingNodeIds: ['copywriter_SocialpostDrafting_2', 'designer_VisualDesign_3'],
        createdAt: null,
        updatedAt: null
      }
    )

    expect(plan.nodes.map((node: FlexPlanNode) => node.id)).toEqual([
      'strategist_SocialPosting_1',
      'copywriter_SocialpostDrafting_2',
      'designer_VisualDesign_3'
    ])
  })
})
