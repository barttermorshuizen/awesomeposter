// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import type { FlexPlan, FlexEvent, TaskEnvelope, GoalConditionResult, OutputContract } from '@awesomeposter/shared'
import { FlexRunCoordinator } from '../src/services/flex-run-coordinator'
import { GoalConditionFailedError } from '../src/services/flex-execution-engine'

const BASE_CONTRACT: OutputContract = {
  mode: 'json_schema',
  schema: { type: 'object', properties: {} }
}

const failureResults: GoalConditionResult[] = [
  {
    facet: 'summary',
    path: '/status',
    expression: 'status == "approved"',
    dsl: 'status == "approved"',
    jsonLogic: {
      '==': [{ var: 'status' }, 'approved']
    },
    satisfied: false,
    observedValue: 'draft'
  }
]

class PersistenceStub {
  createOrUpdateRun = vi.fn().mockResolvedValue(undefined)
  updateStatus = vi.fn().mockResolvedValue(undefined)
  savePlanSnapshot = vi.fn().mockResolvedValue(undefined)
  markNode = vi.fn().mockResolvedValue(undefined)
  recordResult = vi.fn().mockResolvedValue(undefined)
  ensure = vi.fn().mockResolvedValue(undefined)
  recordPendingResult = vi.fn().mockResolvedValue(undefined)
  saveRunContext = vi.fn().mockResolvedValue(undefined)
  loadFlexRun = vi.fn().mockResolvedValue(null)
  findFlexRunByThreadId = vi.fn().mockResolvedValue(null)
  loadPlanSnapshot = vi.fn().mockResolvedValue(null)
  recordGoalConditionCheckpoint = vi.fn().mockResolvedValue(undefined)
}

class PlannerStub {
  private version = 0

  constructor(private readonly template: FlexPlan) {}

  async buildPlan(
    runId: string,
    envelope: TaskEnvelope,
    options?: {
      onRequest?: (context: {
        runId: string
        variantCount: number
        context: Record<string, unknown>
        policies: NonNullable<TaskEnvelope['policies']>
        policyMetadata?: { legacyNotes: string[]; legacyFields: string[] }
        capabilities: unknown[]
      }) => Promise<void> | void
      policies?: TaskEnvelope['policies']
      policyMetadata?: { legacyNotes: string[]; legacyFields: string[] }
    }
  ): Promise<FlexPlan> {
    this.version += 1
    await options?.onRequest?.({
      runId,
      variantCount: 1,
      context: { objective: envelope.objective },
      policies: (options?.policies ?? envelope.policies) ?? { planner: undefined, runtime: [] },
      policyMetadata: options?.policyMetadata ?? { legacyNotes: [], legacyFields: [] },
      capabilities: []
    })
    return {
      ...this.template,
      version: this.version,
      nodes: this.template.nodes.map((node) => ({
        ...node,
        bundle: { ...node.bundle },
        contracts: { ...node.contracts },
        facets: node.facets ? { input: [...node.facets.input], output: [...node.facets.output] } : undefined,
        metadata: { ...(node.metadata ?? {}) }
      })),
      metadata: { ...(this.template.metadata ?? {}) }
    }
  }
}

class ExecutionEngineStub {
  private attempts = 0

  constructor(private readonly finalResults: GoalConditionResult[]) {}

  async execute(
    _runId: string,
    _envelope: TaskEnvelope,
    _plan: FlexPlan,
    opts: {
      onEvent: (event: FlexEvent) => Promise<void>
      runContext: { snapshot: () => { facets: Record<string, unknown>; hitlClarifications: unknown[] } }
    }
  ) {
    this.attempts += 1
    const snapshot = opts.runContext.snapshot()
    if (this.attempts === 1) {
      throw new GoalConditionFailedError({
        state: {
          completedNodeIds: [],
          nodeOutputs: {},
          facets: snapshot,
          policyActions: [],
          policyAttempts: {}
        },
        results: failureResults,
        failed: failureResults,
        finalOutput: { provisional: true }
      })
    }
    await opts.onEvent({
      type: 'complete',
      timestamp: new Date().toISOString(),
      payload: {
        status: 'completed',
        output: { ok: true },
        goal_condition_results: this.finalResults
      }
    })
    return { ok: true }
  }

