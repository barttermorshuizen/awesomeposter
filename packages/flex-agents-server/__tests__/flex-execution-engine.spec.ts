import { describe, it, expect, vi } from 'vitest'
import type { FlexEvent, OutputContract, TaskEnvelope, ContextBundle, CapabilityRecord } from '@awesomeposter/shared'
import {
  FlexExecutionEngine,
  ReplanRequestedError,
  GoalConditionFailedError,
  RuntimePolicyFailureError
} from '../src/services/flex-execution-engine'
import { RunContext } from '../src/services/run-context'
import type { FlexPlan, FlexPlanNode, FlexPlanNodeContracts, FlexPlanEdge } from '../src/services/flex-planner'
import type { FlexRunPersistence } from '../src/services/orchestrator-persistence'
import type { FlexCapabilityRegistryService } from '../src/services/flex-capability-registry'

const BASE_CONTRACT: OutputContract = {
  mode: 'json_schema',
  schema: { type: 'object', properties: {} }
}

function buildBundle(nodeId: string): ContextBundle {
  return {
    runId: 'run-routing',
    nodeId,
    objective: 'Test objective',
    instructions: [],
    inputs: {},
    policies: {},
    contract: { output: BASE_CONTRACT }
  }
}

function buildContracts(): FlexPlanNodeContracts {
  return {
    output: BASE_CONTRACT
  }
}

function baseNode(id: string, kind: FlexPlanNode['kind']): FlexPlanNode {
  return {
    id,
    status: 'pending',
    kind,
    capabilityId: null,
    capabilityLabel: id,
    label: id,
    bundle: buildBundle(id),
    contracts: buildContracts(),
    facets: { input: [], output: [] },
    provenance: {},
    rationale: [],
    metadata: {}
  }
}

type PlanBuildOptions = {
  includeSuccessNode?: boolean
  includeElseNode?: boolean
  withElse?: boolean
}

function buildPlan(options: PlanBuildOptions): FlexPlan {
  const includeSuccessNode = options.includeSuccessNode ?? true
  const includeElseNode = options.includeElseNode ?? false
  const withElse = options.withElse ?? true

  const routingNode: FlexPlanNode = {
    ...baseNode('route', 'routing'),
    routing: {
      routes: [
        {
          to: 'node-success',
          label: 'Route success',
          condition: {
            dsl: 'facets.routeTarget == "success"',
            canonicalDsl: 'facets.routeTarget == "success"',
            jsonLogic: {
              '==': [{ var: 'metadata.runContextSnapshot.facets.routeTarget.value' }, 'success']
            },
            warnings: [],
            variables: []
          }
        }
      ],
      ...(withElse ? { elseTo: 'node-fallback' } : {})
    }
  }

  const nodes: FlexPlanNode[] = [routingNode]
  if (includeSuccessNode) {
    nodes.push(baseNode('node-success', 'structuring'))
  }
  if (includeElseNode && withElse) {
    nodes.push(baseNode('node-fallback', 'structuring'))
  }

  const edges: FlexPlanEdge[] = [
    { from: 'route', to: 'node-success', reason: 'routing' }
  ]
  if (withElse) {
    edges.push({ from: 'route', to: 'node-fallback', reason: 'routing_else' })
  }

  return {
    runId: 'run-routing',
    version: 1,
    createdAt: new Date().toISOString(),
    nodes,
    edges,
    metadata: {}
  }
}

function buildCapabilityWithPostConditions(overrides: Partial<CapabilityRecord> = {}): CapabilityRecord {
  return {
    capabilityId: 'writer.v1',
    version: '1.0.0',
    displayName: 'Writer',
    summary: 'Writes copy variants',
    kind: 'execution',
    agentType: 'ai',
    inputTraits: undefined,
    inputContract: BASE_CONTRACT,
    outputContract: BASE_CONTRACT,
    cost: undefined,
    preferredModels: [],
    heartbeat: undefined,
    instructionTemplates: undefined,
    assignmentDefaults: undefined,
    metadata: {},
    postConditions: [
      {
        facet: 'summary',
        path: '/status',
        condition: {
          dsl: 'status == "ready"',
          canonicalDsl: 'status == "ready"',
          jsonLogic: {
            '==': [{ var: 'status' }, 'ready']
          }
        }
      }
    ],
    status: 'active',
    lastSeenAt: new Date().toISOString(),
    registeredAt: new Date().toISOString(),
    ...overrides
  }
}

