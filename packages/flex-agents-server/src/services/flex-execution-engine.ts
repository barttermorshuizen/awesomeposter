import Ajv, { type ErrorObject } from 'ajv'
import { z, type ZodTypeAny } from 'zod'
import type { FlexPlan, FlexPlanNode, FlexPlanEdge } from './flex-planner'
import type {
  AssignmentDefaults,
  TaskEnvelope,
  FlexEvent,
  OutputContract,
  HitlRunState,
  HitlRequestRecord,
  HitlRequestPayload,
  CapabilityRecord,
  CapabilityContract,
  JsonSchemaShape,
  RuntimePolicy,
  Action,
  NodeSelector,
  HitlContractSummary,
  ContextBundle,
  FacetProvenance,
  JsonLogicExpression,
  RoutingEvaluationResult,
  GoalConditionResult
} from '@awesomeposter/shared'
import { FlexRunPersistence, type FlexPlanNodeSnapshot, type FlexPlanNodeStatus } from './orchestrator-persistence'
import { withHitlContext } from './hitl-context'
import { parseHitlDecisionAction, resolveHitlDecision as resolveHitlDecisionDetail, type HitlService } from './hitl-service'
import { getFlexCapabilityRegistryService, type FlexCapabilityRegistryService } from './flex-capability-registry'
import { getRuntime, resolveCapabilityPrompt } from './agents-container'
import type { AgentRuntime } from './agent-runtime'
import { getLogger } from './logger'
import { RunContext, type RunContextSnapshot, type FacetSnapshot } from './run-context'
import { FacetContractCompiler, getFacetCatalog, evaluateCondition as evaluateRoutingCondition } from '@awesomeposter/shared'
import type { RuntimePolicyEffect } from './policy-normalizer'
import type { PendingPolicyActionState, PolicyAttemptState, RuntimePolicySnapshotMode } from './runtime-policy-types'
import {
  ensureFacetPlaceholders,
  extractFacetSnapshotValues,
  mergeFacetValuesIntoStructure,
  stripPlannerFields
} from './run-context-utils'
import { evaluateGoalConditions } from './goal-condition-evaluator'

type StructuredRuntime = Pick<AgentRuntime, 'runStructured'>
type AjvInstance = ReturnType<typeof Ajv>
type AjvValidateFn = ReturnType<AjvInstance['compile']>

type RuntimePolicyActionResult =
  | { kind: 'goto'; targetNodeId: string }
  | { kind: 'noop' }

const POLICY_ACTION_SOURCE = {
  runtime: 'runtime',
  approval: 'hitl.approve',
  rejection: 'hitl.reject'
} as const
type PolicyActionSource = (typeof POLICY_ACTION_SOURCE)[keyof typeof POLICY_ACTION_SOURCE]
const DEFAULT_POST_CONDITION_MAX_RETRIES = (() => {
  const raw = Number(process.env.FLEX_CAPABILITY_POST_CONDITION_MAX_RETRIES ?? 1)
  if (Number.isFinite(raw) && raw >= 0) {
    return Math.floor(raw)
  }
  return 1
})()

type NodeTiming = { startedAt?: Date | null; completedAt?: Date | null }

type EventFacetProvenanceEntry = {
  title: string
  direction: 'input' | 'output'
  facet: string
  pointer: string
}

type EventFacetProvenanceMap = {
  input?: EventFacetProvenanceEntry[]
  output?: EventFacetProvenanceEntry[]
}

type PlanGraphStructures = {
  incoming: Map<string, Set<string>>
  outgoing: Map<string, Set<string>>
  order: Map<string, number>
  edges: FlexPlanEdge[]
}

type RoutingNodeOutcome =
  | { kind: 'matched' | 'else'; selectedTarget: string; evaluation: RoutingEvaluationResult }
  | { kind: 'replan'; evaluation: RoutingEvaluationResult }

type FeedbackHistoryEntry = {
  key: string
  id?: string | null
  facet?: string | null
  path?: string | null
  message?: string | null
  note?: string | null
  resolution: string
}

type FeedbackResolutionChangePayload = {
  key: string
  facet?: string | null
  path?: string | null
  message?: string | null
  note?: string | null
  previous: string
  current: string
}

type PostConditionRetryContext = {
  attempt?: number
  maxRetries?: number
  results?: GoalConditionResult[]
}

class PlanScheduler {
  private readonly graph: PlanGraphStructures
  private readonly readyQueue: string[] = []
  private readonly readySet = new Set<string>()
  private readonly conditionalLocks = new Map<string, Set<string>>()
  private readonly conditionalTargets = new Map<string, Set<string>>()
  private readonly nodeKinds = new Map<string, FlexPlanNodeKind>()

  constructor(
    private readonly plan: FlexPlan,
    private readonly completedNodeIds: Set<string>,
    routingSelections?: Map<string, string[]>
  ) {
    this.graph = this.buildGraph(plan)
    this.pruneCompleted()
    this.applyRoutingSelections(routingSelections)
    this.refreshAll()
  }

  hasRemainingWork(): boolean {
    return this.plan.nodes.some((node) => !this.completedNodeIds.has(node.id))
  }

  peek(): string | null {
    return this.readyQueue.length ? this.readyQueue[0] : null
  }

  next(): string | null {
    while (this.readyQueue.length) {
      const nextId = this.readyQueue.shift()!
      this.readySet.delete(nextId)
      if (!this.completedNodeIds.has(nextId)) {
        return nextId
      }
    }
    return null
  }

  markCompleted(nodeId: string): void {
    this.completedNodeIds.add(nodeId)
    const downstream = this.graph.outgoing.get(nodeId)
    if (downstream) {
      for (const target of downstream) {
        const locks = this.conditionalLocks.get(target)
        if (locks && locks.has(nodeId)) {
          continue
        }
        this.enqueueIfReady(target)
      }
    }
  }

  markConditionalRelease(nodeId: string, allowedTargets: string[]) {
    const targets = this.conditionalTargets.get(nodeId)
    if (!targets || !allowedTargets.length) return
    const allowSet = new Set(allowedTargets)
    for (const target of targets) {
      if (!allowSet.has(target)) continue
      const locks = this.conditionalLocks.get(target)
      if (!locks) continue
      locks.delete(nodeId)
      if (!locks.size) {
        this.enqueueIfReady(target)
      }
    }
  }

  private applyRoutingSelections(selections?: Map<string, string[]>) {
    if (!selections || !selections.size) return
    for (const [nodeId, targets] of selections.entries()) {
      if (!this.completedNodeIds.has(nodeId)) continue
      this.markConditionalRelease(nodeId, targets)
    }
  }

  resetFromNode(nodeId: string): string[] {
    if (!this.graph.order.has(nodeId)) {
      return []
    }
    const affected = new Set<string>()
    const stack = [nodeId]
    while (stack.length) {
      const current = stack.pop()!
      if (affected.has(current)) continue
      affected.add(current)
      const outgoing = this.graph.outgoing.get(current)
      if (outgoing) {
        for (const target of outgoing) {
          stack.push(target)
        }
      }
    }
    this.requeueNodes(affected)
    return Array.from(affected)
  }

  refreshAll(): void {
    this.readyQueue.length = 0
    this.readySet.clear()
    for (const node of this.plan.nodes) {
      this.enqueueIfReady(node.id)
    }
  }

  private requeueNodes(nodes: Set<string>) {
    for (const id of nodes) {
      this.completedNodeIds.delete(id)
      if (this.readySet.delete(id)) {
        const index = this.readyQueue.indexOf(id)
        if (index >= 0) {
          this.readyQueue.splice(index, 1)
        }
      }
      const targets = this.conditionalTargets.get(id)
      if (targets) {
        for (const target of targets) {
          if (!this.conditionalLocks.has(target)) {
            this.conditionalLocks.set(target, new Set())
          }
          this.conditionalLocks.get(target)!.add(id)
        }
      }
    }
    for (const id of nodes) {
      this.enqueueIfReady(id)
    }
  }

  private enqueueIfReady(nodeId: string) {
    if (!this.graph.order.has(nodeId)) return
    if (this.completedNodeIds.has(nodeId) || this.readySet.has(nodeId)) return
    const incoming = this.graph.incoming.get(nodeId)
    if (incoming) {
      for (const dependency of incoming) {
        if (!this.completedNodeIds.has(dependency)) {
          return
        }
      }
    }
    const locks = this.conditionalLocks.get(nodeId)
    if (locks && locks.size > 0) {
      return
    }
    this.readyQueue.push(nodeId)
    this.readySet.add(nodeId)
    this.readyQueue.sort((a, b) => (this.graph.order.get(a)! - this.graph.order.get(b)!))
  }

  private buildGraph(plan: FlexPlan): PlanGraphStructures {
    const order = new Map<string, number>()
    const incoming = new Map<string, Set<string>>()
    const outgoing = new Map<string, Set<string>>()
    plan.nodes.forEach((node, index) => {
      order.set(node.id, index)
      incoming.set(node.id, new Set())
      outgoing.set(node.id, new Set())
      this.nodeKinds.set(node.id, node.kind)
    })
    const edges = plan.edges && plan.edges.length ? plan.edges : this.deriveSequentialEdges(plan.nodes)
    for (const edge of edges) {
      if (!order.has(edge.from) || !order.has(edge.to)) {
        continue
      }
      incoming.get(edge.to)!.add(edge.from)
      outgoing.get(edge.from)!.add(edge.to)
      if (this.nodeKinds.get(edge.from) === 'routing') {
        if (!this.conditionalLocks.has(edge.to)) {
          this.conditionalLocks.set(edge.to, new Set())
        }
        this.conditionalLocks.get(edge.to)!.add(edge.from)
        if (!this.conditionalTargets.has(edge.from)) {
          this.conditionalTargets.set(edge.from, new Set())
        }
        this.conditionalTargets.get(edge.from)!.add(edge.to)
      }
    }
    return { incoming, outgoing, order, edges }
  }

  private deriveSequentialEdges(nodes: FlexPlanNode[]): FlexPlanEdge[] {
    const edges: FlexPlanEdge[] = []
    for (let index = 0; index < nodes.length - 1; index += 1) {
      edges.push({ from: nodes[index].id, to: nodes[index + 1].id, reason: 'sequence' })
    }
    return edges
  }

  private pruneCompleted() {
    for (const nodeId of Array.from(this.completedNodeIds)) {
      if (!this.graph.order.has(nodeId)) {
        this.completedNodeIds.delete(nodeId)
      }
    }
  }
}

export class FlexValidationError extends Error {
  constructor(
    message: string,
    public readonly scope: 'capability_input' | 'capability_output' | 'final_output' | 'envelope',
    public readonly errors: ErrorObject[]
  ) {
    super(message)
    this.name = 'FlexValidationError'
  }
}

