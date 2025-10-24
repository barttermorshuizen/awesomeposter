import Ajv, { type ErrorObject } from 'ajv'
import { z, type ZodTypeAny } from 'zod'
import type { FlexPlan, FlexPlanNode } from './flex-planner'
import type {
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
  Action
} from '@awesomeposter/shared'
import { FlexRunPersistence, type FlexPlanNodeSnapshot, type FlexPlanNodeStatus } from './orchestrator-persistence'
import { withHitlContext } from './hitl-context'
import { parseHitlDecisionAction, resolveHitlDecision as resolveHitlDecisionDetail, type HitlService } from './hitl-service'
import { getFlexCapabilityRegistryService, type FlexCapabilityRegistryService } from './flex-capability-registry'
import { getAgents, resolveCapabilityPrompt } from './agents-container'
import type { AgentRuntime } from './agent-runtime'
import { getLogger } from './logger'
import { RunContext, type FacetEntry, type FacetSnapshot } from './run-context'
import { FacetContractCompiler, getFacetCatalog } from '@awesomeposter/shared'
import type { RuntimePolicyEffect } from './policy-normalizer'
import type { PendingPolicyActionState, PolicyAttemptState, RuntimePolicySnapshotMode } from './runtime-policy-types'

type StructuredRuntime = Pick<AgentRuntime, 'runStructured'>
type AjvInstance = ReturnType<typeof Ajv>
type AjvValidateFn = ReturnType<AjvInstance['compile']>

type RuntimePolicyActionResult =
  | { kind: 'goto'; nextIndex: number }
  | { kind: 'noop' }

const POLICY_ACTION_SOURCE = {
  runtime: 'runtime',
  approval: 'hitl.approve',
  rejection: 'hitl.reject'
} as const
type PolicyActionSource = (typeof POLICY_ACTION_SOURCE)[keyof typeof POLICY_ACTION_SOURCE]

class FlexValidationError extends Error {
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

function jsonSchemaToZod(schema: JsonSchemaShape): ZodTypeAny {
  if (!schema || typeof schema !== 'object') {
    return z.unknown()
  }

  if (Object.prototype.hasOwnProperty.call(schema, 'const')) {
    return z.literal((schema as any).const)
  }

  if (Array.isArray((schema as any).enum) && (schema as any).enum.length) {
    const literals = (schema as any).enum.map((value: unknown) => z.literal(value as any))
    if (literals.length === 1) return literals[0]
    return z.union(literals as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]])
  }

  const combinators = (schema as any).anyOf || (schema as any).oneOf
  if (Array.isArray(combinators) && combinators.length) {
    const variants = combinators.map((entry: JsonSchemaShape) => jsonSchemaToZod(entry))
    if (variants.length === 1) return variants[0]
    return z.union(variants as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]])
  }

  if (Array.isArray((schema as any).allOf) && (schema as any).allOf.length) {
    const variants = (schema as any).allOf.map((entry: JsonSchemaShape) => jsonSchemaToZod(entry))
    const [first, ...rest] = variants
    if (!first) return z.unknown()
    return rest.reduce((acc, current) => z.intersection(acc, current), first)
  }

  const rawType = (schema as any).type
  const typeList = Array.isArray(rawType) ? rawType : rawType ? [rawType] : []
  if (typeList.length > 1) {
    const variants = typeList.map((entry: string) =>
      jsonSchemaToZod({ ...(schema as any), type: entry } as JsonSchemaShape)
    )
    return z.union(variants as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]])
  }

  const type = typeList[0]
  switch (type) {
    case 'string': {
      let str = z.string()
      if (typeof (schema as any).minLength === 'number') str = str.min((schema as any).minLength)
      if (typeof (schema as any).maxLength === 'number') str = str.max((schema as any).maxLength)
      if (Array.isArray((schema as any).pattern)) {
        str = str.regex(new RegExp((schema as any).pattern))
      } else if (typeof (schema as any).pattern === 'string') {
        str = str.regex(new RegExp((schema as any).pattern))
      }
      return str
    }
    case 'number':
    case 'integer': {
      let num = z.number()
      if (type === 'integer') num = num.int()
      if (typeof (schema as any).minimum === 'number') num = num.min((schema as any).minimum)
      if (typeof (schema as any).maximum === 'number') num = num.max((schema as any).maximum)
      return num
    }
    case 'boolean':
      return z.boolean()
    case 'null':
      return z.null()
    case 'array': {
      const items = (schema as any).items
      let elementSchema: ZodTypeAny
      if (Array.isArray(items) && items.length) {
        const variants = items.map((entry: JsonSchemaShape) => jsonSchemaToZod(entry))
        elementSchema =
          variants.length === 1 ? variants[0] : z.union(variants as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]])
      } else if (items && typeof items === 'object') {
        elementSchema = jsonSchemaToZod(items as JsonSchemaShape)
      } else {
        elementSchema = z.unknown()
      }
      let arr = z.array(elementSchema)
      if (typeof (schema as any).minItems === 'number') arr = arr.min((schema as any).minItems)
      if (typeof (schema as any).maxItems === 'number') arr = arr.max((schema as any).maxItems)
      if ((schema as any).uniqueItems) arr = arr.superRefine((list, ctx) => {
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
      return arr
    }
    case 'object':
    default: {
      const properties = ((schema as any).properties ?? {}) as Record<string, JsonSchemaShape>
      const required = new Set<string>(Array.isArray((schema as any).required) ? (schema as any).required : [])
      const shape: Record<string, ZodTypeAny> = {}
      for (const [key, definition] of Object.entries(properties)) {
        const childSchema = jsonSchemaToZod(definition)
        shape[key] = required.has(key) ? childSchema : childSchema.optional()
      }
      let obj = z.object(shape)
      const additional = (schema as any).additionalProperties
      if (additional === false) {
        obj = obj.strict()
      } else if (additional && typeof additional === 'object') {
        obj = obj.catchall(jsonSchemaToZod(additional as JsonSchemaShape))
      } else {
        obj = obj.passthrough()
      }
      return obj
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
    facets?: Record<string, FacetEntry>
    policyActions?: PendingPolicyActionState[]
    policyAttempts?: PolicyAttemptState
    mode?: RuntimePolicySnapshotMode
  }
  runContext?: RunContext
  schemaHash?: string | null
}