function buildPostConditionPlan(capabilityId: string): FlexPlan {
  const executionNode: FlexPlanNode = {
    ...baseNode('writer-node', 'execution'),
    capabilityId,
    facets: { input: [], output: ['summary'] }
  }
  return {
    runId: 'run-post',
    version: 1,
    nodes: [executionNode],
    edges: [],
    metadata: {}
  }
}

function buildEnvelope(): TaskEnvelope {
  return {
    objective: 'Test objective',
    inputs: {},
    outputContract: BASE_CONTRACT
  }
}

function buildPersistenceStub(): { persistence: FlexRunPersistence; recordResult: ReturnType<typeof vi.fn> } {
  const recordResult = vi.fn().mockResolvedValue(undefined)
  const persistence = {
    savePlanSnapshot: vi.fn().mockResolvedValue(undefined),
    markNode: vi.fn().mockResolvedValue(undefined),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    recordResult,
    recordPendingResult: vi.fn().mockResolvedValue(undefined),
    saveRunContext: vi.fn().mockResolvedValue(undefined)
  } as unknown as FlexRunPersistence
  return { persistence, recordResult }
}

function buildEngine() {
  const { persistence, recordResult } = buildPersistenceStub()
  const capabilityRegistry = {
    getCapabilityById: vi.fn().mockResolvedValue(null)
  } as unknown as FlexCapabilityRegistryService
  const runtime = {
    runStructured: vi.fn().mockResolvedValue({ output: {} })
  }
  const engine = new FlexExecutionEngine(persistence, {
    capabilityRegistry,
    runtime
  })
  return { engine, persistence, recordResult }
}

function collectEvents() {
  const events: FlexEvent[] = []
  const onEvent = async (event: FlexEvent) => {
    events.push(event)
  }
  return { events, onEvent }
}

describe('FlexExecutionEngine routing nodes', () => {
  it('selects the matching routing target and emits evaluation metadata', async () => {
    const { engine } = buildEngine()
    const { events, onEvent } = collectEvents()
    const runContext = new RunContext()
    runContext.updateFacet('routeTarget', 'success', {
      nodeId: 'seed',
      capabilityId: null,
      rationale: 'test'
    })

    await engine.execute('run-routing', buildEnvelope(), buildPlan({ includeSuccessNode: true, includeElseNode: false }), {
      onEvent,
      runContext
    })

    const routingComplete = events.find((evt) => evt.type === 'node_complete' && evt.nodeId === 'route')
    expect(routingComplete?.payload && (routingComplete.payload as Record<string, unknown>).routingResult).toMatchObject({
      selectedTarget: 'node-success',
      resolution: 'match'
    })
    const targetStart = events.find((evt) => evt.type === 'node_start' && evt.nodeId === 'node-success')
    expect(targetStart).toBeTruthy()
  })

  it('falls back to the else branch when no conditions match', async () => {
    const { engine } = buildEngine()
    const { events, onEvent } = collectEvents()
    const runContext = new RunContext()
    runContext.updateFacet('routeTarget', 'unknown', {
      nodeId: 'seed',
      capabilityId: null,
      rationale: 'test'
    })

    await engine.execute(
      'run-routing',
      buildEnvelope(),
      buildPlan({ includeSuccessNode: false, includeElseNode: true }),
      {
        onEvent,
        runContext
      }
    )

    const routingComplete = events.find((evt) => evt.type === 'node_complete' && evt.nodeId === 'route')
    expect(routingComplete?.payload && (routingComplete.payload as Record<string, unknown>).routingResult).toMatchObject({
      selectedTarget: 'node-fallback',
      resolution: 'else'
    })
    const fallbackStart = events.find((evt) => evt.type === 'node_start' && evt.nodeId === 'node-fallback')
    expect(fallbackStart).toBeTruthy()
  })

  it('requests a replan when no routes match and no else path exists', async () => {
    const { engine } = buildEngine()
    const { events, onEvent } = collectEvents()
    const runContext = new RunContext()
    runContext.updateFacet('routeTarget', 'unknown', {
      nodeId: 'seed',
      capabilityId: null,
      rationale: 'test'
    })

    await expect(
      engine.execute('run-routing', buildEnvelope(), buildPlan({ includeSuccessNode: false, includeElseNode: false, withElse: false }), {
        onEvent,
        runContext
      })
    ).rejects.toBeInstanceOf(ReplanRequestedError)

    const routingComplete = events.find((evt) => evt.type === 'node_complete' && evt.nodeId === 'route')
    expect(routingComplete?.payload && (routingComplete.payload as Record<string, unknown>).routingResult).toMatchObject({
      resolution: 'replan'
    })
  })
})

