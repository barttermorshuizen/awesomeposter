import { describe, it, expect, vi } from 'vitest'
import type { FlexEvent, OutputContract, TaskEnvelope, ContextBundle } from '@awesomeposter/shared'
import { FlexExecutionEngine, ReplanRequestedError } from '../src/services/flex-execution-engine'
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

function buildEnvelope(): TaskEnvelope {
  return {
    objective: 'Test objective',
    inputs: {},
    outputContract: BASE_CONTRACT
  }
}

function buildPersistenceStub(): FlexRunPersistence {
  return {
    savePlanSnapshot: vi.fn().mockResolvedValue(undefined),
    markNode: vi.fn().mockResolvedValue(undefined),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    recordResult: vi.fn().mockResolvedValue(undefined),
    recordPendingResult: vi.fn().mockResolvedValue(undefined),
    saveRunContext: vi.fn().mockResolvedValue(undefined)
  } as unknown as FlexRunPersistence
}

function buildEngine() {
  const persistence = buildPersistenceStub()
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
  return { engine, persistence }
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