type CapabilityResult = {
  output: Record<string, unknown>
}

export class HitlPauseError extends Error {
  constructor(message = 'Awaiting HITL approval') {
    super(message)
    this.name = 'HitlPauseError'
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
      facets: Record<string, FacetEntry>
      policyActions?: PendingPolicyActionState[]
      policyAttempts?: PolicyAttemptState
    }
  ) {
    super('Replan requested')
    this.name = 'ReplanRequestedError'
  }
}

export class FlexExecutionEngine {
  private readonly ajv: AjvInstance
  private readonly validatorCache = new Map<string, AjvValidateFn>()
  private readonly runtime: StructuredRuntime
  private readonly capabilityRegistry: FlexCapabilityRegistryService
  private readonly facetCompiler: FacetContractCompiler

  constructor(
    private readonly persistence = new FlexRunPersistence(),
    options?: {
      ajv?: AjvInstance
      runtime?: StructuredRuntime
      capabilityRegistry?: FlexCapabilityRegistryService
    }
  ) {
    this.ajv = options?.ajv ?? new Ajv({ allErrors: true })
    this.runtime = options?.runtime ?? getAgents().runtime
    this.capabilityRegistry = options?.capabilityRegistry ?? getFlexCapabilityRegistryService()
    this.facetCompiler = new FacetContractCompiler({ catalog: getFacetCatalog() })
  }

  private async handleVirtualNode(runId: string, node: FlexPlanNode, opts: FlexExecutionOptions) {
    const startedAt = new Date()
    await this.persistence.markNode(runId, node.id, {
      status: 'running',
      capabilityId: node.capabilityId,
      label: node.label,
      context: node.bundle,
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
        { runId, nodeId: node.id }
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
        { runId, nodeId: node.id }
      )
    )
  }