  resumePending = this.execute.bind(this)
}

class HitlStub {
  getMaxRequestsPerRun() {
    return 3
  }
  async loadRunState() {
    return {
      requests: [],
      responses: [],
      pendingRequestId: null,
      deniedCount: 0
    }
  }
  async raiseRequest() {
    throw new Error('HITL not expected')
  }
  async applyResponses() {
    return {
      requests: [],
      responses: [],
      pendingRequestId: null,
      deniedCount: 0
    }
  }
}

const basePlan: FlexPlan = {
  runId: 'run-goal',
  version: 1,
  createdAt: new Date().toISOString(),
  nodes: [
    {
      id: 'node-1',
      status: 'pending',
      kind: 'execution',
      capabilityId: 'mock.capability',
      capabilityLabel: 'Mock Capability',
      capabilityVersion: '1.0.0',
      derivedCapability: undefined,
      label: 'Mock Capability',
      bundle: {
        runId: 'run-goal',
        nodeId: 'node-1',
        objective: 'Demo objective',
        instructions: [],
        contract: { output: BASE_CONTRACT }
      },
      contracts: {
        output: BASE_CONTRACT
      },
      facets: { input: [], output: [] },
      provenance: {},
      rationale: [],
      metadata: {}
    }
  ],
  edges: [],
  metadata: {}
}

const envelope: TaskEnvelope = {
  objective: 'Demo run with goal conditions',
  inputs: {},
  outputContract: BASE_CONTRACT,
  goal_condition: [
    {
      facet: 'summary',
      path: '/status',
      condition: {
        dsl: 'status == "approved"',
        canonicalDsl: 'status == "approved"',
        jsonLogic: {
          '==': [{ var: 'status' }, 'approved']
        }
      }
    }
  ]
}

describe('FlexRunCoordinator goal-condition replans', () => {
  it('replans before completion and annotates planner lifecycle metadata', async () => {
    const persistence = new PersistenceStub()
    const planner = new PlannerStub(basePlan)
    const engine = new ExecutionEngineStub([
      { ...failureResults[0], satisfied: true, observedValue: 'approved', error: undefined }
    ])
    const coordinator = new FlexRunCoordinator(
      persistence as unknown as any,
      planner as unknown as any,
      engine as unknown as any,
      new HitlStub()
    )

    const events: FlexEvent[] = []
    const result = await coordinator.run(envelope, {
      correlationId: 'goal-test',
      onEvent: async (event) => {
        events.push(event)
      }
    })

    expect(result.status).toBe('completed')
    const goalFailures = events.filter((evt) => evt.type === 'goal_condition_failed')
    expect(goalFailures).toHaveLength(1)
    expect((goalFailures[0]?.payload as any).failedGoalConditions).toHaveLength(1)
    const planRequested = events.filter((evt) => evt.type === 'plan_requested')
    expect(planRequested).toHaveLength(2)
    const replanRequest = planRequested[1]
    expect((replanRequest.payload as any).replan).toMatchObject({
      reason: 'goal_condition_failed'
    })
    expect((replanRequest.payload as any).replan.failedGoalConditions).toHaveLength(1)

    const planGenerated = events.filter((evt) => evt.type === 'plan_generated')
    expect(planGenerated).toHaveLength(2)
    expect((planGenerated[1].payload as any).replan?.reason).toBe('goal_condition_failed')

    const planUpdated = events.find((evt) => evt.type === 'plan_updated')
    expect(planUpdated).toBeTruthy()
    expect((planUpdated?.payload as any).replan?.reason).toBe('goal_condition_failed')

    const completeIndex = events.findIndex((evt) => evt.type === 'complete')
    const planUpdatedIndex = events.findIndex((evt) => evt.type === 'plan_updated')
    expect(planUpdatedIndex).toBeLessThan(completeIndex)
    expect((events[completeIndex]?.payload as any).status).toBe('completed')
  })
})