describe('FlexExecutionEngine goal condition handling', () => {
  it('throws GoalConditionFailedError when predicates fail', async () => {
    const { engine, recordResult } = buildEngine()
    const runContext = new RunContext()
    runContext.updateFacet('routeTarget', 'success', {
      nodeId: 'seed',
      capabilityId: null,
      rationale: 'deterministic routing'
    })
    runContext.updateFacet('summary', { status: 'draft' }, { nodeId: 'seed', capabilityId: null, rationale: 'test' })
    const envelope: TaskEnvelope = {
      ...buildEnvelope(),
      goal_condition: [
        {
          facet: 'summary',
          path: '/status',
          condition: {
            dsl: 'status == "final"',
            canonicalDsl: 'status == "final"',
            jsonLogic: {
              '==': [{ var: 'status' }, 'final']
            }
          }
        }
      ]
    }
    const { onEvent } = collectEvents()
    let caught: unknown
    try {
      await engine.execute('run-goal', envelope, buildPlan({ includeSuccessNode: true, includeElseNode: false }), {
        onEvent,
        runContext
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(GoalConditionFailedError)
    const failure = caught as GoalConditionFailedError
    expect(failure.failedGoalConditions).toHaveLength(1)
    expect(failure.goalConditionResults[0]).toMatchObject({
      facet: 'summary',
      path: '/status',
      satisfied: false
    })
    expect(recordResult).not.toHaveBeenCalled()
  })
})

describe('FlexExecutionEngine goal condition evaluation', () => {
  it('emits goal_condition_results and persists evaluation output', async () => {
    const { engine, recordResult } = buildEngine()
    const { events, onEvent } = collectEvents()
    const runContext = new RunContext()
    runContext.updateFacet('post_copy', { status: 'ready' }, { nodeId: 'seed', capabilityId: 'writer.v1', rationale: 'seed' })
    runContext.updateFacet('routeTarget', 'success', { nodeId: 'seed', capabilityId: null, rationale: 'seed' })

    const envelope: TaskEnvelope = {
      ...buildEnvelope(),
      goal_condition: [
        {
          facet: 'post_copy',
          path: '/',
          condition: {
            dsl: 'status == "ready"',
            canonicalDsl: 'status == "ready"',
            jsonLogic: {
              '==': [{ var: 'status' }, 'ready']
            }
          }
        }
      ]
    }

    await engine.execute('run-goals', envelope, buildPlan({ includeSuccessNode: true, includeElseNode: false, withElse: false }), {
      onEvent,
      runContext
    })

    const completeEvent = events.find((evt) => evt.type === 'complete')
    expect(completeEvent).toBeTruthy()
    const goalResults = (completeEvent?.payload as Record<string, unknown> | undefined)?.goal_condition_results
    expect(Array.isArray(goalResults)).toBe(true)
    expect(goalResults?.[0]).toMatchObject({
      facet: 'post_copy',
      path: '/',
      satisfied: true
    })

    const recordCall = recordResult.mock.calls.at(-1)
    expect(recordCall?.[2]?.goalConditionResults).toHaveLength(1)
    expect(recordCall?.[2]?.goalConditionResults?.[0]).toMatchObject({
      facet: 'post_copy',
      satisfied: true
    })
  })

  it('throws GoalConditionFailedError during resume when predicates fail', async () => {
    const { engine, recordResult } = buildEngine()
    const runContext = new RunContext()
    runContext.updateFacet('summary', { status: 'draft' }, { nodeId: 'node-success', capabilityId: null, rationale: 'resume_seed' })
    const plan = buildPlan({ includeSuccessNode: true, includeElseNode: false })
    const envelope: TaskEnvelope = {
      ...buildEnvelope(),
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
    const finalOutput = { summary: { status: 'draft' } }
    const { onEvent } = collectEvents()

    await expect(
      engine.resumePending('run-resume', envelope, plan, finalOutput, {
        onEvent,
        runContext,
        initialState: {
          completedNodeIds: plan.nodes.map((node) => node.id),
          nodeOutputs: { 'node-success': finalOutput }
        }
      })
    ).rejects.toBeInstanceOf(GoalConditionFailedError)

    expect(recordResult).not.toHaveBeenCalled()
  })
})

describe('Capability post-condition enforcement', () => {
  it('retries failing nodes until post conditions pass and emits telemetry', async () => {
    const capability = buildCapabilityWithPostConditions()
    const runtime = {
      runStructured: vi
        .fn()
        .mockResolvedValueOnce({ output: { summary: { status: 'draft' } } })
        .mockResolvedValueOnce({ output: { summary: { status: 'ready' } } })
    }
    const { persistence } = buildPersistenceStub()
    const capabilityRegistry = {
      getCapabilityById: vi.fn().mockResolvedValue(capability)
    } as unknown as FlexCapabilityRegistryService
    const engine = new FlexExecutionEngine(persistence, {
      capabilityRegistry,
      runtime
    })
    const { events, onEvent } = collectEvents()
    await engine.execute(
      'run-post-conditions',
      {
        ...buildEnvelope(),
        policies: {
          runtime: [
            {
              id: 'pc-policy',
              trigger: {
                kind: 'onPostConditionFailed',
                selector: { capabilityId: capability.capabilityId },
                maxRetries: 2
              },
              action: { type: 'replan', rationale: 'guard failed' }
            }
          ]
        }
      },
      buildPostConditionPlan(capability.capabilityId),
      {
        onEvent,
        runContext: new RunContext()
      }
    )

    expect(runtime.runStructured).toHaveBeenCalledTimes(2)
    const policyEvent = events.find((evt) => evt.type === 'policy_triggered' && evt.nodeId === 'writer-node')
    expect(policyEvent).toBeTruthy()
    expect((policyEvent?.payload as Record<string, unknown>)?.postConditionResults).toMatchObject([
      {
        facet: 'summary',
        path: '/status',
        satisfied: false
      }
    ])
    expect((policyEvent?.payload as Record<string, unknown>)?.maxRetries).toBe(2)

    const secondCallMessages = runtime.runStructured.mock.calls[1]?.[1] as
      | Array<{ role: string; content: string }>
      | undefined
    const userMessage = secondCallMessages?.find((msg) => msg.role === 'user')?.content ?? ''
    expect(userMessage).toContain('Previous post-condition failures')
    expect(userMessage).toContain('/status')

    const nodeComplete = events.find((evt) => evt.type === 'node_complete' && evt.nodeId === 'writer-node')
    expect(nodeComplete).toBeTruthy()
    expect((nodeComplete?.payload as Record<string, unknown>)?.postConditionResults).toMatchObject([
      {
        facet: 'summary',
        path: '/status',
        satisfied: true
      }
    ])
  })

  it('executes the configured action when the retry budget is exhausted', async () => {
    const capability = buildCapabilityWithPostConditions()
    const runtime = {
      runStructured: vi.fn().mockResolvedValue({ output: { summary: { status: 'draft' } } })
    }
    const { persistence } = buildPersistenceStub()
    const capabilityRegistry = {
      getCapabilityById: vi.fn().mockResolvedValue(capability)
    } as unknown as FlexCapabilityRegistryService
    const engine = new FlexExecutionEngine(persistence, {
      capabilityRegistry,
      runtime
    })
    const { events, onEvent } = collectEvents()

    await expect(
      engine.execute(
        'run-post-conditions-fail',
        {
          ...buildEnvelope(),
          policies: {
            runtime: [
              {
                id: 'pc-fail',
                trigger: {
                  kind: 'onPostConditionFailed',
                  selector: { capabilityId: capability.capabilityId },
                  maxRetries: 0
                },
                action: { type: 'fail', message: 'capability guards failed' }
              }
            ]
          }
        },
        buildPostConditionPlan(capability.capabilityId),
        {
          onEvent,
          runContext: new RunContext()
        }
      )
    ).rejects.toBeInstanceOf(RuntimePolicyFailureError)

    expect(runtime.runStructured).toHaveBeenCalledTimes(1)
    const policyEvent = events.find((evt) => evt.type === 'policy_triggered' && evt.nodeId === 'writer-node')
    expect(policyEvent).toBeTruthy()
    expect((policyEvent?.payload as Record<string, unknown>)?.maxRetries).toBe(0)
    expect((policyEvent?.payload as Record<string, unknown>)?.postConditionResults).toMatchObject([
      {
        facet: 'summary',
        path: '/status',
        satisfied: false
      }
    ])
  })
})