function stringifyForPrompt(value: unknown, maxLength = 4000): string {
  let text: string
  try {
    text = JSON.stringify(value, null, 2)
  } catch {
    text = typeof value === 'string' ? value : String(value)
  }
  if (!text) return ''
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}\n... (truncated)`
}

type JsonPrimitive = string | number | boolean | null

function isJsonSchemaShape(value: unknown): value is JsonSchemaShape {
  return Boolean(value) && typeof value === 'object'
}

function jsonSchemaToZod(schema: JsonSchemaShape): ZodTypeAny {
  if (!schema || typeof schema !== 'object') {
    return z.unknown()
  }

  const schemaRecord = schema as Record<string, unknown>

  if (Object.prototype.hasOwnProperty.call(schemaRecord, 'const')) {
    const literalValue = schemaRecord.const as JsonPrimitive | undefined
    if (literalValue !== undefined) {
      return z.literal(literalValue)
    }
  }

  if (Array.isArray(schemaRecord.enum) && schemaRecord.enum.length) {
    const enumValues = schemaRecord.enum as JsonPrimitive[]
    const literals = enumValues.map((value) => z.literal(value) as unknown as ZodTypeAny)
    if (literals.length === 1) return literals[0]
    return z.union(literals as unknown as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]])
  }

  const combinators =
    (Array.isArray(schemaRecord.anyOf) ? (schemaRecord.anyOf as JsonSchemaShape[]) : undefined) ??
    (Array.isArray(schemaRecord.oneOf) ? (schemaRecord.oneOf as JsonSchemaShape[]) : undefined)
  if (combinators && combinators.length) {
    const variants = combinators.filter(isJsonSchemaShape).map((entry) => jsonSchemaToZod(entry))
    if (variants.length === 1) return variants[0]
    return z.union(variants as unknown as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]])
  }

  if (Array.isArray(schemaRecord.allOf) && schemaRecord.allOf.length) {
    const allOfEntries = (schemaRecord.allOf as JsonSchemaShape[]).filter(isJsonSchemaShape)
    const variants = allOfEntries.map((entry) => jsonSchemaToZod(entry))
    const [first, ...rest] = variants
    if (!first) return z.unknown()
    return rest.reduce((acc, current) => z.intersection(acc, current), first)
  }

  const rawType = schemaRecord.type as string | string[] | undefined
  const typeList = Array.isArray(rawType) ? rawType : rawType ? [rawType] : []
  if (typeList.length > 1) {
    const variants = typeList.map((entry: string) =>
      jsonSchemaToZod({ ...(schemaRecord as Record<string, unknown>), type: entry } as JsonSchemaShape)
    )
    return z.union(variants as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]])
  }

  const type = typeList[0]
  switch (type) {
    case 'string': {
      let str = z.string()
      const minLength = schemaRecord.minLength
      if (typeof minLength === 'number') str = str.min(minLength)
      const maxLength = schemaRecord.maxLength
      if (typeof maxLength === 'number') str = str.max(maxLength)
      const pattern = schemaRecord.pattern
      if (Array.isArray(pattern)) {
        str = str.regex(new RegExp(String(pattern)))
      } else if (typeof pattern === 'string') {
        str = str.regex(new RegExp(pattern))
      }
      return str
    }
    case 'number':
    case 'integer': {
      let num = z.number()
      if (type === 'integer') num = num.int()
      const minimum = schemaRecord.minimum
      if (typeof minimum === 'number') num = num.min(minimum)
      const maximum = schemaRecord.maximum
      if (typeof maximum === 'number') num = num.max(maximum)
      return num
    }
    case 'boolean':
      return z.boolean()
    case 'null':
      return z.null()
    case 'array': {
      const items = schemaRecord.items
      let elementSchema: ZodTypeAny
      if (Array.isArray(items) && items.length) {
        const variants = items.filter(isJsonSchemaShape).map((entry) => jsonSchemaToZod(entry))
        elementSchema =
          variants.length === 1 ? variants[0] : z.union(variants as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]])
      } else if (items && typeof items === 'object') {
        elementSchema = jsonSchemaToZod(items as JsonSchemaShape)
      } else {
        elementSchema = z.unknown()
      }
      let arr = z.array(elementSchema)
      const minItems = schemaRecord.minItems
      if (typeof minItems === 'number') arr = arr.min(minItems)
      const maxItems = schemaRecord.maxItems
      if (typeof maxItems === 'number') arr = arr.max(maxItems)
      if (schemaRecord.uniqueItems) {
        const uniqueArray: ZodTypeAny = arr.superRefine((list, ctx) => {
          const seen = new Set<string>()
          for (const item of list) {
            const key = JSON.stringify(item)
            if (seen.has(key)) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Items must be unique' })
              break
            }
            seen.add(key)
          }
        })
        return uniqueArray
      }
      return arr
    }
    case 'object':
    default: {
      const properties = (schemaRecord.properties ?? {}) as Record<string, JsonSchemaShape>
      const requiredList = Array.isArray(schemaRecord.required)
        ? (schemaRecord.required as string[])
        : []
      const required = new Set<string>(requiredList)
      const shape: Record<string, ZodTypeAny> = {}
      for (const [key, definition] of Object.entries(properties)) {
        const childSchema = jsonSchemaToZod(definition)
        shape[key] = required.has(key) ? childSchema : childSchema.optional()
      }
      const baseObject = z.object(shape)
      const additional = schemaRecord.additionalProperties
      if (additional === false) {
        return baseObject.strict()
      }
      if (additional && typeof additional === 'object') {
        return baseObject.catchall(jsonSchemaToZod(additional as JsonSchemaShape))
      }
      return baseObject.passthrough()
    }
  }
}

export type FlexExecutionOptions = {
  onEvent: (event: FlexEvent) => Promise<void>
  correlationId?: string
  hitl?: {
    service: HitlService
    state: HitlRunState
    threadId?: string | null
    limit: { current: number; max: number }
    onRequest?: (record: HitlRequestRecord, state: HitlRunState) => void | Promise<void>
    onDenied?: (reason: string, state: HitlRunState) => void | Promise<void>
    updateState?: (state: HitlRunState) => void
  }
  onStart?: (context: {
    runId: string
    envelope: TaskEnvelope
    plan: FlexPlan
    nextNode: FlexPlanNode | null
  }) =>
    | Promise<RuntimePolicyEffect | null | void>
    | RuntimePolicyEffect
    | null
    | void
  onNodeComplete?: (context: {
    node: FlexPlanNode
    output: Record<string, unknown>
    runId: string
    plan: FlexPlan
  }) =>
    | Promise<RuntimePolicyEffect | null | void>
    | RuntimePolicyEffect
    | null
    | void
  initialState?: {
    completedNodeIds?: string[]
    nodeOutputs?: Record<string, Record<string, unknown>>
    facets?: RunContextSnapshot
    policyActions?: PendingPolicyActionState[]
    policyAttempts?: PolicyAttemptState
    postConditionAttempts?: Record<string, number>
    mode?: RuntimePolicySnapshotMode
  }
  runContext?: RunContext
  schemaHash?: string | null
}

type CapabilityResult = {
  output: Record<string, unknown>
  capability: CapabilityRecord
}

export class HitlPauseError extends Error {
  constructor(message = 'Awaiting HITL approval') {
    super(message)
    this.name = 'HitlPauseError'
  }
}

export class AwaitingHumanInputError extends Error {
  constructor(message = 'Awaiting human operator response') {
    super(message)
    this.name = 'AwaitingHumanInputError'
  }
}

export class RunPausedError extends Error {
  constructor(message = 'Execution paused by runtime policy') {
    super(message)
    this.name = 'RunPausedError'
  }
}

export class RuntimePolicyFailureError extends Error {
  constructor(public readonly policyId: string, message: string) {
    super(message)
    this.name = 'RuntimePolicyFailureError'
  }
}

export type ReplanTrigger = {
  reason: string
  details?: Record<string, unknown>
}

export class ReplanRequestedError extends Error {
  constructor(
    public readonly trigger: ReplanTrigger,
    public readonly state: {
      completedNodeIds: string[]
      nodeOutputs: Record<string, Record<string, unknown>>
      facets: RunContextSnapshot
      policyActions?: PendingPolicyActionState[]
      policyAttempts?: PolicyAttemptState
      postConditionAttempts?: Record<string, number>
    }
  ) {
    super('Replan requested')
    this.name = 'ReplanRequestedError'
  }
}

export class GoalConditionFailedError extends ReplanRequestedError {
  constructor(
    args: {
      trigger?: ReplanTrigger
      state: {
        completedNodeIds: string[]
        nodeOutputs: Record<string, Record<string, unknown>>
        facets: RunContextSnapshot
        policyActions?: PendingPolicyActionState[]
        policyAttempts?: PolicyAttemptState
        postConditionAttempts?: Record<string, number>
      }
      results: GoalConditionResult[]
      failed: GoalConditionResult[]
      finalOutput: Record<string, unknown>
    }
  ) {
    super(
      args.trigger ?? {
        reason: 'goal_condition_failed',
        details: { failedGoalConditions: args.failed }
      },
      args.state
    )
    this.goalConditionResults = args.results
    this.failedGoalConditions = args.failed
    this.finalOutput = args.finalOutput
    this.name = 'GoalConditionFailedError'
  }

  readonly goalConditionResults: GoalConditionResult[]
  readonly failedGoalConditions: GoalConditionResult[]
  readonly finalOutput: Record<string, unknown>
}

export class FlexExecutionEngine {
  private readonly ajv: AjvInstance
  private readonly validatorCache = new Map<string, AjvValidateFn>()
  private readonly runtime: StructuredRuntime
  private readonly capabilityRegistry: FlexCapabilityRegistryService
  private readonly facetCompiler: FacetContractCompiler
  private readonly facetCatalog = getFacetCatalog()

  constructor(
    private readonly persistence = new FlexRunPersistence(),
    options?: {
      ajv?: AjvInstance
      runtime?: StructuredRuntime
      capabilityRegistry?: FlexCapabilityRegistryService
    }
  ) {
    this.ajv = options?.ajv ?? new Ajv({ allErrors: true })
    this.runtime = options?.runtime ?? getRuntime()
    this.capabilityRegistry = options?.capabilityRegistry ?? getFlexCapabilityRegistryService()
    this.facetCompiler = new FacetContractCompiler({ catalog: this.facetCatalog })
  }

  private getExecutorType(node: FlexPlanNode): 'ai' | 'human' {
    if (node.executor?.type === 'human') {
      return 'human'
    }
    const metadata = node.metadata as Record<string, unknown> | undefined
    if (metadata && typeof metadata.executorType === 'string' && metadata.executorType === 'human') {
      return 'human'
    }
    return 'ai'
  }

  private async handleVirtualNode(
    runId: string,
    plan: FlexPlan,
    node: FlexPlanNode,
    opts: FlexExecutionOptions
  ) {
    const startedAt = new Date()
    const nodeContext = node.bundle
      ? (JSON.parse(JSON.stringify(node.bundle)) as ContextBundle)
      : null
    await this.persistence.markNode(runId, node.id, {
      status: 'running',
      capabilityId: node.capabilityId,
      label: node.label,
      context: nodeContext ?? undefined,
      startedAt
    })

    try {
      getLogger().info('flex_virtual_node_start', {
        runId,
        nodeId: node.id,
        capabilityId: node.capabilityId,
        kind: node.kind,
        correlationId: opts.correlationId
      })
    } catch {}

    await opts.onEvent(
      this.buildEvent(
        'node_start',
        {
          capabilityId: node.capabilityId,
          label: node.label,
          kind: node.kind,
          virtual: true,
          startedAt: startedAt.toISOString()
        },
        {
          runId,
          nodeId: node.id,
          planVersion: plan.version,
          facetProvenance: this.normalizeFacetProvenance(node.provenance)
        }
      )
    )

    const completedAt = new Date()
    await this.persistence.markNode(runId, node.id, {
      status: 'completed',
      completedAt,
      output: null
    })

    try {
      getLogger().info('flex_virtual_node_complete', {
        runId,
        nodeId: node.id,
        capabilityId: node.capabilityId,
        kind: node.kind,
        correlationId: opts.correlationId
      })
    } catch {}

    await opts.onEvent(
      this.buildEvent(
        'node_complete',
        {
          capabilityId: node.capabilityId,
          label: node.label,
          kind: node.kind,
          virtual: true,
          completedAt: completedAt.toISOString()
        },
        {
          runId,
          nodeId: node.id,
          planVersion: plan.version,
          facetProvenance: this.normalizeFacetProvenance(node.provenance)
        }
      )
    )
  }

  private async handleRoutingNode(args: {
    runId: string
    plan: FlexPlan
    node: FlexPlanNode
    opts: FlexExecutionOptions
    runContext: RunContext
    nodeTimings: Map<string, NodeTiming>
    nodeOutputs: Map<string, Record<string, unknown>>
  }): Promise<RoutingNodeOutcome> {
    const { runId, plan, node, opts, runContext, nodeTimings, nodeOutputs } = args
    if (!node.routing || !node.routing.routes.length) {
      throw new Error(`Routing node "${node.id}" is missing routing configuration.`)
    }

    const startedAt = new Date()
    const persistenceContext = this.buildPersistenceContext(node, runContext)
    nodeTimings.set(node.id, { ...(nodeTimings.get(node.id) ?? {}), startedAt })
    await this.persistence.markNode(runId, node.id, {
      status: 'running',
      label: node.label,
      context: persistenceContext,
      startedAt
    })

    try {
      getLogger().info('flex_routing_node_start', {
        runId,
        nodeId: node.id,
        correlationId: opts.correlationId
      })
    } catch {}

    await opts.onEvent(
      this.buildEvent(
        'node_start',
        {
          label: node.label,
          kind: node.kind,
          routing: node.routing,
          startedAt: startedAt.toISOString()
        },
        {
          runId,
          nodeId: node.id,
          planVersion: plan.version,
          facetProvenance: this.normalizeFacetProvenance(node.provenance)
        }
      )
    )

    const runContextSnapshot = runContext.snapshot()
    const metadataPayload: Record<string, unknown> =
      node.metadata && typeof node.metadata === 'object'
        ? { ...(node.metadata as Record<string, unknown>) }
        : {}
    metadataPayload.runContextSnapshot = runContextSnapshot

    const evaluationPayload = {
      run: {
        id: runId,
        version: plan.version
      },
      metadata: metadataPayload
    }

    const traces: RoutingEvaluationResult['traces'] = []
    let matchedRoute: (typeof node.routing.routes)[number] | null = null

    for (const route of node.routing.routes) {
      const trace: RoutingEvaluationResult['traces'][number] = {
        to: route.to,
        label: route.label,
        dsl: route.condition.dsl,
        canonicalDsl: route.condition.canonicalDsl ?? null
      }
      const jsonLogic = route.condition.jsonLogic as JsonLogicExpression | undefined
      if (!jsonLogic) {
        trace.error = 'Routing condition is missing compiled jsonLogic payload.'
        traces.push(trace)
        continue
      }
      const evaluation = evaluateRoutingCondition(jsonLogic, evaluationPayload)
      if (!evaluation.ok) {
        trace.error = evaluation.error
        traces.push(trace)
        continue
      }
      trace.matched = evaluation.result
      if (evaluation.resolvedVariables && Object.keys(evaluation.resolvedVariables).length) {
        trace.resolvedVariables = evaluation.resolvedVariables
      }
      traces.push(trace)
      if (evaluation.result && !matchedRoute) {
        matchedRoute = route
      }
    }

    let resolution: RoutingEvaluationResult['resolution'] = matchedRoute ? 'match' : undefined
    let selectedTarget: string | undefined = matchedRoute?.to
    if (!selectedTarget && node.routing.elseTo) {
      selectedTarget = node.routing.elseTo
      resolution = 'else'
    }
    if (!resolution) {
      resolution = 'replan'
    }

    const completedAt = new Date()
    nodeTimings.set(node.id, { ...(nodeTimings.get(node.id) ?? {}), startedAt, completedAt })

    const evaluationResult: RoutingEvaluationResult = {
      nodeId: node.id,
      evaluatedAt: completedAt.toISOString(),
      selectedTarget,
      elseTarget: node.routing.elseTo,
      resolution,
      traces
    }

    nodeOutputs.set(node.id, { routingResult: evaluationResult })
    await this.persistence.markNode(runId, node.id, {
      status: 'completed',
      completedAt,
      output: { routingResult: evaluationResult }
    })

    try {
      getLogger().info('flex_routing_node_complete', {
        runId,
        nodeId: node.id,
        resolution,
        selectedTarget,
        correlationId: opts.correlationId
      })
    } catch {}

    await opts.onEvent(
      this.buildEvent(
        'node_complete',
        {
          label: node.label,
          kind: node.kind,
          completedAt: completedAt.toISOString(),
          routingResult: evaluationResult
        },
        {
          runId,
          nodeId: node.id,
          planVersion: plan.version,
          facetProvenance: this.normalizeFacetProvenance(node.provenance)
        }
      )
    )

    await opts.onEvent(
      this.buildEvent(
        'log',
        {
          severity: resolution === 'replan' ? 'warn' : 'info',
          routingResult: evaluationResult,
          routingNode: node.id
        },
        {
          runId,
          nodeId: node.id,
          message:
            resolution === 'replan'
              ? 'routing_replan_required'
              : `routing_selected:${selectedTarget ?? 'none'}`,
          planVersion: plan.version
        }
      )
    )

    if (!selectedTarget) {
      return { kind: 'replan', evaluation: evaluationResult }
    }

    return {
      kind: resolution === 'else' ? 'else' : 'matched',
      selectedTarget,
      evaluation: evaluationResult
    }
  }

  async execute(runId: string, envelope: TaskEnvelope, plan: FlexPlan, opts: FlexExecutionOptions) {
    const initialNodeOutputs = opts.initialState?.nodeOutputs ?? {}
    const nodeOutputs = new Map<string, Record<string, unknown>>(Object.entries(initialNodeOutputs))
    const completedNodeIds = new Set<string>(opts.initialState?.completedNodeIds ?? Object.keys(initialNodeOutputs))
    const runContext = opts.runContext ?? RunContext.fromSnapshot(opts.initialState?.facets)
    const nodeStatuses = new Map<string, FlexPlanNodeStatus>()
    const nodeTimings = new Map<string, NodeTiming>()
    const policyActions: PendingPolicyActionState[] = Array.isArray(opts.initialState?.policyActions)
      ? opts.initialState!.policyActions.map((action) => ({ ...action }))
      : []
    const policyAttempts = new Map<string, number>(Object.entries(opts.initialState?.policyAttempts ?? {}))
    const postConditionAttempts = new Map<string, number>(
      Object.entries(opts.initialState?.postConditionAttempts ?? {})
    )
    const nodeLookup = new Map<string, FlexPlanNode>()
    for (const node of plan.nodes) {
      nodeLookup.set(node.id, node)
      nodeStatuses.set(node.id, completedNodeIds.has(node.id) ? 'completed' : 'pending')
    }

    for (const staleId of Array.from(completedNodeIds)) {
      if (!nodeLookup.has(staleId)) {
        completedNodeIds.delete(staleId)
      }
    }

    const routingSelections = this.buildRoutingSelectionsFromOutputs(nodeOutputs)
    const scheduler = new PlanScheduler(plan, completedNodeIds, routingSelections)

    if (policyActions.length) {
      const pendingDispatch = await this.processPendingPolicyActions({
        runId,
        envelope,
        plan,
        opts,
        runContext,
        nodeOutputs,
        nodeStatuses,
        nodeTimings,
        completedNodeIds,
        policyActions,
        policyAttempts,
        scheduler,
        postConditionAttempts
      })
      policyActions.splice(0, policyActions.length, ...pendingDispatch.remainingActions)
    }

    scheduler.refreshAll()

    if (opts.onStart) {
      const nextNodeId = scheduler.peek()
      const nextNode = nextNodeId ? nodeLookup.get(nextNodeId) ?? null : null
      const effect = await opts.onStart({
        runId,
        envelope,
        plan,
        nextNode
      })
      if (effect) {
        if (effect.kind === 'replan') {
          throw new ReplanRequestedError(effect.trigger, {
            completedNodeIds: Array.from(completedNodeIds),
            nodeOutputs: Object.fromEntries(nodeOutputs.entries()),
            facets: runContext.snapshot(),
            policyActions: policyActions.length ? this.clonePolicyActions(policyActions) : undefined,
            policyAttempts: policyAttempts.size ? Object.fromEntries(policyAttempts.entries()) : undefined,
            postConditionAttempts: postConditionAttempts.size
              ? Object.fromEntries(postConditionAttempts.entries())
              : undefined
          })
        }
        if (effect.kind === 'action') {
          if (!nextNode) {
            try {
              getLogger().warn('flex_runtime_startup_policy_missing_node', {
                runId,
                policyId: effect.policy.id,
                action: effect.policy.action.type
              })
            } catch {}
          } else {
            const actionOutcome = await this.handleRuntimePolicyAction(
              effect.policy,
              {
                runId,
                envelope,
                plan,
                opts,
                node: nextNode,
                runContext,
                nodeOutputs,
                nodeStatuses,
                nodeTimings,
                completedNodeIds,
                policyActions,
                policyAttempts,
                postConditionAttempts,
                scheduler
              },
              { source: POLICY_ACTION_SOURCE.runtime }
            )
            if (actionOutcome?.kind === 'goto') {
              scheduler.refreshAll()
            }
          }
        }
      }
    }

    while (scheduler.hasRemainingWork()) {
      const nextNodeId = scheduler.next()
      if (!nextNodeId) {
        if (scheduler.hasRemainingWork()) {
          throw new Error('Plan graph deadlocked: no runnable nodes available.')
        }
        break
      }
      const node = nodeLookup.get(nextNodeId)
      if (!node) {
        scheduler.markCompleted(nextNodeId)
        continue
      }
      if (completedNodeIds.has(node.id)) {
        nodeStatuses.set(node.id, 'completed')
        scheduler.markCompleted(node.id)
        continue
      }

      if (node.kind === 'routing') {
        nodeStatuses.set(node.id, 'running')
        const outcome = await this.handleRoutingNode({
          runId,
          plan,
          node,
          opts,
          runContext,
          nodeTimings,
          nodeOutputs
        })
        nodeStatuses.set(node.id, 'completed')
        completedNodeIds.add(node.id)
        scheduler.markCompleted(node.id)
        if (outcome.kind === 'replan') {
          throw new ReplanRequestedError(
            {
              reason: 'routing_no_match',
              details: {
                nodeId: node.id,
                routingResult: outcome.evaluation
              }
            },
            {
              completedNodeIds: Array.from(completedNodeIds),
              nodeOutputs: Object.fromEntries(nodeOutputs.entries()),
              facets: runContext.snapshot(),
              policyActions: policyActions.length ? this.clonePolicyActions(policyActions) : undefined,
              policyAttempts: policyAttempts.size ? Object.fromEntries(policyAttempts.entries()) : undefined,
              postConditionAttempts: postConditionAttempts.size
                ? Object.fromEntries(postConditionAttempts.entries())
                : undefined
            }
          )
        }
        scheduler.markConditionalRelease(node.id, [outcome.selectedTarget])
        continue
      }

      const isVirtual = !node.capabilityId
      if (isVirtual) {
        nodeStatuses.set(node.id, 'running')
        await this.handleVirtualNode(runId, plan, node, opts)
        nodeStatuses.set(node.id, 'completed')
        completedNodeIds.add(node.id)
        scheduler.markCompleted(node.id)
        continue
      }

      const executorType = this.getExecutorType(node)
      const isHumanExecutor = executorType === 'human'
      const startedAt = new Date()
      const initialStatus: FlexPlanNodeStatus = isHumanExecutor ? 'awaiting_human' : 'running'
      nodeStatuses.set(node.id, initialStatus)
      nodeTimings.set(node.id, { ...(nodeTimings.get(node.id) ?? {}), startedAt })

      if (node.bundle.nodeId !== node.id) {
        node.bundle.nodeId = node.id
      }
      if (node.bundle.assignment) {
        const assignmentId = node.bundle.assignment.assignmentId ?? `${runId}:${node.id}`
        node.bundle.assignment.assignmentId = assignmentId
        node.bundle.assignment.runId = node.bundle.assignment.runId ?? runId
        node.bundle.assignment.nodeId = node.id
        node.bundle.assignment.status = 'awaiting_submission'
        node.bundle.assignment.updatedAt = startedAt.toISOString()
        node.bundle.assignment.createdAt = node.bundle.assignment.createdAt ?? startedAt.toISOString()
      }

      const persistenceContext = this.buildPersistenceContext(node, runContext)
      await this.persistence.markNode(runId, node.id, {
        status: initialStatus,
        capabilityId: node.capabilityId,
        label: node.label,
        context: persistenceContext,
        startedAt,
        postConditionGuards: node.postConditionGuards ?? []
      })
      try {
        getLogger().info('flex_node_start', {
          runId,
          nodeId: node.id,
          capabilityId: node.capabilityId,
          executorType,
          correlationId: opts.correlationId
        })
      } catch {}

      const nodeStartPayload = this.compactPayload({
        capabilityId: node.capabilityId,
        label: node.label,
        startedAt: startedAt.toISOString(),
        executorType,
        contracts: node.contracts ? JSON.parse(JSON.stringify(node.contracts)) : undefined,
        facets: node.facets ? JSON.parse(JSON.stringify(node.facets)) : undefined,
        postConditionGuards: node.postConditionGuards ?? [],
        assignment: isHumanExecutor
          ? this.buildHumanAssignmentPayload(node, runId, { runContextSnapshot: runContext.getAllFacets() })
          : undefined
      })

      await opts.onEvent(
        this.buildEvent('node_start', nodeStartPayload, {
          runId,
          nodeId: node.id,
          planVersion: plan.version,
          facetProvenance: this.normalizeFacetProvenance(node.provenance)
        })
      )

      if (isHumanExecutor) {
        await this.pauseForHuman({
          runId,
          envelope,
          plan,
          node,
          opts,
          runContext,
          nodeStatuses,
          nodeOutputs,
          nodeTimings,
          completedNodeIds,
          policyActions,
          policyAttempts,
          schemaHash: opts.schemaHash ?? null
        })
      }

      if (!node.capabilityId) {
        throw new Error(`Execution node ${node.id} is missing capabilityId`)
      }
      const capability = await this.resolveCapability(node.capabilityId)
      const postConditionPolicy = this.resolvePostConditionPolicy(envelope, node, capability)
      const supportsPostConditions = Array.isArray(capability.postConditions) && capability.postConditions.length > 0

      try {
        const emitsFeedback = Array.isArray(node.facets?.output) && node.facets.output.includes('feedback')
        const previousFeedbackEntries = emitsFeedback
          ? this.normalizeFeedbackEntries(runContext.getFacet('feedback')?.value)
          : null
        let resolvedOutput: Record<string, unknown> | null = null
        while (true) {
          const postConditionRetryContext: PostConditionRetryContext | undefined =
            postConditionAttempts.has(node.id) && node.postConditionResults && node.postConditionResults.length
              ? {
                  attempt: postConditionAttempts.get(node.id),
                  maxRetries: postConditionPolicy.maxRetries,
                  results: node.postConditionResults
                }
              : undefined
          const execution = await this.invokeCapability(
            runId,
            node,
            envelope,
            opts,
            plan,
            runContext,
            nodeOutputs,
            nodeStatuses,
            nodeTimings,
            completedNodeIds,
            policyActions,
            policyAttempts,
            postConditionAttempts,
            capability,
            postConditionRetryContext
          )
          const output = execution.output
          const nextFeedbackEntries = emitsFeedback
            ? this.normalizeFeedbackEntries((output ?? ({} as Record<string, unknown>)).feedback)
            : null
          const postConditionResults = supportsPostConditions
            ? this.evaluatePostConditions(capability, node, runContext, output)
            : []
          node.postConditionResults = postConditionResults
          await this.persistence.markNode(runId, node.id, {
            postConditionResults
          })
          if (supportsPostConditions && this.hasFailedPostConditions(postConditionResults)) {
            await this.handlePostConditionFailure({
              runId,
              envelope,
              plan,
              node,
              capability,
              opts,
              runContext,
              nodeOutputs,
              nodeStatuses,
              nodeTimings,
              completedNodeIds,
              policyActions,
              policyAttempts,
              scheduler,
              postConditionAttempts,
              results: postConditionResults,
              policy: postConditionPolicy.policy,
              maxRetries: postConditionPolicy.maxRetries
            })
            continue
          }
          nodeOutputs.set(node.id, output)
          runContext.updateFromNode(node, output)
          resolvedOutput = output
          if (emitsFeedback && previousFeedbackEntries && nextFeedbackEntries) {
            const feedbackChanges = this.diffFeedbackResolutions(previousFeedbackEntries, nextFeedbackEntries)
            if (feedbackChanges.length) {
              await opts.onEvent(
                this.buildEvent(
                  'feedback_resolution',
                  {
                    capabilityId: node.capabilityId,
                    changes: feedbackChanges
                  },
                  {
                    runId,
                    nodeId: node.id,
                    planVersion: plan.version,
                    facetProvenance: this.normalizeFacetProvenance(node.provenance)
                  }
                )
              )
            }
          }
          break
        }
        postConditionAttempts.delete(node.id)

        const completedAt = new Date()
        nodeStatuses.set(node.id, 'completed')
        nodeTimings.set(node.id, { ...(nodeTimings.get(node.id) ?? {}), completedAt })
        await this.persistence.markNode(runId, node.id, {
          status: 'completed',
          output: resolvedOutput,
          completedAt
        })
        try {
          getLogger().info('flex_node_complete', {
            runId,
            nodeId: node.id,
            capabilityId: node.capabilityId,
            correlationId: opts.correlationId
          })
        } catch {}
        await opts.onEvent(
          this.buildEvent(
            'node_complete',
            {
              capabilityId: node.capabilityId,
              label: node.label,
              completedAt: completedAt.toISOString(),
              output: resolvedOutput,
              postConditionResults: node.postConditionResults ?? []
            },
            {
              runId,
              nodeId: node.id,
              planVersion: plan.version,
              facetProvenance: this.normalizeFacetProvenance(node.provenance)
            }
          )
        )

        scheduler.markCompleted(node.id)

        const effect = await opts.onNodeComplete?.({
          node,
          output: resolvedOutput ?? {},
          runId,
          plan
        })
        if (effect) {
          if (effect.kind === 'replan') {
            throw new ReplanRequestedError(effect.trigger, {
              completedNodeIds: Array.from(completedNodeIds),
              nodeOutputs: Object.fromEntries(nodeOutputs.entries()),
              facets: runContext.snapshot(),
              policyActions: policyActions.length ? policyActions.map((action) => ({ ...action })) : undefined,
              policyAttempts: policyAttempts.size ? Object.fromEntries(policyAttempts.entries()) : undefined,
              postConditionAttempts: postConditionAttempts.size
                ? Object.fromEntries(postConditionAttempts.entries())
                : undefined
            })
          }
          if (effect.kind === 'action') {
            const actionOutcome = await this.handleRuntimePolicyAction(
              effect.policy,
              {
                runId,
                envelope,
                plan,
                opts,
                node,
                runContext,
                nodeOutputs,
                nodeStatuses,
                nodeTimings,
                completedNodeIds,
                policyActions,
                policyAttempts,
                postConditionAttempts,
                scheduler
              },
              { source: POLICY_ACTION_SOURCE.runtime }
            )
            if (actionOutcome?.kind === 'goto') {
              scheduler.refreshAll()
              continue
            }
          }
        }
      } catch (error) {
        if (error instanceof ReplanRequestedError) {
          throw error
        }
        if (error instanceof AwaitingHumanInputError) {
          throw error
        }
        if (error instanceof HitlPauseError) {
          throw error
        }
        if (error instanceof RunPausedError) {
          throw error
        }
        if (error instanceof RuntimePolicyFailureError) {
          throw error
        }
        const errorAt = new Date()
        const serialized = this.serializeError(error)
        nodeStatuses.set(node.id, 'error')
        nodeTimings.set(node.id, { ...(nodeTimings.get(node.id) ?? {}), completedAt: errorAt })
        await this.persistence.markNode(runId, node.id, {
          status: 'error',
          error: serialized,
          completedAt: errorAt
        })
        nodeOutputs.delete(node.id)
        completedNodeIds.delete(node.id)
        try {
          getLogger().error('flex_node_error', {
            runId,
            nodeId: node.id,
            capabilityId: node.capabilityId,
            correlationId: opts.correlationId,
            error: serialized.message ?? serialized.name ?? 'unknown_error'
          })
        } catch {}
        await opts.onEvent(
          this.buildEvent(
            'node_error',
            {
              capabilityId: node.capabilityId,
              label: node.label,
              error: serialized
            },
            {
              runId,
              nodeId: node.id,
              message: serialized.message as string | undefined,
              planVersion: plan.version,
              facetProvenance: this.normalizeFacetProvenance(node.provenance)
            }
          )
        )
        throw error
      }
    }

    const composedOutput = runContext.composeFinalOutput(envelope.outputContract, plan)
    const finalOutput =
      Object.keys(composedOutput).length > 0 ? composedOutput : this.composeFinalOutput(plan, nodeOutputs)

    if (this.requiresHitlApproval(envelope)) {
      const terminalNode = this.getTerminalExecutionNode(plan)
      if (!terminalNode) {
        throw new Error('No terminal node available for HITL approval')
      }

      await this.triggerHitlPause({
        runId,
        envelope,
        plan,
        opts,
        runContext,
        targetNode: terminalNode,
        finalOutput,
        nodeOutputs,
        nodeStatuses,
        nodeTimings,
        completedNodeIds,
        schemaHash: opts.schemaHash ?? null,
        policyActions,
        policyAttempts,
        postConditionAttempts
      })
    }

    await this.ensureOutputMatchesContract(
      envelope.outputContract,
      finalOutput,
      { scope: 'final_output', runId },
      opts
    )

    const facetsSnapshot = runContext.snapshot()
    const goalConditionResults =
      envelope.goal_condition && envelope.goal_condition.length
        ? evaluateGoalConditions(envelope.goal_condition, { runContextSnapshot: facetsSnapshot })
        : []
    const failedGoalConditions = goalConditionResults.filter(
      (entry) => !entry.satisfied || (typeof entry.error === 'string' && entry.error.length > 0)
    )
    if (failedGoalConditions.length) {
      throw new GoalConditionFailedError({
        state: {
          completedNodeIds: Array.from(completedNodeIds),
          nodeOutputs: Object.fromEntries(nodeOutputs.entries()),
          facets: facetsSnapshot,
          ...(policyActions.length ? { policyActions: this.clonePolicyActions(policyActions) } : {}),
          ...(policyAttempts.size ? { policyAttempts: Object.fromEntries(policyAttempts.entries()) } : {}),
          postConditionAttempts: postConditionAttempts.size
            ? Object.fromEntries(postConditionAttempts.entries())
            : undefined
        },
        results: goalConditionResults,
        failed: failedGoalConditions,
        finalOutput
      })
    }

    const snapshotNodes = this.buildPlanSnapshotNodes(plan, nodeStatuses, nodeOutputs, nodeTimings)
    const provenance = this.extractOutputProvenance(facetsSnapshot, finalOutput)
    await this.persistence.recordResult(runId, finalOutput, {
      planVersion: plan.version,
      status: 'completed',
      schemaHash: opts.schemaHash ?? null,
      facets: facetsSnapshot,
      provenance,
      goalConditionResults: goalConditionResults.length ? goalConditionResults : null,
      snapshot: {
        planVersion: plan.version,
        nodes: snapshotNodes,
        edges: plan.edges,
        planMetadata: plan.metadata,
        pendingState: {
          completedNodeIds: Array.from(completedNodeIds),
          nodeOutputs: Object.fromEntries(nodeOutputs.entries()),
          policyActions: this.clonePolicyActions(policyActions),
          policyAttempts: policyAttempts.size ? Object.fromEntries(policyAttempts.entries()) : undefined,
          postConditionAttempts: postConditionAttempts.size
            ? Object.fromEntries(postConditionAttempts.entries())
            : undefined,
          mode: opts.initialState?.mode
        }
      }
    })
    const postConditionCompletePayload =
      snapshotNodes
        .map((node) => ({
          nodeId: node.nodeId,
          capabilityId: node.capabilityId ?? null,
          results: node.postConditionResults ?? []
        }))
        .filter((entry) => entry.results && entry.results.length) ?? []
    const completePayload: Record<string, unknown> = { output: finalOutput }
    if (goalConditionResults.length) {
      completePayload.goal_condition_results = goalConditionResults
    }
    if (postConditionCompletePayload.length) {
      completePayload.post_condition_results = postConditionCompletePayload
    }
    await opts.onEvent(
      this.buildEvent(
        'complete',
        completePayload,
        {
          runId,
          planVersion: plan.version,
          facetProvenance: this.normalizeFacetProvenance(provenance)
        }
      )
    )
    return finalOutput
  }

  private async invokeCapability(
    runId: string,
    node: FlexPlanNode,
    envelope: TaskEnvelope,
    opts: FlexExecutionOptions,
    plan: FlexPlan,
    runContext: RunContext,
    nodeOutputs: Map<string, Record<string, unknown>>,
    nodeStatuses: Map<string, FlexPlanNodeStatus>,
    nodeTimings: Map<string, NodeTiming>,
    completedNodeIds: Set<string>,
    policyActions: PendingPolicyActionState[],
    policyAttempts: Map<string, number>,
    postConditionAttempts: Map<string, number>,
    capability: CapabilityRecord,
    postConditionRetryContext?: PostConditionRetryContext
  ): Promise<CapabilityResult> {
    if (!node.capabilityId) {
      throw new Error(`Execution node ${node.id} is missing capabilityId`)
    }
    const capabilityInputs = this.resolveCapabilityInputs(node, runContext)
    await this.validateCapabilityInputs(capability, node, runId, opts, capabilityInputs)

    const dispatch = async () => {
      try {
        getLogger().info('flex_capability_dispatch_start', {
          runId,
          nodeId: node.id,
          capabilityId: capability.capabilityId,
          correlationId: opts.correlationId
        })
      } catch {}
      const outcome = await this.dispatchCapability(
        capability,
        node,
        envelope,
        plan,
        runContext,
        nodeOutputs,
        capabilityInputs,
        postConditionRetryContext
      )
      try {
        getLogger().info('flex_capability_dispatch_complete', {
          runId,
          nodeId: node.id,
          capabilityId: capability.capabilityId,
          correlationId: opts.correlationId
        })
      } catch {}
      const preferredContract = node.contracts.output ?? capability.outputContract
      const contract = preferredContract ?? null
      const shouldValidateOutput = (node.kind ?? 'execution') === 'execution'
      if (contract && shouldValidateOutput) {
        await this.ensureOutputMatchesContract(
          contract,
          outcome.output,
          { scope: 'capability_output', runId, nodeId: node.id },
          opts
        )
      }
      return outcome
    }

    const hitl = opts.hitl
    if (!hitl) {
      return dispatch()
    }

    let pendingRecord: HitlRequestRecord | null = null
    let latestState: HitlRunState = hitl.state

    const result = await withHitlContext(
      {
        runId,
        threadId: hitl.threadId ?? undefined,
        stepId: node.id,
        capabilityId: node.capabilityId,
        hitlService: hitl.service,
        limit: hitl.limit,
        onRequest: async (record, state) => {
          pendingRecord = record
          latestState = state
          if (hitl.onRequest) await hitl.onRequest(record, state)
        },
        onDenied: async (reason, state) => {
          latestState = state
          if (hitl.onDenied) await hitl.onDenied(reason, state)
        },
        snapshot: hitl.state
      },
      async () => dispatch()
    )

    if (latestState !== hitl.state) {
      hitl.state = latestState
      hitl.updateState?.(latestState)
    }

    if (pendingRecord) {
      await this.pauseForHitlRequest({
        runId,
        envelope,
        plan,
        opts,
        runContext,
        node,
        nodeOutputs,
        nodeStatuses,
        nodeTimings,
        completedNodeIds,
        policyActions,
        policyAttempts,
        postConditionAttempts,
        request: pendingRecord
      })
    }

    return result
  }

  async validateNodeOutput(
    node: FlexPlanNode,
    output: Record<string, unknown>,
    runId: string,
    opts: FlexExecutionOptions
  ) {
    const contract = node.contracts?.output
    if (!contract) return
    await this.ensureOutputMatchesContract(contract, output, { scope: 'capability_output', runId, nodeId: node.id }, opts)
  }

  private async resolveCapability(capabilityId: string): Promise<CapabilityRecord> {
    const capability = await this.capabilityRegistry.getCapabilityById(capabilityId)
    if (capability && capability.status === 'active') {
      return capability
    }
    throw new Error(`Capability ${capabilityId} not registered or inactive`)
  }

  private async handleRuntimePolicyAction(
    policy: RuntimePolicy,
    context: {
      runId: string
      envelope: TaskEnvelope
      plan: FlexPlan
      opts: FlexExecutionOptions
      node: FlexPlanNode
      runContext: RunContext
      nodeOutputs: Map<string, Record<string, unknown>>
      nodeStatuses: Map<string, FlexPlanNodeStatus>
      nodeTimings: Map<string, NodeTiming>
      completedNodeIds: Set<string>
      policyActions: PendingPolicyActionState[]
      policyAttempts: Map<string, number>
      postConditionAttempts: Map<string, number>
      scheduler?: PlanScheduler
    },
    options: {
      actionOverride?: Action
      source?: PolicyActionSource
      requestId?: string | null
    } = {}
  ): Promise<RuntimePolicyActionResult | null> {
    const action = options.actionOverride ?? policy.action
    const actionDetails = this.describePolicyAction(action)
    const source = options.source ?? POLICY_ACTION_SOURCE.runtime
    const policyPayload: Record<string, unknown> = {
      policyId: policy.id,
      action: action.type,
      actionDetails,
      nodeId: context.node.id,
      capabilityId: context.node.capabilityId,
      source
    }
    if (options.requestId) {
      policyPayload.requestId = options.requestId
    }
    if (action.type === 'emit') {
      policyPayload.event = action.event
      if (action.payload !== undefined) {
        policyPayload.payload = action.payload
      }
    }
    try {
      await context.opts.onEvent(
        this.buildEvent('policy_triggered', policyPayload, {
          runId: context.runId,
          nodeId: context.node.id,
          message: `runtime_policy:${source}:${action.type}`,
          planVersion: context.plan.version
        })
      )
    } catch {}

    switch (action.type) {
      case 'hitl': {
        const finalOutput = context.runContext.composeFinalOutput(context.envelope.outputContract, context.plan)
        const followUpEntry: PendingPolicyActionState = {
          policyId: policy.id,
          nodeId: context.node.id,
          requestId: null,
          approveAction: action.approveAction ?? undefined,
          rejectAction: action.rejectAction ?? undefined
        }
        context.policyActions.push(followUpEntry)
          await this.triggerHitlPause({
            runId: context.runId,
            envelope: context.envelope,
            plan: context.plan,
            opts: context.opts,
          runContext: context.runContext,
          targetNode: context.node,
          finalOutput,
          nodeOutputs: context.nodeOutputs,
          nodeStatuses: context.nodeStatuses,
          nodeTimings: context.nodeTimings,
          completedNodeIds: context.completedNodeIds,
          schemaHash: context.opts.schemaHash ?? null,
            rationale: action.rationale,
            policyId: policy.id,
            pendingPolicyAction: followUpEntry,
            policyActions: context.policyActions,
            policyAttempts: context.policyAttempts,
            postConditionAttempts: context.postConditionAttempts
          })
        return { kind: 'noop' }
      }
      case 'emit': {
        await this.emitRuntimeEvent({
          runId: context.runId,
          node: context.node,
          opts: context.opts,
          eventName: action.event,
          payload: action.payload ?? {},
          policyId: policy.id,
          rationale: action.rationale,
          planVersion: context.plan.version
        })
        return { kind: 'noop' }
      }
      case 'goto': {
        return await this.handleGotoAction({
          policy,
          action,
          context
        })
      }
      case 'fail': {
        throw new RuntimePolicyFailureError(
          policy.id,
          action.message ?? `Runtime policy ${policy.id} requested failure`
        )
      }
      case 'pause': {
        await this.triggerPolicyPause({
          policyId: policy.id,
          reason: action.reason,
          context
        })
        return { kind: 'noop' }
      }
      default: {
        try {
          getLogger().warn('flex_runtime_policy_unhandled', {
            runId: context.runId,
            policyId: policy.id,
            action: action.type
          })
        } catch {}
        return { kind: 'noop' }
      }
    }
  }

  private resolveCapabilityInputs(node: FlexPlanNode, runContext: RunContext): Record<string, unknown> {
    const base =
      node.bundle.inputs && typeof node.bundle.inputs === 'object'
        ? (this.cloneJson(node.bundle.inputs) as Record<string, unknown>)
        : {}
    const merged: Record<string, unknown> = { ...base }
    const facetNames = Array.isArray(node.facets?.input) ? node.facets!.input : []
    if (facetNames.length) {
      const facetSnapshot = runContext.getAllFacets()
      facetNames.forEach((facet) => {
        const entry = facetSnapshot[facet]
        if (entry && Object.prototype.hasOwnProperty.call(entry, 'value')) {
          merged[facet] = this.cloneJson(entry.value)
        }
      })
    }
    return merged
  }

  private normalizeCapabilityOutput(
    output: Record<string, unknown> | null | undefined
  ): Record<string, unknown> | null {
    if (!output || typeof output !== 'object') {
      return output ?? null
    }
    const maybeWrapped = output as { output?: unknown }
    const keys = Object.keys(maybeWrapped)
    if (keys.length === 1 && Object.prototype.hasOwnProperty.call(maybeWrapped, 'output')) {
      const inner = maybeWrapped.output
      if (inner && typeof inner === 'object') {
        return this.cloneJson(inner as Record<string, unknown>)
      }
      return (inner ?? null) as Record<string, unknown> | null
    }
    return this.cloneJson(output)
  }

  private cloneJson<T>(value: T): T {
    if (value === undefined || value === null) {
      return value
    }
    try {
      return JSON.parse(JSON.stringify(value)) as T
    } catch {
      return value
    }
  }

  private async validateCapabilityInputs(
    capability: CapabilityRecord,
    node: FlexPlanNode,
    runId: string,
    opts: FlexExecutionOptions,
    inputs: Record<string, unknown>
  ) {
    if ((node.kind ?? 'execution') !== 'execution') {
      return
    }
    const candidateContract =
      node.contracts.input ??
      capability.inputContract ??
      (() => {
        const metadata = (capability.metadata ?? {}) as Record<string, unknown>
        const legacySchema = metadata.inputSchema
        if (legacySchema && typeof legacySchema === 'object') {
          return { mode: 'json_schema', schema: legacySchema } as CapabilityContract
        }
        return undefined
      })()

    if (candidateContract?.mode !== 'json_schema') return

    await this.validateSchema(
      candidateContract.schema as Record<string, unknown>,
      inputs,
      { scope: 'capability_input', runId, nodeId: node.id },
      opts
    )
  }

  private async dispatchCapability(
    capability: CapabilityRecord,
    node: FlexPlanNode,
    envelope: TaskEnvelope,
    plan: FlexPlan,
    runContext: RunContext,
    nodeOutputs: Map<string, Record<string, unknown>>,
    capabilityInputs: Record<string, unknown>,
    postConditionRetryContext?: PostConditionRetryContext
  ): Promise<CapabilityResult> {
    return this.executeCapability(
      capability,
      node,
      envelope,
      plan,
      runContext,
      nodeOutputs,
      capabilityInputs,
      postConditionRetryContext
    )
  }

  private async executeCapability(
    capability: CapabilityRecord,
    node: FlexPlanNode,
    envelope: TaskEnvelope,
    plan: FlexPlan,
    runContext: RunContext,
    nodeOutputs: Map<string, Record<string, unknown>>,
    capabilityInputs: Record<string, unknown>,
    postConditionRetryContext?: PostConditionRetryContext
  ): Promise<CapabilityResult> {
    const schemaShape = this.getOutputSchemaShape(node, capability)
    const schema = this.buildOutputSchema(schemaShape)
    const promptContext = resolveCapabilityPrompt(capability.capabilityId)
    const messages = this.buildCapabilityMessages({
      capability,
      node,
      envelope,
      plan,
      runContext,
      nodeOutputs,
      schemaShape,
      promptContext,
      inputs: capabilityInputs,
      retryContext: postConditionRetryContext
    })

    const metadata = (node.metadata ?? {}) as Record<string, unknown>
    const plannerStage =
      typeof metadata.plannerStage === 'string' ? (metadata.plannerStage as string) : undefined

    const runOptions: {
      schemaName: string
      toolsAllowlist?: string[]
      toolPolicy?: 'auto' | 'required' | 'off'
    } = {
      schemaName: plannerStage ?? capability.capabilityId
    }

    if (promptContext?.toolsAllowlist?.length) {
      runOptions.toolsAllowlist = promptContext.toolsAllowlist
      runOptions.toolPolicy = 'auto'
    }

    const result = await this.runtime.runStructured<Record<string, unknown>>(schema, messages, runOptions)
    const normalizedOutput = this.normalizeCapabilityOutput(result)

    return {
      output: (normalizedOutput ?? {}) as Record<string, unknown>
    }
  }

  private getOutputSchemaShape(node: FlexPlanNode, capability: CapabilityRecord): JsonSchemaShape | null {
    const contract = node.contracts?.output ?? capability.outputContract
    if (!contract) return null
    if (contract.mode === 'json_schema') {
      return (contract.schema ?? null) as JsonSchemaShape | null
    }
    if (contract.mode === 'facets') {
      const compiled = this.facetCompiler.compileContracts({
        inputFacets: [],
        outputFacets: contract.facets ?? []
      })
      return compiled.output?.schema ?? null
    }
    return null
  }

  private buildOutputSchema(shape: JsonSchemaShape | null): ZodTypeAny {
    if (!shape) {
      return z.record(z.string(), z.unknown())
    }
    return jsonSchemaToZod(shape)
  }

  private buildCapabilityMessages(args: {
    capability: CapabilityRecord
    node: FlexPlanNode
    envelope: TaskEnvelope
    plan: FlexPlan
    runContext: RunContext
    nodeOutputs: Map<string, Record<string, unknown>>
    schemaShape: JsonSchemaShape | null
    promptContext: ReturnType<typeof resolveCapabilityPrompt> | null
    inputs: Record<string, unknown>
    retryContext?: PostConditionRetryContext
  }): Array<{ role: 'system' | 'user'; content: string }> {
    const { capability, node, envelope, runContext, nodeOutputs, schemaShape, promptContext, inputs, retryContext } = args
    const instructions = Array.isArray(node.bundle.instructions) ? node.bundle.instructions : []
    const metadata = (node.metadata ?? {}) as Record<string, unknown>
    const plannerStage =
      typeof metadata.plannerStage === 'string' ? metadata.plannerStage : node.label ?? node.kind ?? 'unspecified'
    const rationale = Array.isArray(node.rationale) ? node.rationale : []
    const policies = (node.bundle.policies ?? {}) as Record<string, unknown>
    const facetSnapshot = runContext.getAllFacets()
    const outputFacetNames = this.resolveOutputFacets(node, capability)
    const completedOutputs = Array.from(nodeOutputs.entries()).map(([nodeId, value]) => ({
      nodeId,
      sample: value
    }))

    const agentInstruction = promptContext?.instructions ?? null

    const systemParts: string[] = []
    if (agentInstruction) {
      systemParts.push(agentInstruction)
    }
    systemParts.push(
      `You are executing capability "${capability.displayName}" (ID: ${capability.capabilityId}).`,
      capability.summary ? `Capability summary: ${capability.summary}` : 'Capability summary: (not provided).',
      'Follow the planner-provided instructions precisely.',
      'Respect the capability input contract when constructing the request payload and ensure outputs satisfy the declared output contract.'
    )
    if (instructions.length) {
      systemParts.push(
        ['Planner instructions:']
          .concat(instructions.map((line) => `- ${line}`))
          .join('\n')
      )
    }

    const userSections: string[] = []
    userSections.push(`Planner stage: ${plannerStage}`)
    userSections.push(`Objective:\n${node.bundle.objective}`)

    if (Object.keys(inputs).length) {
      userSections.push(`Inputs:\n${stringifyForPrompt(inputs)}`)
    }
    if (Object.keys(policies).length) {
      userSections.push(`Policies:\n${stringifyForPrompt(policies)}`)
    }

    const postConditionRetrySection = this.buildPostConditionRetrySection(node, retryContext)
    if (postConditionRetrySection) {
      userSections.push(postConditionRetrySection)
    }

    if (completedOutputs.length) {
      userSections.push(`Recently completed node outputs:\n${stringifyForPrompt(completedOutputs)}`)
    }

    const feedbackSummary = this.buildFeedbackSummary(facetSnapshot, outputFacetNames)
    if (feedbackSummary) {
      userSections.push(feedbackSummary)
    }

    if (facetSnapshot && Object.keys(facetSnapshot).length) {
      userSections.push(`Facet snapshot:\n${stringifyForPrompt(facetSnapshot)}`)
    }

    const clarifications = runContext
      .getHitlClarifications()
      .filter((entry) => entry.nodeId === node.id)
    if (clarifications.length) {
      const lines = clarifications.map((entry) => {
        const askedAt = entry.createdAt || 'unknown'
        const answered = entry.answer && entry.answer.trim().length ? entry.answer.trim() : null
        const answeredAt = entry.answeredAt || 'pending'
        const questionLine = `• Question (${askedAt}): ${entry.question}`
        const answerLine = answered
          ? `  Answer (${answeredAt}): ${answered}`
          : '  Answer: pending operator response.'
        return `${questionLine}\n${answerLine}`
      })
      userSections.push(['HITL clarifications history:'].concat(lines).join('\n'))
    }

    if (rationale.length) {
      userSections.push(
        ['Planner rationale:']
          .concat(rationale.map((entry) => `- ${entry}`))
          .join('\n')
      )
    }

    if (capability.inputContract) {
      userSections.push(`Capability input contract:\n${stringifyForPrompt(capability.inputContract)}`)
    }

    if (capability.outputContract) {
      userSections.push(`Capability output contract:\n${stringifyForPrompt(capability.outputContract)}`)
    }

    if (schemaShape) {
      userSections.push(`Planner-resolved output schema:\n${stringifyForPrompt(schemaShape)}`)
    } else {
      userSections.push('Output contract: Produce a JSON object with the facets declared for this node.')
    }

    if (Array.isArray(envelope.specialInstructions) && envelope.specialInstructions.length) {
      userSections.push(
        ['Caller special instructions:']
          .concat(envelope.specialInstructions.map((entry) => `- ${entry}`))
          .join('\n')
      )
    }

    return [
      {
        role: 'system' as const,
        content: systemParts.join('\n\n')
      },
      {
        role: 'user' as const,
        content: userSections.join('\n\n')
      }
    ]
  }

  private buildPostConditionRetrySection(
    node: FlexPlanNode,
    retryContext?: PostConditionRetryContext
  ): string | null {
    const results = retryContext?.results ?? (Array.isArray(node.postConditionResults) ? node.postConditionResults : [])
    if (!results || !results.length) {
      return null
    }
    const failing = results.filter(
      (entry) => !entry.satisfied || (typeof entry.error === 'string' && entry.error.length > 0)
    )
    if (!failing.length) {
      return null
    }
    const summary: Record<string, unknown> = {
      failures: failing.map((entry) => ({
        facet: entry.facet,
        path: entry.path,
        satisfied: entry.satisfied,
        ...(entry.error ? { error: entry.error } : {}),
        ...(entry.observedValue !== undefined ? { observedValue: entry.observedValue } : {})
      }))
    }
    if (typeof retryContext?.attempt === 'number') {
      summary.failuresSoFar = retryContext.attempt
    }
    if (typeof retryContext?.maxRetries === 'number') {
      summary.maxRetries = retryContext.maxRetries
    }
    return ['Previous post-condition failures detected.', stringifyForPrompt(summary)].join('\n')
  }

  private composeFinalOutput(plan: FlexPlan, nodeOutputs: Map<string, Record<string, unknown>>) {
    if (!plan.nodes.length) return {}
    for (let i = plan.nodes.length - 1; i >= 0; i -= 1) {
      const node = plan.nodes[i]
      const output = nodeOutputs.get(node.id)
      if (output) return output
    }
    return {}
  }

  private resolveOutputFacets(node: FlexPlanNode, capability: CapabilityRecord): string[] {
    const nodeFacets = Array.isArray(node.facets?.output) ? node.facets.output : []
    if (nodeFacets.length) {
      return [...nodeFacets]
    }
    const contract = capability.outputContract
    if (contract && contract.mode === 'facets' && Array.isArray(contract.facets)) {
      return [...contract.facets]
    }
    return []
  }

  private buildFeedbackSummary(facets: FacetSnapshot | undefined, outputFacets: string[]): string | null {
    if (!facets || !outputFacets.length) return null
    const feedbackEntry = facets.feedback
    const feedbackValue = feedbackEntry?.value
    if (!Array.isArray(feedbackValue) || !feedbackValue.length) return null

    type FeedbackRecord = {
      facet: string
      message: string
      severity?: string
      resolution?: string
      author?: string
      timestamp?: string
    }

    const sanitizeMessage = (value: string): string => {
      const normalized = value.replace(/\s+/g, ' ').trim()
      if (!normalized) return '(no message provided)'
      if (normalized.length <= 240) return normalized
      return `${normalized.slice(0, 237)}…`
    }

    const candidates: FeedbackRecord[] = []
    for (const entry of feedbackValue) {
      if (!entry || typeof entry !== 'object') continue
      const record = entry as Record<string, unknown>
      const facet = typeof record.facet === 'string' ? record.facet : null
      if (!facet || !outputFacets.includes(facet)) continue
      const message =
        typeof record.message === 'string' ? sanitizeMessage(record.message) : '(no message provided)'
      const candidate: FeedbackRecord = { facet, message }
      if (typeof record.severity === 'string') candidate.severity = record.severity
      if (typeof record.resolution === 'string') candidate.resolution = record.resolution
      if (typeof record.author === 'string') candidate.author = record.author
      if (typeof record.timestamp === 'string') candidate.timestamp = record.timestamp
      candidates.push(candidate)
    }

    if (!candidates.length) return null

    const unresolved = candidates.filter(
      (entry) => !entry.resolution || entry.resolution === 'open'
    )
    const prioritized = unresolved.length ? unresolved : candidates
    const maxItems = 5

    const formatTimestamp = (value?: string): string => {
      if (!value) return ''
      const trimmed = value.length > 19 ? value.slice(0, 19) : value
      return ` @ ${trimmed}`
    }

    const lines = prioritized.slice(0, maxItems).map((entry) => {
      const meta: string[] = []
      if (entry.severity) meta.push(entry.severity)
      if (entry.resolution && entry.resolution !== 'open') meta.push(entry.resolution)
      const metaText = meta.length ? ` (${meta.join(', ')})` : ''
      const authorText = entry.author ? ` — ${entry.author}` : ''
      const timestampText = formatTimestamp(entry.timestamp)
      return `- [${entry.facet}]${metaText} ${entry.message}${authorText}${timestampText}`
    })

    if (prioritized.length > maxItems) {
      lines.push(`- … ${prioritized.length - maxItems} additional feedback item(s) omitted for brevity.`)
    }

    return ['Relevant feedback for output facets:', ...lines].join('\n')
  }

  private normalizeFeedbackEntries(value: unknown): Map<string, FeedbackHistoryEntry> {
    const entries = new Map<string, FeedbackHistoryEntry>()
    if (!value) return entries
    const source = Array.isArray(value) ? value : [value]
    for (const raw of source) {
      if (!raw || typeof raw !== 'object') continue
      const entry = raw as Record<string, unknown>
      const facet = typeof entry.facet === 'string' ? entry.facet : null
      const path = typeof entry.path === 'string' ? entry.path : null
      const message = typeof entry.message === 'string' ? entry.message : null
      const note = typeof entry.note === 'string' ? entry.note : null
      const id = typeof entry.id === 'string' ? entry.id : null
      const resolutionRaw = typeof entry.resolution === 'string' ? entry.resolution : null
      const resolution = resolutionRaw && resolutionRaw.trim().length ? resolutionRaw : 'open'
      const key = id ?? `${facet ?? 'unknown'}::${path ?? ''}::${message ?? ''}`
      entries.set(key, { key, id, facet, path, message, note, resolution })
    }
    return entries
  }

  private diffFeedbackResolutions(
    previous: Map<string, FeedbackHistoryEntry>,
    next: Map<string, FeedbackHistoryEntry>
  ): FeedbackResolutionChangePayload[] {
    const changes: FeedbackResolutionChangePayload[] = []
    for (const [key, nextEntry] of next.entries()) {
      const prevEntry = previous.get(key)
      if (!prevEntry) continue
      if (prevEntry.resolution === nextEntry.resolution) continue
      changes.push({
        key,
        facet: nextEntry.facet ?? prevEntry.facet ?? null,
        path: nextEntry.path ?? prevEntry.path ?? null,
        message: nextEntry.message ?? prevEntry.message ?? null,
        note: nextEntry.note ?? prevEntry.note ?? null,
        previous: prevEntry.resolution,
        current: nextEntry.resolution
      })
    }
    return changes
  }

  private getTerminalExecutionNode(plan: FlexPlan): FlexPlanNode | undefined {
    for (let i = plan.nodes.length - 1; i >= 0; i -= 1) {
      const node = plan.nodes[i]
      if (node.kind === 'execution') {
        return node
      }
    }
    return plan.nodes[plan.nodes.length - 1]
  }

  private buildHitlRequestDetails(
    envelope: TaskEnvelope,
    finalOutput: Record<string, unknown>,
    context: {
      question?: string | null
      policyId?: string
      nodeLabel?: string
      plan: FlexPlan
      node: FlexPlanNode
    }
  ): { payload: HitlRequestPayload; operatorPrompt: string; contractSummary?: HitlContractSummary } {
    const copyVariantsRaw = (finalOutput as Record<string, unknown>).copyVariants
    const variants = Array.isArray(copyVariantsRaw) ? copyVariantsRaw : []
    const objective = (envelope.objective || '').trim()
    const summaryLines = [
      objective ? `Objective: ${objective}` : null,
      variants.length
        ? `Generated ${variants.length} variant${variants.length === 1 ? '' : 's'} for review.`
        : 'No structured variants detected.'
    ].filter(Boolean) as string[]

    if (context.policyId) {
      summaryLines.push(`Runtime policy: ${context.policyId}`)
    }
    if (context.nodeLabel) {
      summaryLines.push(`Triggered by node: ${context.nodeLabel}`)
    }

    const defaultQuestion = 'Review generated flex run output and approve before completing the request.'
    const question = context.question?.trim() ? context.question.trim() : defaultQuestion

    summaryLines.push('Operator options: Approve output or request revisions.')

    const payload: HitlRequestPayload = {
      question,
      kind: 'approval',
      allowFreeForm: true,
      urgency: 'normal',
      additionalContext: summaryLines.join(' ')
    }

    const node = context.node
    const outputFacets = node.provenance.output?.map((entry) => entry.title) ?? []
    const inputFacets = node.provenance.input?.map((entry) => entry.title) ?? []
    const cloneJson = <T>(value: T): T => {
      if (value == null) return value
      try {
        return JSON.parse(JSON.stringify(value)) as T
      } catch {
        return value
      }
    }

    const contractSummary: HitlContractSummary = {
      nodeId: node.id,
      nodeLabel: node.label,
      capabilityId: node.capabilityId ?? undefined,
      capabilityLabel: node.capabilityLabel,
      planVersion: context.plan.version,
      contract: {
        ...(node.contracts.input ? { input: cloneJson(node.contracts.input) } : {}),
        output: cloneJson(node.contracts.output)
      },
      facets:
        inputFacets.length || outputFacets.length
          ? {
              ...(inputFacets.length
                ? {
                    input: cloneJson(
              node.provenance.input?.map(({ title, facet, pointer }) => ({
                title,
                direction: 'input' as const,
                facet,
                pointer
              }))
                    )
                  }
                : {}),
              ...(outputFacets.length
                ? {
                    output: cloneJson(
              node.provenance.output?.map(({ title, facet, pointer }) => ({
                title,
                direction: 'output' as const,
                facet,
                pointer
              }))
                    )
                  }
                : {})
            }
          : undefined
    }

    const promptLines: string[] = []
    promptLines.push(
      `Plan v${context.plan.version}: pause on "${node.label}" (${node.capabilityLabel}${node.capabilityId ? ` :: ${node.capabilityId}` : ''}).`
    )
    if (outputFacets.length) {
      promptLines.push(`Ensure outputs satisfy: ${outputFacets.join(', ')}.`)
    }
    if (inputFacets.length) {
      promptLines.push(`Inputs considered: ${inputFacets.join(', ')}.`)
    }
    if (context.policyId) {
      promptLines.push(`Policy trigger: ${context.policyId}.`)
    }
    promptLines.push(`Recommended action: ${question}`)
    if (summaryLines.length) {
      promptLines.push(summaryLines.join(' '))
    }

    return {
      payload,
      operatorPrompt: promptLines.join('\n'),
      contractSummary
    }
  }

  private async emitRuntimeEvent(args: {
    runId: string
    node: FlexPlanNode
    opts: FlexExecutionOptions
    eventName: string
    payload: Record<string, unknown>
    policyId: string
    rationale?: string
    planVersion: number
  }) {
    const { runId, node, opts, eventName, payload, policyId, rationale, planVersion } = args
    try {
      await opts.onEvent(
        this.buildEvent(
          'policy_update',
          {
            policyId,
            action: 'emit',
            event: eventName,
          payload
        },
        {
          runId,
          nodeId: node.id,
          message: `runtime_policy_emit:${eventName}`,
          planVersion
        }
      )
      )
    } catch {}
    try {
      await opts.onEvent(
        this.buildEvent(
          'log',
          {
            severity: 'info',
            policyId,
            action: 'emit',
            event: eventName,
            payload
          },
          {
            runId,
            nodeId: node.id,
            message: rationale ?? undefined,
            planVersion
          }
        )
      )
    } catch {}
  }

  private describePolicyAction(action: Action): Record<string, unknown> {
    switch (action.type) {
      case 'goto':
        return {
          type: 'goto',
          next: action.next,
          ...(action.maxAttempts ? { maxAttempts: action.maxAttempts } : {})
        }
      case 'hitl':
        return {
          type: 'hitl',
          ...(action.rationale ? { rationale: action.rationale } : {}),
          ...(action.approveAction ? { approveAction: this.describePolicyAction(action.approveAction) } : {}),
          ...(action.rejectAction ? { rejectAction: this.describePolicyAction(action.rejectAction) } : {})
        }
      case 'fail':
        return {
          type: 'fail',
          ...(action.message ? { message: action.message } : {})
        }
      case 'pause':
        return {
          type: 'pause',
          ...(action.reason ? { reason: action.reason } : {})
        }
      case 'emit':
        return {
          type: 'emit',
          event: action.event,
          ...(action.payload ? { payload: action.payload } : {})
        }
      case 'replan':
        return {
          type: 'replan',
          ...(action.rationale ? { rationale: action.rationale } : {})
        }
      default:
        return { type: action.type }
    }
  }

  private compactPayload(payload: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined && value !== null)
    )
  }

  private clonePolicyActions(actions: PendingPolicyActionState[]): PendingPolicyActionState[] {
    return actions.map((action) => JSON.parse(JSON.stringify(action)) as PendingPolicyActionState)
  }

  private async handleGotoAction(args: {
    policy: RuntimePolicy
    action: Extract<Action, { type: 'goto' }>
    context: {
      runId: string
      plan: FlexPlan
      opts: FlexExecutionOptions
      node: FlexPlanNode
      nodeOutputs: Map<string, Record<string, unknown>>
      nodeStatuses: Map<string, FlexPlanNodeStatus>
      nodeTimings: Map<string, NodeTiming>
      completedNodeIds: Set<string>
      policyAttempts: Map<string, number>
      scheduler?: PlanScheduler
    }
  }): Promise<RuntimePolicyActionResult> {
    const { policy, action, context } = args
    const attempts = (context.policyAttempts.get(policy.id) ?? 0) + 1
    context.policyAttempts.set(policy.id, attempts)
    const maxAttempts = action.maxAttempts ?? 1
    if (attempts > maxAttempts) {
      try {
        getLogger().info('flex_runtime_policy_goto_skipped', {
          runId: context.runId,
          policyId: policy.id,
          next: action.next,
          attempts,
          maxAttempts
        })
      } catch {}
      return { kind: 'noop' }
    }

    const targetIndex = context.plan.nodes.findIndex((node) => node.id === action.next)
    if (targetIndex === -1) {
      try {
        getLogger().warn('flex_runtime_policy_goto_missing_node', {
          runId: context.runId,
          policyId: policy.id,
          next: action.next
        })
      } catch {}
      return { kind: 'noop' }
    }

    const affectedIds = context.scheduler
      ? context.scheduler.resetFromNode(action.next)
      : context.plan.nodes.slice(targetIndex).map((node) => node.id)

    for (const nodeId of affectedIds) {
      const targetNode = context.plan.nodes.find((node) => node.id === nodeId)
      if (!targetNode) continue
      context.completedNodeIds.delete(targetNode.id)
      context.nodeOutputs.delete(targetNode.id)
      context.nodeStatuses.set(targetNode.id, 'pending')
      context.nodeTimings.delete(targetNode.id)
      await this.persistence.markNode(context.runId, targetNode.id, {
        status: 'pending',
        output: null,
        completedAt: null
      })
    }

    try {
      getLogger().info('flex_runtime_policy_goto', {
        runId: context.runId,
        policyId: policy.id,
        next: action.next,
        attempts,
        maxAttempts
      })
    } catch {}

    try {
      await context.opts.onEvent(
        this.buildEvent(
          'policy_update',
          {
            policyId: policy.id,
            action: 'goto',
            next: action.next,
            attempts,
            maxAttempts
          },
          {
            runId: context.runId,
            nodeId: context.node.id,
            message: `runtime_policy_goto:${action.next}`,
            planVersion: context.plan.version
          }
        )
      )
    } catch {}

    return { kind: 'goto', targetNodeId: action.next }
  }

  private async triggerPolicyPause(args: {
    policyId: string
    reason?: string
    context: {
      runId: string
      envelope: TaskEnvelope
      plan: FlexPlan
      opts: FlexExecutionOptions
      node: FlexPlanNode
      runContext: RunContext
      nodeOutputs: Map<string, Record<string, unknown>>
      nodeStatuses: Map<string, FlexPlanNodeStatus>
      nodeTimings: Map<string, NodeTiming>
      completedNodeIds: Set<string>
      policyActions: PendingPolicyActionState[]
      policyAttempts: Map<string, number>
      postConditionAttempts: Map<string, number>
    }
  }): Promise<never> {
    const { policyId, reason, context } = args
    const facetsSnapshot = context.runContext.snapshot()
    const snapshotNodes = this.buildPlanSnapshotNodes(
      context.plan,
      context.nodeStatuses,
      context.nodeOutputs,
      context.nodeTimings
    )
    await this.persistence.savePlanSnapshot(context.runId, context.plan.version, snapshotNodes, {
      facets: facetsSnapshot,
      schemaHash: context.opts.schemaHash ?? null,
      edges: context.plan.edges,
      planMetadata: context.plan.metadata,
      pendingState: {
        completedNodeIds: Array.from(context.completedNodeIds),
        nodeOutputs: Object.fromEntries(context.nodeOutputs.entries()),
        policyActions: this.clonePolicyActions(context.policyActions),
        policyAttempts: context.policyAttempts.size
          ? Object.fromEntries(context.policyAttempts.entries())
          : undefined,
        postConditionAttempts: context.postConditionAttempts.size
          ? Object.fromEntries(context.postConditionAttempts.entries())
          : undefined,
        mode: 'pause'
      }
    })
    await this.persistence.updateStatus(context.runId, 'awaiting_hitl')

    try {
      getLogger().info('flex_runtime_policy_paused', {
        runId: context.runId,
        policyId,
        reason
      })
    } catch {}

    try {
      await context.opts.onEvent(
        this.buildEvent(
          'policy_update',
          {
            policyId,
            action: 'pause',
            reason: reason ?? null
          },
          {
            runId: context.runId,
            nodeId: context.node.id,
            message: reason ?? `runtime_policy_pause:${policyId}`
          }
        )
      )
    } catch {}

    throw new RunPausedError(reason ?? `Runtime policy ${policyId} requested pause`)
  }

  private async processPendingPolicyActions(args: {
    runId: string
    envelope: TaskEnvelope
    plan: FlexPlan
    opts: FlexExecutionOptions
    runContext: RunContext
    nodeOutputs: Map<string, Record<string, unknown>>
    nodeStatuses: Map<string, FlexPlanNodeStatus>
    nodeTimings: Map<string, NodeTiming>
    completedNodeIds: Set<string>
    policyActions: PendingPolicyActionState[]
    policyAttempts: Map<string, number>
    scheduler?: PlanScheduler
    postConditionAttempts: Map<string, number>
  }): Promise<{ remainingActions: PendingPolicyActionState[]; resumeNodeId: string | null }> {
    const hitlState = args.opts.hitl?.state
    if (!hitlState) {
      return { remainingActions: args.policyActions, resumeNodeId: null }
    }

    const remaining: PendingPolicyActionState[] = []
    let resumeNodeId: string | null = null

    for (const entry of args.policyActions) {
      if (!entry.requestId) {
        remaining.push(entry)
        continue
      }

      const decision = this.resolveHitlDecision(hitlState, entry.requestId)
      if (!decision) {
        remaining.push(entry)
        continue
      }

      const followUpAction =
        decision === 'approve'
          ? entry.approveAction ?? null
          : entry.rejectAction ?? { type: 'fail', message: `Runtime policy ${entry.policyId} rejected by HITL` }

      if (!followUpAction) {
        continue
      }

      const targetNode =
        args.plan.nodes.find((node) => node.id === entry.nodeId) ?? args.plan.nodes[args.plan.nodes.length - 1]

      const syntheticPolicy: RuntimePolicy = {
        id: entry.policyId,
        enabled: true,
        trigger: { kind: 'manual' },
        action: followUpAction
      }

      const actionOutcome = await this.handleRuntimePolicyAction(
        syntheticPolicy,
        {
          runId: args.runId,
          envelope: args.envelope,
          plan: args.plan,
          opts: args.opts,
          node: targetNode,
          runContext: args.runContext,
          nodeOutputs: args.nodeOutputs,
          nodeStatuses: args.nodeStatuses,
          nodeTimings: args.nodeTimings,
          completedNodeIds: args.completedNodeIds,
          policyActions: args.policyActions,
          policyAttempts: args.policyAttempts,
          scheduler: args.scheduler,
          postConditionAttempts: args.postConditionAttempts
        },
        {
          actionOverride: followUpAction,
          source: decision === 'approve' ? POLICY_ACTION_SOURCE.approval : POLICY_ACTION_SOURCE.rejection,
          requestId: entry.requestId
        }
      )

      if (actionOutcome?.kind === 'goto' && !args.scheduler) {
        resumeNodeId = resumeNodeId ?? actionOutcome.targetNodeId
      }
    }

    return {
      remainingActions: remaining,
      resumeNodeId
    }
  }

  private resolveHitlDecision(state: HitlRunState, requestId: string): 'approve' | 'reject' | null {
    const responses = state.responses.filter((response) => response.requestId === requestId)
    if (!responses.length) return null
    const latest = responses[responses.length - 1]
    if (typeof latest.approved === 'boolean') {
      return latest.approved ? 'approve' : 'reject'
    }
    if (latest.responseType === 'approval') return 'approve'
    if (latest.responseType === 'rejection') return 'reject'
    return null
  }

  private requiresHitlApproval(envelope: TaskEnvelope): boolean {
    const policyDirectives = envelope.policies?.planner?.directives as Record<string, unknown> | undefined
    if (policyDirectives && typeof policyDirectives.requiresHitlApproval === 'boolean') {
      return policyDirectives.requiresHitlApproval
    }
    const constraints = (envelope.constraints ?? {}) as Record<string, unknown>
    if (typeof constraints.requiresHitlApproval === 'boolean') {
      return constraints.requiresHitlApproval
    }
    return false
  }

  private buildHumanAssignmentPayload(
    node: FlexPlanNode,
    runId: string,
    options: { runContextSnapshot?: FacetSnapshot | null } = {}
  ): Record<string, unknown> {
    const assignment = (node.bundle.assignment ?? {}) as Record<string, unknown>
    const executorDefaults = node.executor?.assignment?.defaults ?? null
    const defaults = (assignment.defaults as AssignmentDefaults | undefined) ?? executorDefaults ?? null
    const metadata = assignment.metadata ?? node.executor?.assignment?.metadata ?? null
    const instructions =
      (assignment.instructions as string | undefined) ??
      node.executor?.assignment?.instructions ??
      (node.rationale && node.rationale.length ? node.rationale.join('\n') : undefined)

    const payload: Record<string, unknown> = {
      assignmentId: assignment.assignmentId ?? `${runId}:${node.id}`,
      runId,
      nodeId: node.id,
      capabilityId: node.capabilityId ?? null,
      label: node.label ?? null,
      status: assignment.status ?? 'awaiting_submission',
      role: assignment.role ?? (defaults as AssignmentDefaults | null)?.role ?? null,
      assignedTo: assignment.assignedTo ?? (defaults as AssignmentDefaults | null)?.assignedTo ?? null,
      dueAt: assignment.dueAt ?? null,
      priority: assignment.priority ?? (defaults as AssignmentDefaults | null)?.priority ?? null,
      notifyChannels: assignment.notifyChannels ?? (defaults as AssignmentDefaults | null)?.notifyChannels ?? null,
      timeoutSeconds: assignment.timeoutSeconds ?? (defaults as AssignmentDefaults | null)?.timeoutSeconds ?? null,
      maxNotifications:
        assignment.maxNotifications ?? (defaults as AssignmentDefaults | null)?.maxNotifications ?? null,
      instructions,
      defaults: defaults ? JSON.parse(JSON.stringify(defaults)) : null,
      createdAt: assignment.createdAt ?? null,
      updatedAt: assignment.updatedAt ?? null
    }

    const facetsSnapshot = {
      input: Array.isArray(node.facets?.input) ? [...node.facets.input] : [],
      output: Array.isArray(node.facets?.output) ? [...node.facets.output] : []
    }

    const provenanceSnapshot: Record<string, unknown> = {}
    if (node.provenance?.input && node.provenance.input.length) {
      provenanceSnapshot.input = node.provenance.input.map((entry) => ({ ...entry }))
    }
    if (node.provenance?.output && node.provenance.output.length) {
      provenanceSnapshot.output = node.provenance.output.map((entry) => ({ ...entry }))
    }

    const contractsSnapshot: Record<string, unknown> = {
      ...(node.contracts.input ? { input: JSON.parse(JSON.stringify(node.contracts.input)) } : {}),
      output: JSON.parse(JSON.stringify(node.contracts.output))
    }

    const contextExtras: Record<string, unknown> = {}

    const bundleInputs =
      node.bundle.inputs && typeof node.bundle.inputs === 'object'
        ? stripPlannerFields(JSON.parse(JSON.stringify(node.bundle.inputs)) as Record<string, unknown>)
        : null
    const bundleOutputs =
      node.bundle.priorOutputs && typeof node.bundle.priorOutputs === 'object'
        ? (JSON.parse(JSON.stringify(node.bundle.priorOutputs)) as Record<string, unknown>)
        : null

    const runContextSnapshotClone =
      options.runContextSnapshot && Object.keys(options.runContextSnapshot).length
        ? JSON.parse(JSON.stringify(options.runContextSnapshot))
        : null

    const metadataInputs =
      metadata && typeof metadata === 'object' && typeof (metadata as Record<string, unknown>).currentInputs === 'object'
        ? stripPlannerFields(
            JSON.parse(JSON.stringify((metadata as Record<string, unknown>).currentInputs)) as Record<string, unknown>
          )
        : null

    const runContextInputValues = extractFacetSnapshotValues(options.runContextSnapshot ?? null, facetsSnapshot.input)
    const mergedInputs = mergeFacetValuesIntoStructure(
      metadataInputs ?? bundleInputs ?? null,
      runContextInputValues,
      Array.isArray(node.provenance?.input) ? node.provenance?.input : undefined
    )
    const sanitizedInputs = stripPlannerFields(mergedInputs)
    if (sanitizedInputs && Object.keys(sanitizedInputs).length) {
      contextExtras.currentInputs = ensureFacetPlaceholders(sanitizedInputs, facetsSnapshot.input)
    } else {
      contextExtras.currentInputs = ensureFacetPlaceholders(null, facetsSnapshot.input)
    }

    const metadataOutputs =
      metadata && typeof metadata === 'object' && typeof (metadata as Record<string, unknown>).currentOutput === 'object'
        ? stripPlannerFields(
            JSON.parse(JSON.stringify((metadata as Record<string, unknown>).currentOutput)) as Record<string, unknown>
          )
        : null

    const sanitizedBundleOutputs =
      bundleOutputs && typeof bundleOutputs === 'object' ? stripPlannerFields(bundleOutputs) : null

    const mergedOutputs = metadataOutputs ?? sanitizedBundleOutputs ?? null
    const sanitizedOutputs = stripPlannerFields(mergedOutputs)
    if (sanitizedOutputs && Object.keys(sanitizedOutputs).length) {
      contextExtras.currentOutput = ensureFacetPlaceholders(sanitizedOutputs, facetsSnapshot.output)
    } else {
      contextExtras.currentOutput = ensureFacetPlaceholders(null, facetsSnapshot.output)
    }

    if (runContextSnapshotClone) {
      contextExtras.runContextSnapshot = runContextSnapshotClone
    }

    const metadataClone =
      metadata && typeof metadata === 'object'
        ? JSON.parse(JSON.stringify(metadata as Record<string, unknown>))
        : {}
    Object.assign(metadataClone, contextExtras)
    metadataClone.expectedOutputFacets = Array.isArray(facetsSnapshot.output)
      ? [...facetsSnapshot.output]
      : []
    metadataClone.expectedInputFacets = Array.isArray(facetsSnapshot.input)
      ? [...facetsSnapshot.input]
      : []

    return this.compactPayload({
      ...payload,
      metadata: Object.keys(metadataClone).length ? metadataClone : null,
      facets: facetsSnapshot,
      contracts: contractsSnapshot,
      facetProvenance: Object.keys(provenanceSnapshot).length
        ? this.normalizeFacetProvenance(provenanceSnapshot)
        : undefined,
      context: Object.keys(contextExtras).length ? contextExtras : null
    })
  }

  private buildPersistenceContext(node: FlexPlanNode, runContext: RunContext): ContextBundle & Record<string, unknown> {
    const bundle = node.bundle ? JSON.parse(JSON.stringify(node.bundle)) : ({} as ContextBundle)
    bundle.nodeId = node.id
    if (!bundle.runId) {
      bundle.runId = node.bundle?.runId ?? ''
    }

    const context: ContextBundle & Record<string, unknown> = bundle as ContextBundle & Record<string, unknown>

    const facetsSnapshot = {
      input: Array.isArray(node.facets?.input) ? [...node.facets.input] : [],
      output: Array.isArray(node.facets?.output) ? [...node.facets.output] : []
    }
    context.facets = facetsSnapshot

    const provenanceSnapshot: Record<string, unknown> = {}
    if (node.provenance?.input && node.provenance.input.length) {
      provenanceSnapshot.input = node.provenance.input.map((entry) => ({ ...entry }))
    }
    if (node.provenance?.output && node.provenance.output.length) {
      provenanceSnapshot.output = node.provenance.output.map((entry) => ({ ...entry }))
    }
    if (Object.keys(provenanceSnapshot).length) {
      context.facetProvenance = this.normalizeFacetProvenance(provenanceSnapshot)
    }

    const contractsSnapshot: Record<string, unknown> = {
      ...(node.contracts.input ? { input: JSON.parse(JSON.stringify(node.contracts.input)) } : {}),
      output: JSON.parse(JSON.stringify(node.contracts.output))
    }
    context.contracts = contractsSnapshot

    const runSnapshot = runContext.snapshot()
    if (runSnapshot && Object.keys(runSnapshot).length) {
      context.runContextSnapshot = JSON.parse(JSON.stringify(runSnapshot))
      const runContextInputs = extractFacetSnapshotValues(runSnapshot.facets, facetsSnapshot.input)
      if (Object.keys(runContextInputs).length) {
        const mergedInputStructure = mergeFacetValuesIntoStructure(
          context.currentInputs ?? context.inputs ?? null,
          runContextInputs,
          Array.isArray(node.provenance?.input) ? node.provenance?.input : undefined
        )
        const sanitizedInputs = stripPlannerFields(mergedInputStructure)
        if (sanitizedInputs && Object.keys(sanitizedInputs).length) {
          context.currentInputs = sanitizedInputs
        }
      }

      const runContextOutputs = extractFacetSnapshotValues(runSnapshot.facets, facetsSnapshot.output)
      if (Object.keys(runContextOutputs).length) {
        const mergedOutputStructure = mergeFacetValuesIntoStructure(
          context.currentOutput ?? context.priorOutputs ?? context.artifacts ?? null,
          runContextOutputs,
          Array.isArray(node.provenance?.output) ? node.provenance?.output : undefined
        )
        const sanitizedOutputs = stripPlannerFields(mergedOutputStructure)
        if (sanitizedOutputs && Object.keys(sanitizedOutputs).length) {
          context.currentOutput = sanitizedOutputs
        }
      }
    }

    return context
  }

  private async pauseForHuman(args: {
    runId: string
    envelope: TaskEnvelope
    plan: FlexPlan
    node: FlexPlanNode
    opts: FlexExecutionOptions
    runContext: RunContext
    nodeStatuses: Map<string, FlexPlanNodeStatus>
    nodeOutputs: Map<string, Record<string, unknown>>
    nodeTimings: Map<string, NodeTiming>
    completedNodeIds: Set<string>
    policyActions: PendingPolicyActionState[]
    policyAttempts: Map<string, number>
    schemaHash?: string | null
  }): Promise<never> {
    const {
      runId,
      plan,
      node,
      opts,
      runContext,
      nodeStatuses,
      nodeOutputs,
      nodeTimings,
      completedNodeIds,
      policyActions,
      policyAttempts,
      schemaHash
    } = args

    const facetsSnapshot = runContext.snapshot()
    const bundleRecord = node.bundle as (ContextBundle & Record<string, unknown>) | undefined
    if (bundleRecord) {
      const facetState = facetsSnapshot.facets ?? {}
      const inputFacets = Array.isArray(node.facets?.input) ? node.facets.input : []
      const outputFacets = Array.isArray(node.facets?.output) ? node.facets.output : []

      const bundleInputsBase = stripPlannerFields(
        (bundleRecord.currentInputs ?? bundleRecord.inputs ?? null) as Record<string, unknown> | null
      )
      const runInputs = extractFacetSnapshotValues(facetState, inputFacets)
      const mergedInputs = mergeFacetValuesIntoStructure(
        bundleInputsBase,
        runInputs,
        Array.isArray(node.provenance?.input) ? node.provenance?.input : undefined
      )
      const sanitizedInputs = stripPlannerFields(mergedInputs)
      if (sanitizedInputs && Object.keys(sanitizedInputs).length) {
        bundleRecord.currentInputs = sanitizedInputs
      }

      const bundleOutputsBase = stripPlannerFields(
        (bundleRecord.currentOutput ?? bundleRecord.priorOutputs ?? null) as Record<string, unknown> | null
      )
      const runOutputs = extractFacetSnapshotValues(facetState, outputFacets)
      const mergedOutputs = mergeFacetValuesIntoStructure(
        bundleOutputsBase,
        runOutputs,
        Array.isArray(node.provenance?.output) ? node.provenance?.output : undefined
      )
      const sanitizedOutputs = stripPlannerFields(mergedOutputs)
      if (sanitizedOutputs && Object.keys(sanitizedOutputs).length) {
        bundleRecord.currentOutput = sanitizedOutputs
      }

      bundleRecord.runContextSnapshot = JSON.parse(JSON.stringify(facetsSnapshot))
    }
    const snapshotNodes = this.buildPlanSnapshotNodes(plan, nodeStatuses, nodeOutputs, nodeTimings)

    await this.persistence.savePlanSnapshot(runId, plan.version, snapshotNodes, {
      facets: facetsSnapshot,
      schemaHash: schemaHash ?? null,
      edges: plan.edges,
      planMetadata: plan.metadata,
      pendingState: {
        completedNodeIds: Array.from(completedNodeIds),
        nodeOutputs: Object.fromEntries(nodeOutputs.entries()),
        policyActions: policyActions.length ? this.clonePolicyActions(policyActions) : undefined,
        policyAttempts: policyAttempts.size ? Object.fromEntries(policyAttempts.entries()) : undefined,
        mode: 'pause'
      }
    })

    await this.persistence.updateStatus(runId, 'awaiting_human')

    try {
      getLogger().info('flex_human_node_pause', {
        runId,
        nodeId: node.id,
        capabilityId: node.capabilityId
      })
    } catch {}

    const assignmentPayload = this.buildHumanAssignmentPayload(node, runId, {
      runContextSnapshot: facetsSnapshot.facets
    })
    try {
      await opts.onEvent(
        this.buildEvent(
          'log',
          this.compactPayload({
            severity: 'info',
            event: 'awaiting_human',
            assignment: assignmentPayload
          }),
          { runId, nodeId: node.id, message: 'awaiting_human_assignment' }
        )
      )
    } catch {}

    throw new AwaitingHumanInputError()
  }

  private async pauseForHitlRequest(args: {
    runId: string
    envelope: TaskEnvelope
    plan: FlexPlan
    opts: FlexExecutionOptions
    runContext: RunContext
    node: FlexPlanNode
    nodeOutputs: Map<string, Record<string, unknown>>
    nodeStatuses: Map<string, FlexPlanNodeStatus>
    nodeTimings: Map<string, NodeTiming>
    completedNodeIds: Set<string>
    policyActions: PendingPolicyActionState[]
    policyAttempts: Map<string, number>
    postConditionAttempts: Map<string, number>
    request: HitlRequestRecord
  }): Promise<never> {
    const {
      runId,
      plan,
      opts,
      runContext,
      node,
      nodeOutputs,
      nodeStatuses,
      nodeTimings,
      completedNodeIds,
      policyActions,
      policyAttempts,
      postConditionAttempts,
      request
    } = args

    const createdAt = request.createdAt instanceof Date
      ? request.createdAt.toISOString()
      : new Date(request.createdAt).toISOString()

    runContext.recordClarificationQuestion({
      nodeId: node.id,
      capabilityId: node.capabilityId ?? undefined,
      questionId: request.id,
      question: request.payload.question ?? '',
      createdAt
    })

    const snapshot = runContext.snapshot()

    await this.persistence.markNode(runId, node.id, {
      status: 'awaiting_hitl',
      context: node.bundle
    })
    nodeStatuses.set(node.id, 'awaiting_hitl')
    nodeTimings.set(node.id, { ...(nodeTimings.get(node.id) ?? {}) })

    const snapshotNodes = this.buildPlanSnapshotNodes(plan, nodeStatuses, nodeOutputs, nodeTimings)
    const pendingState = {
      completedNodeIds: Array.from(completedNodeIds),
      nodeOutputs: Object.fromEntries(nodeOutputs.entries()),
      policyActions: this.clonePolicyActions(policyActions),
      policyAttempts: policyAttempts.size ? Object.fromEntries(policyAttempts.entries()) : undefined,
      postConditionAttempts: postConditionAttempts.size
        ? Object.fromEntries(postConditionAttempts.entries())
        : undefined,
      mode: 'hitl' as RuntimePolicySnapshotMode
    }

    await this.persistence.savePlanSnapshot(runId, plan.version, snapshotNodes, {
      facets: snapshot,
      schemaHash: opts.schemaHash ?? null,
      edges: plan.edges,
      planMetadata: plan.metadata,
      pendingState
    })

    await this.persistence.saveRunContext(runId, snapshot)
    await this.persistence.updateStatus(runId, 'awaiting_hitl')

    try {
      getLogger().info('flex_hitl_pause', {
        runId,
        nodeId: node.id,
        capabilityId: node.capabilityId,
        questionId: request.id,
        kind: request.payload.kind
      })
    } catch {}

    throw new HitlPauseError('Awaiting human input')
  }

  private async triggerHitlPause(args: {
    runId: string
    envelope: TaskEnvelope
    plan: FlexPlan
    opts: FlexExecutionOptions
    runContext: RunContext
    targetNode: FlexPlanNode
    finalOutput: Record<string, unknown>
    nodeOutputs: Map<string, Record<string, unknown>>
    nodeStatuses: Map<string, FlexPlanNodeStatus>
    nodeTimings: Map<string, NodeTiming>
    completedNodeIds: Set<string>
    schemaHash?: string | null
    rationale?: string
    policyId?: string
    pendingPolicyAction?: PendingPolicyActionState
    policyActions: PendingPolicyActionState[]
    policyAttempts: Map<string, number>
    postConditionAttempts: Map<string, number>
  }): Promise<never> {
    const {
      runId,
      envelope,
      plan,
      opts,
      runContext,
      targetNode,
      finalOutput,
      nodeOutputs,
      nodeStatuses,
      nodeTimings,
      completedNodeIds,
      schemaHash,
      rationale,
      policyId,
      pendingPolicyAction,
      policyActions,
      policyAttempts,
      postConditionAttempts
    } = args

    const hitl = opts.hitl
    if (!hitl) {
      throw new Error('HITL context unavailable for flex run')
    }

    let latestState = hitl.state
    let pendingRecord: HitlRequestRecord | null = null
    await this.persistence.recordPendingResult(runId, finalOutput)

    await withHitlContext(
      {
        runId,
        threadId: hitl.threadId ?? undefined,
        stepId: targetNode.id,
        capabilityId: targetNode.capabilityId ?? undefined,
        hitlService: hitl.service,
        limit: hitl.limit,
        onRequest: (record, state) => {
          pendingRecord = record
          latestState = state
        },
        onDenied: async (reason, state) => {
          latestState = state
          if (hitl.onDenied) await hitl.onDenied(reason, state)
        },
        snapshot: hitl.state
      },
      async () => {
        const hitlDetails = this.buildHitlRequestDetails(envelope, finalOutput, {
          question: rationale,
          policyId,
          nodeLabel: targetNode.label,
          plan,
          node: targetNode
        })
        const result = await hitl.service.raiseRequest(hitlDetails.payload, {
          pendingNodeId: targetNode.id,
          operatorPrompt: hitlDetails.operatorPrompt,
          contractSummary: hitlDetails.contractSummary
        })
        if (result.status === 'denied') {
          throw new Error(result.reason || 'HITL request denied')
        }
      }
    )

    if (latestState !== hitl.state) {
      hitl.state = latestState
      hitl.updateState?.(latestState)
    }

    const requestRecord = pendingRecord
    if (!requestRecord) {
      throw new Error('HITL request was not created')
    }
    const resolvedRecord: HitlRequestRecord = requestRecord

    if (pendingPolicyAction) {
      pendingPolicyAction.requestId = resolvedRecord.id
    }

    await this.persistence.markNode(runId, targetNode.id, {
      status: 'awaiting_hitl',
      context: targetNode.bundle
    })
    nodeStatuses.set(targetNode.id, 'awaiting_hitl')
    const snapshotNodes = this.buildPlanSnapshotNodes(plan, nodeStatuses, nodeOutputs, nodeTimings)
    const pendingStateSnapshot = {
      completedNodeIds: Array.from(completedNodeIds),
      nodeOutputs: Object.fromEntries(nodeOutputs.entries()),
      facets: runContext.snapshot(),
      policyActions: this.clonePolicyActions(policyActions),
      policyAttempts: policyAttempts.size ? Object.fromEntries(policyAttempts.entries()) : undefined,
      postConditionAttempts: postConditionAttempts.size
        ? Object.fromEntries(postConditionAttempts.entries())
        : undefined
    }
    await this.persistence.savePlanSnapshot(runId, plan.version, snapshotNodes, {
      facets: pendingStateSnapshot.facets,
      schemaHash: schemaHash ?? null,
      edges: plan.edges,
      planMetadata: plan.metadata,
      pendingState: {
        completedNodeIds: pendingStateSnapshot.completedNodeIds,
        nodeOutputs: pendingStateSnapshot.nodeOutputs,
        policyActions: pendingStateSnapshot.policyActions,
        policyAttempts: pendingStateSnapshot.policyAttempts,
        postConditionAttempts: pendingStateSnapshot.postConditionAttempts,
        mode: 'hitl'
      }
    })
    await this.persistence.updateStatus(runId, 'awaiting_hitl')
    if (hitl.onRequest) {
      await hitl.onRequest(resolvedRecord, latestState)
    }
    throw new HitlPauseError()
  }

  private async ensureOutputMatchesContract(
    contract: OutputContract,
    output: Record<string, unknown>,
    context: { scope: 'capability_output' | 'final_output'; runId: string; nodeId?: string },
    opts: FlexExecutionOptions
  ) {
    if (contract.mode !== 'json_schema') return
    try {
      getLogger().debug('flex_contract_debug', {
        runId: context.runId,
        nodeId: context.nodeId,
        scope: context.scope,
        schema: contract.schema,
        output
      })
    } catch {}
    await this.validateSchema(contract.schema as Record<string, unknown>, output, context, opts)
  }

  private getValidator(schema: Record<string, unknown>) {
    const key = JSON.stringify(schema)
    let validator = this.validatorCache.get(key)
    if (!validator) {
      validator = this.ajv.compile(JSON.parse(key))
      this.validatorCache.set(key, validator)
    }
    return validator
  }

  private async validateSchema(
    schema: Record<string, unknown>,
    data: unknown,
    context: { scope: 'capability_input' | 'capability_output' | 'final_output'; runId: string; nodeId?: string },
    opts: FlexExecutionOptions
  ) {
    const validator = this.getValidator(schema)
    const ok = validator(data)
    if (ok) return
    const errors = (validator.errors || []) as ErrorObject[]
    await this.emitValidationError(errors, context, opts)
    throw new FlexValidationError(`${context.scope} validation failed`, context.scope, errors)
  }

  private mapAjvErrors(errors: ErrorObject[]) {
    return errors.map((err) => {
      const legacyPath = (err as { dataPath?: string }).dataPath
      const candidate = (err as { instancePath?: string }).instancePath
      const instancePath =
        typeof candidate === 'string' && candidate.length ? candidate : legacyPath ?? ''
      return {
        message: err.message,
        instancePath,
        keyword: err.keyword,
        params: err.params ?? {},
        schemaPath: err.schemaPath
      }
    })
  }

  private async emitValidationError(
    errors: ErrorObject[],
    context: { scope: 'capability_input' | 'capability_output' | 'final_output'; runId: string; nodeId?: string },
    opts: FlexExecutionOptions
  ) {
    if (context.scope === 'capability_output' && errors.length) {
      try {
        getLogger().debug('flex_validation_debug', {
          runId: context.runId,
          nodeId: context.nodeId,
          errors,
          scope: context.scope
        })
      } catch {}
    }
    const normalized = this.mapAjvErrors(errors)
    try {
      getLogger().warn('flex_validation_failed', {
        runId: context.runId,
        nodeId: context.nodeId,
        scope: context.scope,
        errorCount: normalized.length
      })
    } catch {}
    await opts.onEvent(
      this.buildEvent(
        'validation_error',
        {
          scope: context.scope,
          errors: normalized
        },
        { runId: context.runId, nodeId: context.nodeId }
      )
    )
  }

  private serializeError(err: unknown): Record<string, unknown> {
    if (err instanceof FlexValidationError) {
      return {
        message: err.message,
        name: err.name,
        scope: err.scope,
        errors: this.mapAjvErrors(err.errors)
      }
    }
    if (err instanceof Error) {
      return {
        message: err.message,
        name: err.name,
        stack: err.stack
      }
    }
    return { message: String(err) }
  }

  private buildEvent(
    type: FlexEvent['type'],
    payload: Record<string, unknown>,
    meta?: {
      runId?: string
      nodeId?: string
      message?: string
      planVersion?: number
      facetProvenance?: EventFacetProvenanceMap
    }
  ): FlexEvent {
    return {
      type,
      timestamp: new Date().toISOString(),
      payload,
      runId: meta?.runId,
      nodeId: meta?.nodeId,
      message: meta?.message,
      planVersion: typeof meta?.planVersion === 'number' ? meta.planVersion : undefined,
      facetProvenance: meta?.facetProvenance
    }
  }

  private normalizeFacetProvenance(
    provenance: { input?: FacetProvenance[]; output?: FacetProvenance[] } | Record<string, unknown> | null | undefined
  ): EventFacetProvenanceMap | undefined {
    if (!provenance || typeof provenance !== 'object') return undefined

    const resolveEntries = (
      entries: unknown,
      fallback: 'input' | 'output'
    ): EventFacetProvenanceEntry[] | undefined => {
      if (!Array.isArray(entries)) return undefined
      const normalized = entries
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return undefined
          const { title, direction, facet, pointer } = entry as Partial<FacetProvenance>
          const resolvedDirection: 'input' | 'output' =
            direction === 'input' || direction === 'output'
              ? direction
              : fallback
          if (!title || !facet || !pointer) return undefined
          return {
            title,
            direction: resolvedDirection,
            facet,
            pointer
          }
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      return normalized.length ? normalized : undefined
    }

    const raw = provenance as { input?: FacetProvenance[]; output?: FacetProvenance[] }
    const input = resolveEntries(raw.input, 'input')
    const output = resolveEntries(raw.output, 'output')
    if (!input && !output) return undefined
    return {
      ...(input ? { input } : {}),
      ...(output ? { output } : {})
    }
  }

  private buildRoutingSelectionsFromOutputs(
    nodeOutputs: Map<string, Record<string, unknown>>
  ): Map<string, string[]> {
    const selections = new Map<string, string[]>()
    for (const [nodeId, output] of nodeOutputs.entries()) {
      const result = this.extractRoutingResult(output)
      if (result?.selectedTarget) {
        selections.set(nodeId, [result.selectedTarget])
      }
    }
    return selections
  }

  private extractRoutingResult(
    output: Record<string, unknown> | null | undefined
  ): RoutingEvaluationResult | null {
    if (!output || typeof output !== 'object') return null
    const candidate = (output as { routingResult?: unknown }).routingResult
    if (!candidate || typeof candidate !== 'object') return null
    return candidate as RoutingEvaluationResult
  }

  private normalizePostConditionRetryValue(
    policyValue: number | undefined,
    capability: CapabilityRecord
  ): number {
    const candidate =
      policyValue ??
      this.getCapabilityPostConditionRetryOverride(capability) ??
      DEFAULT_POST_CONDITION_MAX_RETRIES
    if (!Number.isFinite(candidate) || candidate! < 0) {
      return DEFAULT_POST_CONDITION_MAX_RETRIES
    }
    return Math.floor(candidate!)
  }

  private getCapabilityPostConditionRetryOverride(capability: CapabilityRecord): number | null {
    const metadata = capability.metadata
    if (!metadata || typeof metadata !== 'object') {
      return null
    }
    const policy = (metadata as { postConditionPolicy?: { maxRetries?: number } }).postConditionPolicy
    if (!policy || typeof policy !== 'object') {
      return null
    }
    const value = Number((policy as Record<string, unknown>).maxRetries)
    if (!Number.isFinite(value) || value < 0) {
      return null
    }
    return Math.floor(value)
  }

  private resolvePostConditionPolicy(
    envelope: TaskEnvelope,
    node: FlexPlanNode,
    capability: CapabilityRecord
  ): { policy: RuntimePolicy | null; maxRetries: number } {
    const runtimePolicies = envelope.policies?.runtime ?? []
    for (const policy of runtimePolicies) {
      if (policy.trigger.kind !== 'onPostConditionFailed') continue
      if (!this.matchesNodeSelector(policy.trigger.selector, node)) continue
      if (!this.isSupportedPostConditionAction(policy.action.type)) continue
      const maxRetries = this.normalizePostConditionRetryValue(
        typeof policy.trigger.maxRetries === 'number' ? policy.trigger.maxRetries : undefined,
        capability
      )
      return { policy, maxRetries }
    }
    return {
      policy: null,
      maxRetries: this.normalizePostConditionRetryValue(undefined, capability)
    }
  }

  private matchesNodeSelector(selector: NodeSelector | undefined, node: FlexPlanNode): boolean {
    if (!selector) return true

    if (selector.capabilityId && selector.capabilityId !== node.capabilityId) {
      return false
    }

    if (selector.nodeId && selector.nodeId !== node.id) {
      return false
    }

    if (selector.kind && selector.kind !== (node.kind ?? 'execution')) {
      return false
    }

    return true
  }

  private isSupportedPostConditionAction(actionType: Action['type']): boolean {
    return actionType === 'replan' || actionType === 'hitl' || actionType === 'fail' || actionType === 'emit'
  }

  private evaluatePostConditions(
    capability: CapabilityRecord,
    node: FlexPlanNode,
    runContext: RunContext,
    output: Record<string, unknown>
  ): GoalConditionResult[] {
    if (!capability.postConditions || capability.postConditions.length === 0) {
      return []
    }
    const evaluationContext = RunContext.fromSnapshot(runContext.snapshot())
    evaluationContext.updateFromNode(node, output)
    return evaluateGoalConditions(capability.postConditions, { runContextSnapshot: evaluationContext.snapshot() })
  }

  private hasFailedPostConditions(results: GoalConditionResult[]): boolean {
    return results.some(
      (entry) => !entry.satisfied || (typeof entry.error === 'string' && entry.error.length > 0)
    )
  }

  private async handlePostConditionFailure(args: {
    runId: string
    envelope: TaskEnvelope
    plan: FlexPlan
    node: FlexPlanNode
    capability: CapabilityRecord
    opts: FlexExecutionOptions
    runContext: RunContext
    nodeOutputs: Map<string, Record<string, unknown>>
    nodeStatuses: Map<string, FlexPlanNodeStatus>
    nodeTimings: Map<string, NodeTiming>
    completedNodeIds: Set<string>
    policyActions: PendingPolicyActionState[]
    policyAttempts: Map<string, number>
    scheduler: PlanScheduler
    postConditionAttempts: Map<string, number>
    results: GoalConditionResult[]
    policy: RuntimePolicy | null
    maxRetries: number
  }): Promise<void> {
    const attemptKey = args.node.id
    const attempts = (args.postConditionAttempts.get(attemptKey) ?? 0) + 1
    args.postConditionAttempts.set(attemptKey, attempts)

    await args.opts.onEvent(
      this.buildEvent(
        'policy_triggered',
        {
          policyId: args.policy?.id ?? 'post_condition_default',
          action: attempts <= args.maxRetries ? 'retry' : (args.policy?.action.type ?? 'fail'),
          nodeId: args.node.id,
          capabilityId: args.node.capabilityId,
          attempt: attempts,
          maxRetries: args.maxRetries,
          postConditionResults: args.results
        },
        {
          runId: args.runId,
          nodeId: args.node.id,
          planVersion: args.plan.version,
          message: 'post_condition_failed'
        }
      )
    )

    if (attempts <= args.maxRetries) {
      try {
        getLogger().warn('flex_post_condition_retry', {
          runId: args.runId,
          nodeId: args.node.id,
          capabilityId: args.node.capabilityId,
          attempt: attempts,
          maxRetries: args.maxRetries
        })
      } catch {}
    } else {
      const action = args.policy?.action ?? { type: 'fail', message: 'Capability post conditions failed.' }
      switch (action.type) {
        case 'replan': {
          throw new ReplanRequestedError(
            {
              reason: 'post_condition_failed',
              details: {
                nodeId: args.node.id,
                capabilityId: args.node.capabilityId,
                postConditionResults: args.results
              }
            },
            {
              completedNodeIds: Array.from(args.completedNodeIds),
              nodeOutputs: Object.fromEntries(args.nodeOutputs.entries()),
              facets: args.runContext.snapshot(),
              policyActions: args.policyActions.length ? this.clonePolicyActions(args.policyActions) : undefined,
              policyAttempts: args.policyAttempts.size
                ? Object.fromEntries(args.policyAttempts.entries())
                : undefined,
              postConditionAttempts: args.postConditionAttempts.size
                ? Object.fromEntries(args.postConditionAttempts.entries())
                : undefined
            }
          )
        }
        case 'hitl': {
          if (!args.policy) {
            throw new RuntimePolicyFailureError('post_condition_default', 'HITL action requires policy configuration')
          }
          await this.handleRuntimePolicyAction(
            args.policy,
            {
              runId: args.runId,
              envelope: args.envelope,
              plan: args.plan,
              opts: args.opts,
              node: args.node,
              runContext: args.runContext,
              nodeOutputs: args.nodeOutputs,
              nodeStatuses: args.nodeStatuses,
              nodeTimings: args.nodeTimings,
              completedNodeIds: args.completedNodeIds,
              policyActions: args.policyActions,
              policyAttempts: args.policyAttempts,
              postConditionAttempts: args.postConditionAttempts,
              scheduler: args.scheduler
            },
            { source: POLICY_ACTION_SOURCE.runtime }
          )
          return
        }
        case 'emit': {
          await this.emitRuntimeEvent({
            runId: args.runId,
            node: args.node,
            opts: args.opts,
            eventName: action.event ?? 'post_condition_failed',
            payload: {
              ...(action.payload ?? {}),
              nodeId: args.node.id,
              capabilityId: args.node.capabilityId,
              postConditionResults: args.results
            },
            policyId: args.policy?.id ?? 'post_condition_default',
            rationale: action.rationale,
            planVersion: args.plan.version
          })
          throw new RuntimePolicyFailureError(
            args.policy?.id ?? 'post_condition_default',
            action.event ?? 'Capability post conditions failed'
          )
        }
        case 'fail':
        default: {
          throw new RuntimePolicyFailureError(
            args.policy?.id ?? 'post_condition_default',
            action.message ?? 'Capability post conditions failed'
          )
        }
      }
    }
  }

  private buildPlanSnapshotNodes(
    plan: FlexPlan,
    nodeStatuses: Map<string, FlexPlanNodeStatus>,
    nodeOutputs: Map<string, Record<string, unknown>>,
    timings: Map<string, NodeTiming>
  ): FlexPlanNodeSnapshot[] {
    return plan.nodes.map((node) => {
      const timing = timings.get(node.id) ?? {}
      const metadata =
        node.metadata && Object.keys(node.metadata).length ? { ...node.metadata } : null
      const rationale = node.rationale && node.rationale.length ? [...node.rationale] : null
      return {
        nodeId: node.id,
        capabilityId: node.capabilityId,
        label: node.label,
        status: nodeStatuses.get(node.id) ?? 'pending',
        context: node.bundle,
        output: nodeOutputs.get(node.id) ?? null,
        facets: node.facets,
        contracts: node.contracts,
        provenance: node.provenance,
        metadata,
        rationale,
        routing: node.routing ?? null,
        postConditionGuards: node.postConditionGuards
          ? JSON.parse(JSON.stringify(node.postConditionGuards))
          : [],
        postConditionResults: node.postConditionResults
          ? JSON.parse(JSON.stringify(node.postConditionResults))
          : [],
        startedAt: timing.startedAt ?? null,
        completedAt: timing.completedAt ?? null
      }
    })
  }

  private extractOutputProvenance(snapshot: RunContextSnapshot, output: Record<string, unknown>) {
    const provenance: Record<string, unknown> = {}
    if (!output) return provenance
    const facets = snapshot.facets
    for (const key of Object.keys(output)) {
      const entry = facets?.[key]
      if (entry && Array.isArray(entry.provenance)) {
        provenance[key] = entry.provenance.map((record) => ({ ...record }))
      }
    }
    return provenance
  }

  async resumePending(
    runId: string,
    envelope: TaskEnvelope,
    plan: FlexPlan,
    finalOutputParam: Record<string, unknown> | null | undefined,
    opts: FlexExecutionOptions
  ) {
    let finalOutput = finalOutputParam ?? {}
    const activeRunContext = opts.runContext ?? new RunContext()
    const nodeOutputs = new Map<string, Record<string, unknown>>()
    const nodeStatuses = new Map<string, FlexPlanNodeStatus>()
    const nodeTimings = new Map<string, NodeTiming>()
    const policyActions: PendingPolicyActionState[] = Array.isArray(opts.initialState?.policyActions)
      ? opts.initialState!.policyActions.map((action) => ({ ...action }))
      : []
    const policyAttempts = new Map<string, number>(Object.entries(opts.initialState?.policyAttempts ?? {}))
    const postConditionAttempts = new Map<string, number>(
      Object.entries(opts.initialState?.postConditionAttempts ?? {})
    )
    if (opts.initialState?.nodeOutputs) {
      for (const [nodeId, output] of Object.entries(opts.initialState.nodeOutputs)) {
        nodeOutputs.set(nodeId, { ...(output ?? {}) })
      }
    }

    const completedNodeIds = new Set<string>(
      opts.initialState?.completedNodeIds ?? plan.nodes.map((node) => node.id)
    )

    const hasPendingPolicyActions =
      Array.isArray(opts.initialState?.policyActions) && opts.initialState.policyActions.length > 0
    const hitlStateRef = opts.hitl?.state
    const toEpoch = (value: unknown) => {
      if (value instanceof Date) return value.getTime()
      if (typeof value === 'number') return value
      if (typeof value === 'string') {
        const parsed = Date.parse(value)
        return Number.isNaN(parsed) ? 0 : parsed
      }
      return 0
    }

    if (hitlStateRef && !hasPendingPolicyActions) {
      const resolvedRequests = hitlStateRef.requests.filter((req) => req.status === 'resolved')
      if (resolvedRequests.length) {
        resolvedRequests.sort(
          (a, b) => toEpoch(b.updatedAt ?? b.createdAt) - toEpoch(a.updatedAt ?? a.createdAt)
        )
        const latestResolved = resolvedRequests[0]
        const detail = resolveHitlDecisionDetail(hitlStateRef, latestResolved.id)
        if (detail && detail.kind === 'reject') {
          const action = parseHitlDecisionAction(detail.response)
          const freeform = typeof detail.response.freeformText === 'string' ? detail.response.freeformText.trim() : ''
          const defaultReason = freeform || `Run rejected by operator (${detail.request.originAgent})`
          if (!action || action.type === 'fail') {
            const reason = (action?.message || defaultReason).trim() || defaultReason
            try {
              getLogger().warn('flex_hitl_rejection_default_fail', {
                runId,
                requestId: detail.request.id,
                originAgent: detail.request.originAgent
              })
            } catch {}
            throw new RuntimePolicyFailureError('hitl_reject', reason)
          }
        }
      }
    }

    for (const node of plan.nodes) {
      nodeStatuses.set(node.id, completedNodeIds.has(node.id) ? 'completed' : 'pending')
    }

    if (policyActions.length) {
      const pendingDispatch = await this.processPendingPolicyActions({
        runId,
        envelope,
        plan,
        opts,
        runContext: activeRunContext,
        nodeOutputs,
        nodeStatuses,
        nodeTimings,
        completedNodeIds,
        policyActions,
        policyAttempts,
        postConditionAttempts
      })
      policyActions.splice(0, policyActions.length, ...pendingDispatch.remainingActions)
      if (pendingDispatch.resumeNodeId) {
        return this.execute(runId, envelope, plan, {
          onEvent: opts.onEvent,
          correlationId: opts.correlationId,
          hitl: opts.hitl,
          initialState: {
            completedNodeIds: Array.from(completedNodeIds),
            nodeOutputs: Object.fromEntries(nodeOutputs.entries()),
            policyActions,
            policyAttempts: Object.fromEntries(policyAttempts.entries()),
            postConditionAttempts: Object.fromEntries(postConditionAttempts.entries()),
            mode: opts.initialState?.mode
          },
          runContext: activeRunContext,
          schemaHash: opts.schemaHash ?? null
        })
      }
    }

    if (opts.runContext) {
      const contextProjection = activeRunContext.composeFinalOutput(envelope.outputContract, plan)
      if (!finalOutput || Object.keys(finalOutput).length === 0) {
        finalOutput = contextProjection
      } else if (Object.keys(contextProjection).length === 0) {
        const terminal = plan.nodes[plan.nodes.length - 1]
        for (const [facet, value] of Object.entries(finalOutput)) {
          activeRunContext.updateFacet(facet, value, {
            nodeId: terminal?.id ?? 'resume_final',
            capabilityId: terminal?.capabilityId,
            rationale: 'resume_final_output'
          })
        }
      }
    }

    if (!opts.runContext && finalOutput && Object.keys(finalOutput).length) {
      const terminal = plan.nodes[plan.nodes.length - 1]
      for (const [facet, value] of Object.entries(finalOutput)) {
        activeRunContext.updateFacet(facet, value, {
          nodeId: terminal?.id ?? 'resume_final',
          capabilityId: terminal?.capabilityId,
          rationale: 'resume_final_output'
        })
      }
    }

    if (!finalOutput || Object.keys(finalOutput).length === 0) {
      throw new Error('No stored output available for flex HITL resume')
    }

    const terminalNode = plan.nodes[plan.nodes.length - 1]
    if (terminalNode) {
      const startAt = new Date()
      nodeStatuses.set(terminalNode.id, 'running')
      nodeTimings.set(terminalNode.id, { ...(nodeTimings.get(terminalNode.id) ?? {}), startedAt: startAt })
      await this.persistence.markNode(runId, terminalNode.id, {
        status: 'running',
        startedAt: startAt
      })
      await opts.onEvent(
        this.buildEvent(
          'node_start',
          {
            capabilityId: terminalNode.capabilityId,
            label: terminalNode.label,
            startedAt: startAt.toISOString()
          },
          {
            runId,
            nodeId: terminalNode.id,
            planVersion: plan.version,
            facetProvenance: this.normalizeFacetProvenance(terminalNode.provenance)
          }
        )
      )

      const completedAt = new Date()
      nodeStatuses.set(terminalNode.id, 'completed')
      nodeTimings.set(terminalNode.id, { ...(nodeTimings.get(terminalNode.id) ?? {}), completedAt })
      await this.persistence.markNode(runId, terminalNode.id, {
        status: 'completed',
        output: finalOutput,
        completedAt
      })
      nodeOutputs.set(terminalNode.id, finalOutput)
      await opts.onEvent(
        this.buildEvent(
          'node_complete',
          {
            capabilityId: terminalNode.capabilityId,
            label: terminalNode.label,
            completedAt: completedAt.toISOString(),
            output: finalOutput
          },
          {
            runId,
            nodeId: terminalNode.id,
            planVersion: plan.version,
            facetProvenance: this.normalizeFacetProvenance(terminalNode.provenance)
          }
        )
      )
    }

    await this.ensureOutputMatchesContract(
      envelope.outputContract,
      finalOutput,
      { scope: 'final_output', runId },
      opts
    )

    const facetsSnapshot = activeRunContext.snapshot()
    const goalConditionResults =
      envelope.goal_condition && envelope.goal_condition.length
        ? evaluateGoalConditions(envelope.goal_condition, { runContextSnapshot: facetsSnapshot })
        : []
    const failedGoalConditions = goalConditionResults.filter(
      (entry) => !entry.satisfied || (typeof entry.error === 'string' && entry.error.length > 0)
    )
    if (failedGoalConditions.length) {
      throw new GoalConditionFailedError({
        state: {
          completedNodeIds: Array.from(completedNodeIds),
          nodeOutputs: Object.fromEntries(nodeOutputs.entries()),
          facets: facetsSnapshot,
          ...(policyActions.length ? { policyActions: this.clonePolicyActions(policyActions) } : {}),
          ...(policyAttempts.size ? { policyAttempts: Object.fromEntries(policyAttempts.entries()) } : {}),
          postConditionAttempts: postConditionAttempts.size
            ? Object.fromEntries(postConditionAttempts.entries())
            : undefined
        },
        results: goalConditionResults,
        failed: failedGoalConditions,
        finalOutput
      })
    }
    const snapshotNodes = this.buildPlanSnapshotNodes(plan, nodeStatuses, nodeOutputs, nodeTimings)
    const provenance = this.extractOutputProvenance(facetsSnapshot, finalOutput)
    await this.persistence.recordResult(runId, finalOutput, {
      planVersion: plan.version,
      status: 'completed',
      schemaHash: opts.schemaHash ?? null,
      facets: facetsSnapshot,
      provenance,
      goalConditionResults: goalConditionResults.length ? goalConditionResults : null,
      snapshot: {
        planVersion: plan.version,
        nodes: snapshotNodes,
        edges: plan.edges,
        planMetadata: plan.metadata,
        pendingState: {
          completedNodeIds: Array.from(completedNodeIds),
          nodeOutputs: Object.fromEntries(nodeOutputs.entries()),
          policyActions: this.clonePolicyActions(policyActions),
          policyAttempts: policyAttempts.size ? Object.fromEntries(policyAttempts.entries()) : undefined,
          postConditionAttempts: postConditionAttempts.size
            ? Object.fromEntries(postConditionAttempts.entries())
            : undefined,
          mode: opts.initialState?.mode
        }
      }
    })
    const completePayload: Record<string, unknown> = { output: finalOutput }
    if (goalConditionResults.length) {
      completePayload.goal_condition_results = goalConditionResults
    }
    await opts.onEvent(
      this.buildEvent(
        'complete',
        completePayload,
        {
          runId,
          planVersion: plan.version,
          facetProvenance: this.normalizeFacetProvenance(provenance)
        }
      )
    )
    return finalOutput
  }
}