  async execute(runId: string, envelope: TaskEnvelope, plan: FlexPlan, opts: FlexExecutionOptions) {
    const initialNodeOutputs = opts.initialState?.nodeOutputs ?? {}
    const nodeOutputs = new Map<string, Record<string, unknown>>(Object.entries(initialNodeOutputs))
    const completedNodeIds = new Set<string>(opts.initialState?.completedNodeIds ?? Object.keys(initialNodeOutputs))
    const runContext =
      opts.runContext ??
      RunContext.fromSnapshot((opts.initialState?.facets as Record<string, FacetEntry> | undefined) ?? undefined)
    const nodeStatuses = new Map<string, FlexPlanNodeStatus>()
    const nodeTimings = new Map<string, { startedAt?: Date | null; completedAt?: Date | null }>()
    const policyActions: PendingPolicyActionState[] = Array.isArray(opts.initialState?.policyActions)
      ? opts.initialState!.policyActions.map((action) => ({ ...action }))
      : []
    const policyAttempts = new Map<string, number>(Object.entries(opts.initialState?.policyAttempts ?? {}))
    for (const node of plan.nodes) {
      nodeStatuses.set(node.id, completedNodeIds.has(node.id) ? 'completed' : 'pending')
    }

    let startIndex = 0
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
        policyAttempts
      })
      policyActions.splice(0, policyActions.length, ...pendingDispatch.remainingActions)
      if (typeof pendingDispatch.nextIndex === 'number') {
        startIndex = pendingDispatch.nextIndex
      }
    }

    if (startIndex === 0) {
      const firstPendingIndex = plan.nodes.findIndex((node) => !completedNodeIds.has(node.id))
      startIndex = firstPendingIndex >= 0 ? firstPendingIndex : plan.nodes.length
    }

    if (opts.onStart) {
      const nextNode = startIndex < plan.nodes.length ? plan.nodes[startIndex] : null
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
            policyAttempts: policyAttempts.size ? Object.fromEntries(policyAttempts.entries()) : undefined
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
                policyAttempts
              },
              { source: POLICY_ACTION_SOURCE.runtime }
            )
            if (actionOutcome?.kind === 'goto' && typeof actionOutcome.nextIndex === 'number') {
              startIndex = actionOutcome.nextIndex
            }
          }
        }
      }
    }

    for (let index = startIndex; index < plan.nodes.length; ) {
      const node = plan.nodes[index]
      if (completedNodeIds.has(node.id)) {
        nodeStatuses.set(node.id, 'completed')
        index += 1
        continue
      }
      const isVirtual = !node.capabilityId
      if (isVirtual) {
        nodeStatuses.set(node.id, 'running')
        await this.handleVirtualNode(runId, node, opts)
        nodeStatuses.set(node.id, 'completed')
        completedNodeIds.add(node.id)
        index += 1
        continue
      }

      const startedAt = new Date()
      nodeStatuses.set(node.id, 'running')
      nodeTimings.set(node.id, { ...(nodeTimings.get(node.id) ?? {}), startedAt })
      await this.persistence.markNode(runId, node.id, {
        status: 'running',
        capabilityId: node.capabilityId,
        label: node.label,
        context: node.bundle,
        startedAt
      })
      try {
        getLogger().info('flex_node_start', {
          runId,
          nodeId: node.id,
          capabilityId: node.capabilityId,
          correlationId: opts.correlationId
        })
      } catch {}
      await opts.onEvent(
        this.buildEvent(
          'node_start',
          {
            capabilityId: node.capabilityId,
            label: node.label,
            startedAt: startedAt.toISOString()
          },
          { runId, nodeId: node.id }
        )
      )

      try {
        const result = await this.invokeCapability(runId, node, envelope, opts, plan, runContext, nodeOutputs)
        nodeOutputs.set(node.id, result.output)
        runContext.updateFromNode(node, result.output)
        completedNodeIds.add(node.id)

        const completedAt = new Date()
        nodeStatuses.set(node.id, 'completed')
        nodeTimings.set(node.id, { ...(nodeTimings.get(node.id) ?? {}), completedAt })
        await this.persistence.markNode(runId, node.id, {
          status: 'completed',
          output: result.output,
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
              output: result.output
            },
            { runId, nodeId: node.id }
          )
        )

        const effect = await opts.onNodeComplete?.({
          node,
          output: result.output,
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
              policyAttempts: policyAttempts.size ? Object.fromEntries(policyAttempts.entries()) : undefined
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
                policyAttempts
              },
              { source: POLICY_ACTION_SOURCE.runtime }
            )
            if (actionOutcome?.kind === 'goto') {
              index = actionOutcome.nextIndex
              continue
            }
          }
        }

        index += 1
      } catch (error) {
        if (error instanceof ReplanRequestedError) {
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
            { runId, nodeId: node.id, message: serialized.message as string | undefined }
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
        policyAttempts
      })
    }

    await this.ensureOutputMatchesContract(
      envelope.outputContract,
      finalOutput,
      { scope: 'final_output', runId },
      opts
    )

    const facetsSnapshot = runContext.snapshot()
    const snapshotNodes = this.buildPlanSnapshotNodes(plan, nodeStatuses, nodeOutputs, nodeTimings)
    const provenance = this.extractOutputProvenance(facetsSnapshot, finalOutput)
    await this.persistence.recordResult(runId, finalOutput, {
      planVersion: plan.version,
      status: 'completed',
      schemaHash: opts.schemaHash ?? null,
      facets: facetsSnapshot,
      provenance,
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
          mode: opts.initialState?.mode
        }
      }
    })
    await opts.onEvent(this.buildEvent('complete', { output: finalOutput }, { runId }))
    return finalOutput
  }

  private async invokeCapability(
    runId: string,
    node: FlexPlanNode,
    envelope: TaskEnvelope,
    opts: FlexExecutionOptions,
    plan: FlexPlan,
    runContext: RunContext,
    nodeOutputs: Map<string, Record<string, unknown>>
  ): Promise<CapabilityResult> {
    if (!node.capabilityId) {
      throw new Error(`Execution node ${node.id} is missing capabilityId`)
    }

    const capability = await this.resolveCapability(node.capabilityId)
    await this.validateCapabilityInputs(capability, node, runId, opts)
    try {
      getLogger().info('flex_capability_dispatch_start', {
        runId,
        nodeId: node.id,
        capabilityId: capability.capabilityId,
        correlationId: opts.correlationId
      })
    } catch {}
    const result = await this.dispatchCapability(capability, node, envelope, plan, runContext, nodeOutputs)
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
        result.output,
        { scope: 'capability_output', runId, nodeId: node.id },
        opts
      )
    }
    return result
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
      nodeTimings: Map<string, { startedAt?: Date; completedAt?: Date }>
      completedNodeIds: Set<string>
      policyActions: PendingPolicyActionState[]
      policyAttempts: Map<string, number>
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
          message: `runtime_policy:${source}:${action.type}`
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
          policyAttempts: context.policyAttempts
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
          rationale: action.rationale
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

  private async validateCapabilityInputs(
    capability: CapabilityRecord,
    node: FlexPlanNode,
    runId: string,
    opts: FlexExecutionOptions
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
      node.bundle.inputs ?? {},
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
    nodeOutputs: Map<string, Record<string, unknown>>
  ): Promise<CapabilityResult> {
    return this.executeCapability(capability, node, envelope, plan, runContext, nodeOutputs)
  }

  private async executeCapability(
    capability: CapabilityRecord,
    node: FlexPlanNode,
    envelope: TaskEnvelope,
    plan: FlexPlan,
    runContext: RunContext,
    nodeOutputs: Map<string, Record<string, unknown>>
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
      promptContext
    })

    const runOptions: {
      schemaName: string
      toolsAllowlist?: string[]
      toolPolicy?: 'auto' | 'required' | 'off'
    } = {
      schemaName:
        (typeof (node.metadata as Record<string, unknown> | undefined)?.plannerStage === 'string'
          ? (node.metadata as Record<string, unknown>).plannerStage
          : undefined) ?? capability.capabilityId
    }

    if (promptContext?.toolsAllowlist?.length) {
      runOptions.toolsAllowlist = promptContext.toolsAllowlist
      runOptions.toolPolicy = 'auto'
    }

    const result = await this.runtime.runStructured<any>(schema, messages, runOptions)

    return {
      output: (result ?? {}) as Record<string, unknown>
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
  }): Array<{ role: 'system' | 'user'; content: string }> {
    const { capability, node, envelope, runContext, nodeOutputs, schemaShape, promptContext } = args
    const instructions = Array.isArray(node.bundle.instructions) ? node.bundle.instructions : []
    const metadata = (node.metadata ?? {}) as Record<string, unknown>
    const plannerStage =
      typeof metadata.plannerStage === 'string' ? metadata.plannerStage : node.label ?? node.kind ?? 'unspecified'
    const rationale = Array.isArray(node.rationale) ? node.rationale : []
    const inputs = (node.bundle.inputs ?? {}) as Record<string, unknown>
    const policies = (node.bundle.policies ?? {}) as Record<string, unknown>
    const facetSnapshot = runContext.getAllFacets()
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

    if (completedOutputs.length) {
      userSections.push(`Recently completed node outputs:\n${stringifyForPrompt(completedOutputs)}`)
    }

    if (facetSnapshot && Object.keys(facetSnapshot).length) {
      userSections.push(`Facet snapshot:\n${stringifyForPrompt(facetSnapshot)}`)
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

  private composeFinalOutput(plan: FlexPlan, nodeOutputs: Map<string, Record<string, unknown>>) {
    if (!plan.nodes.length) return {}
    for (let i = plan.nodes.length - 1; i >= 0; i -= 1) {
      const node = plan.nodes[i]
      const output = nodeOutputs.get(node.id)
      if (output) return output
    }
    return {}
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

  private buildHitlPayload(
    envelope: TaskEnvelope,
    finalOutput: Record<string, unknown>,
    overrides?: { question?: string | null; policyId?: string; nodeLabel?: string }
  ): HitlRequestPayload {
    const variants = Array.isArray((finalOutput as any)?.copyVariants) ? (finalOutput as any).copyVariants : []
    const objective = (envelope.objective || '').trim()
    const summaryLines = [
      objective ? `Objective: ${objective}` : null,
      variants.length
        ? `Generated ${variants.length} variant${variants.length === 1 ? '' : 's'} for review.`
        : 'No structured variants detected.'
    ].filter(Boolean) as string[]

    if (overrides?.policyId) {
      summaryLines.push(`Runtime policy: ${overrides.policyId}`)
    }
    if (overrides?.nodeLabel) {
      summaryLines.push(`Triggered by node: ${overrides.nodeLabel}`)
    }

    const defaultQuestion = 'Review generated flex run output and approve before completing the request.'
    const question = overrides?.question?.trim() ? overrides.question.trim() : defaultQuestion

    return {
      question,
      kind: 'approval',
      options: [
        { id: 'approve', label: 'Approve output' },
        { id: 'revise', label: 'Request revisions' }
      ],
      allowFreeForm: true,
      urgency: 'normal',
      additionalContext: summaryLines.join(' ')
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
  }) {
    const { runId, node, opts, eventName, payload, policyId, rationale } = args
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
            message: `runtime_policy_emit:${eventName}`
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
            message: rationale ?? undefined
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
      nodeTimings: Map<string, { startedAt?: Date; completedAt?: Date }>
      completedNodeIds: Set<string>
      policyAttempts: Map<string, number>
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

    for (let i = targetIndex; i < context.plan.nodes.length; i++) {
      const targetNode = context.plan.nodes[i]
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
            message: `runtime_policy_goto:${action.next}`
          }
        )
      )
    } catch {}

    return { kind: 'goto', nextIndex: targetIndex }
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
      nodeTimings: Map<string, { startedAt?: Date; completedAt?: Date }>
      completedNodeIds: Set<string>
      policyActions: PendingPolicyActionState[]
      policyAttempts: Map<string, number>
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
    nodeTimings: Map<string, { startedAt?: Date; completedAt?: Date }>
    completedNodeIds: Set<string>
    policyActions: PendingPolicyActionState[]
    policyAttempts: Map<string, number>
  }): Promise<{ remainingActions: PendingPolicyActionState[]; nextIndex: number | null }> {
    const hitlState = args.opts.hitl?.state
    if (!hitlState) {
      return { remainingActions: args.policyActions, nextIndex: null }
    }

    const remaining: PendingPolicyActionState[] = []
    let nextIndex: number | null = null

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
          policyAttempts: args.policyAttempts
        },
        {
          actionOverride: followUpAction,
          source: decision === 'approve' ? POLICY_ACTION_SOURCE.approval : POLICY_ACTION_SOURCE.rejection,
          requestId: entry.requestId
        }
      )

      if (actionOutcome?.kind === 'goto') {
        nextIndex = nextIndex === null ? actionOutcome.nextIndex : Math.min(nextIndex, actionOutcome.nextIndex)
      }
    }

    return {
      remainingActions: remaining,
      nextIndex
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
    nodeTimings: Map<string, { startedAt?: Date; completedAt?: Date }>
    completedNodeIds: Set<string>
    schemaHash?: string | null
    rationale?: string
    policyId?: string
    pendingPolicyAction?: PendingPolicyActionState
    policyActions: PendingPolicyActionState[]
    policyAttempts: Map<string, number>
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
      policyAttempts
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
        capabilityId: targetNode.capabilityId,
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
        const payload = this.buildHitlPayload(envelope, finalOutput, {
          question: rationale,
          policyId,
          nodeLabel: targetNode.label
        })
        const result = await hitl.service.raiseRequest(payload)
        if (result.status === 'denied') {
          throw new Error(result.reason || 'HITL request denied')
        }
      }
    )

    if (latestState !== hitl.state) {
      hitl.state = latestState
      hitl.updateState?.(latestState)
    }

    if (!pendingRecord) {
      throw new Error('HITL request was not created')
    }

    if (pendingPolicyAction) {
      pendingPolicyAction.requestId = pendingRecord.id
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
      policyAttempts: policyAttempts.size ? Object.fromEntries(policyAttempts.entries()) : undefined
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
        mode: 'hitl'
      }
    })
    await this.persistence.updateStatus(runId, 'awaiting_hitl')
    if (hitl.onRequest) {
      await hitl.onRequest(pendingRecord, latestState)
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
    return errors.map((err) => ({
      message: err.message,
      instancePath: (err as any).instancePath ?? err.dataPath ?? '',
      keyword: err.keyword,
      params: err.params ?? {},
      schemaPath: err.schemaPath
    }))
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
    meta?: { runId?: string; nodeId?: string; message?: string }
  ): FlexEvent {
    return {
      type,
      timestamp: new Date().toISOString(),
      payload,
      runId: meta?.runId,
      nodeId: meta?.nodeId,
      message: meta?.message
    }
  }

  private buildPlanSnapshotNodes(
    plan: FlexPlan,
    nodeStatuses: Map<string, FlexPlanNodeStatus>,
    nodeOutputs: Map<string, Record<string, unknown>>,
    timings: Map<string, { startedAt?: Date | null; completedAt?: Date | null }>
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
        startedAt: timing.startedAt ?? null,
        completedAt: timing.completedAt ?? null
      }
    })
  }

  private extractOutputProvenance(facets: FacetSnapshot, output: Record<string, unknown>) {
    const provenance: Record<string, unknown> = {}
    if (!output) return provenance
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
    const nodeTimings = new Map<string, { startedAt?: Date | null; completedAt?: Date | null }>()
    const policyActions: PendingPolicyActionState[] = Array.isArray(opts.initialState?.policyActions)
      ? opts.initialState!.policyActions.map((action) => ({ ...action }))
      : []
    const policyAttempts = new Map<string, number>(Object.entries(opts.initialState?.policyAttempts ?? {}))
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
        policyAttempts
      })
      policyActions.splice(0, policyActions.length, ...pendingDispatch.remainingActions)
      if (typeof pendingDispatch.nextIndex === 'number') {
        return this.execute(runId, envelope, plan, {
          onEvent: opts.onEvent,
          correlationId: opts.correlationId,
          hitl: opts.hitl,
          initialState: {
            completedNodeIds: Array.from(completedNodeIds),
            nodeOutputs: Object.fromEntries(nodeOutputs.entries()),
            policyActions,
            policyAttempts: Object.fromEntries(policyAttempts.entries()),
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
          { runId, nodeId: terminalNode.id }
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
          { runId, nodeId: terminalNode.id }
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
    const snapshotNodes = this.buildPlanSnapshotNodes(plan, nodeStatuses, nodeOutputs, nodeTimings)
    const provenance = this.extractOutputProvenance(facetsSnapshot, finalOutput)
    await this.persistence.recordResult(runId, finalOutput, {
      planVersion: plan.version,
      status: 'completed',
      schemaHash: opts.schemaHash ?? null,
      facets: facetsSnapshot,
      provenance,
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
          mode: opts.initialState?.mode
        }
      }
    })
    await opts.onEvent(this.buildEvent('complete', { output: finalOutput }, { runId }))
    return finalOutput
  }
}
