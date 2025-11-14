import type {
  AssignmentDefaults,
  AssignmentSnapshot,
  CapabilityRecord,
  ContextBundle,
  FlexPlanNodeContracts,
  FlexPlanNodeFacets,
  FlexPlanNodeProvenance,
  GoalConditionResult,
  JsonSchemaContract,
  NodeContract,
  OutputContract,
  TaskEnvelope,
  TaskPolicies,
  ConditionalRoutingNode,
  FlexCrcsSnapshot
} from '@awesomeposter/shared'

export type { FlexPlanNodeContracts, FlexPlanNodeFacets, FlexPlanNodeProvenance } from '@awesomeposter/shared'
import {
  FacetContractCompiler,
  type FacetCatalog,
  type FacetProvenance,
  getFacetCatalog,
  parseTaskPolicies,
  compileConditionalRoutingNode
} from '@awesomeposter/shared'
import { getFlexCapabilityRegistryService, type FlexCapabilityRegistryService } from './flex-capability-registry'
import { getLogger } from './logger'
import {
  PlannerService,
  type PlannerServiceInterface,
  type PlannerGraphContext,
  type PlannerContextHints
} from './planner-service'
import type { FacetSnapshot, RunContextSnapshot } from './run-context'
import type { PlannerDraft, PlannerDraftNode, PlannerDiagnostics } from '../planner/planner-types'
import { PlannerValidationService } from './planner-validation-service'
export type FlexPlanNodeKind =
  | 'structuring'
  | 'branch'
  | 'execution'
  | 'transformation'
  | 'validation'
  | 'fallback'
  | 'routing'

export type FlexPlanNodeStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'awaiting_hitl'
  | 'awaiting_human'
  | 'error'

export type FlexPlanEdge = {
  from: string
  to: string
  reason?: string
}

export type FlexPlanExecutor = {
  type: 'ai' | 'human'
  capabilityId?: string | null
  assignment?: {
    defaults?: AssignmentDefaults | null
    instructions?: string | null
    metadata?: Record<string, unknown> | null
  }
}

export type FlexPlanNode = {
  id: string
  status: FlexPlanNodeStatus
  kind: FlexPlanNodeKind
  capabilityId: string | null
  capabilityLabel: string
  capabilityVersion?: string
  derivedCapability?: { fromCapabilityId: string }
  label: string
  bundle: ContextBundle
  contracts: FlexPlanNodeContracts
  facets: FlexPlanNodeFacets
  provenance: FlexPlanNodeProvenance
  rationale: string[]
  executor?: FlexPlanExecutor
  routing?: ConditionalRoutingNode | null
  metadata: Record<string, unknown>
}

export type FlexPlan = {
  runId: string
  version: number
  createdAt: string
  nodes: FlexPlanNode[]
  edges: FlexPlanEdge[]
  metadata: Record<string, unknown>
}

export type PlannerGraphState = {
  plan: FlexPlan
  completedNodeIds: string[]
  nodeOutputs: Record<string, Record<string, unknown>>
  facets?: FacetSnapshot | RunContextSnapshot
  goalConditionFailures?: GoalConditionResult[]
}

export class UnsupportedObjectiveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedObjectiveError'
  }
}

export class PlannerDraftRejectedError extends Error {
  constructor(public readonly diagnostics: PlannerDiagnostics) {
    super('Planner draft failed validation')
    this.name = 'PlannerDraftRejectedError'
  }
}

export class MissingPinnedCapabilitiesError extends Error {
  constructor(public readonly capabilityIds: string[]) {
    super(`Pinned capabilities missing from CRCS: ${capabilityIds.join(', ')}`)
    this.name = 'MissingPinnedCapabilitiesError'
  }
}

type FlexPlannerDependencies = {
  capabilityRegistry?: FlexCapabilityRegistryService
  plannerService?: PlannerServiceInterface
  validationService?: PlannerValidationService
}

type PlannerOptions = {
  now?: () => Date
}

function unique<T>(values: Iterable<T>): T[] {
  return Array.from(new Set(values))
}

function safeJsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null)) as T
}

function sanitizeNodeId(base: string, index: number): string {
  return `${base.replace(/[^a-zA-Z0-9]+/g, '_') || 'node'}_${index + 1}`
}

function coerceNodeKind(kind?: string | null): FlexPlanNodeKind {
  switch (kind) {
    case 'structuring':
    case 'branch':
    case 'execution':
    case 'transformation':
    case 'validation':
    case 'fallback':
    case 'routing':
      return kind
    default:
      return 'execution'
  }
}

function normalizeDraftStatus(status: PlannerDraftNode['status']): FlexPlanNodeStatus {
  switch (status) {
    case 'running':
    case 'completed':
    case 'awaiting_hitl':
    case 'awaiting_human':
    case 'error':
    case 'pending':
      return status
    default:
      return 'pending'
  }
}

function extractFacetUnion(capability: CapabilityRecord, direction: 'input' | 'output'): string[] {
  const explicit = direction === 'input' ? capability.inputFacets ?? [] : capability.outputFacets ?? []
  if (explicit.length) return unique(explicit)
  const contract = direction === 'input' ? capability.inputContract : capability.outputContract
  if (!contract) return []
  if (contract.mode === 'facets') return unique(contract.facets ?? [])
  return []
}

type PlanRequestContext = {
  runId: string
  variantCount: number
  context: PlannerContextHints
  policies: TaskPolicies
  policyMetadata?: {
    legacyNotes: string[]
    legacyFields: string[]
  }
  capabilities: CapabilityRecord[]
  crcs: FlexCrcsSnapshot
}

type BuildPlanOptions = {
  onRequest?: (context: PlanRequestContext) => Promise<void> | void
  policies?: TaskPolicies
  policyMetadata?: {
    legacyNotes: string[]
    legacyFields: string[]
  }
  graphState?: PlannerGraphState
}

export class FlexPlanner {
  private readonly now: () => Date
  private readonly capabilityRegistry: FlexCapabilityRegistryService
  private readonly plannerService: PlannerServiceInterface
  private readonly validationService: PlannerValidationService
  private readonly facetCatalog: FacetCatalog
  private readonly compiler: FacetContractCompiler

  constructor(deps: FlexPlannerDependencies = {}, options?: PlannerOptions) {
    this.capabilityRegistry = deps.capabilityRegistry ?? getFlexCapabilityRegistryService()
    this.plannerService = deps.plannerService ?? new PlannerService()
    this.validationService = deps.validationService ?? new PlannerValidationService()
    this.now = options?.now ?? (() => new Date())
    this.facetCatalog = getFacetCatalog()
    this.compiler = new FacetContractCompiler({ catalog: this.facetCatalog })
  }

  private summarizeGraphState(state?: PlannerGraphState): PlannerGraphContext | undefined {
    if (!state) return undefined
    const { plan } = state
    if (!plan.nodes.length) return undefined

    const completedSet = new Set(state.completedNodeIds)
    const completedNodes: PlannerGraphContext['completedNodes'] = []
    const facetValues: PlannerGraphContext['facetValues'] = []
    let runContext: PlannerGraphContext['runContext']

    for (const node of plan.nodes) {
      if (!completedSet.has(node.id)) continue
      const outputFacets = node.facets?.output ?? []
      completedNodes.push({
        nodeId: node.id,
        capabilityId: node.capabilityId ?? null,
        label: node.label,
        outputFacets
      })
    }

    const resolveRunContextSnapshot = (
      facets: PlannerGraphState['facets']
    ): RunContextSnapshot | undefined => {
      if (!facets) return undefined
      const candidate = facets as RunContextSnapshot
      if (candidate && typeof candidate === 'object' && 'hitlClarifications' in candidate) {
        return {
          facets: candidate.facets ?? {},
          hitlClarifications: Array.isArray(candidate.hitlClarifications)
            ? candidate.hitlClarifications
            : []
        }
      }
      return {
        facets: facets as FacetSnapshot,
        hitlClarifications: []
      }
    }

    const runContextSnapshot = resolveRunContextSnapshot(state.facets)

    if (runContextSnapshot) {
      const entries = Object.entries(runContextSnapshot.facets ?? {})
      const recent = entries.slice(-12)
      recent.forEach(([facet, entry]) => {
        const provenance = Array.isArray(entry.provenance)
          ? entry.provenance[entry.provenance.length - 1]
          : undefined
        facetValues.push({
          facet,
          sourceNodeId: provenance?.nodeId ?? 'unknown',
          sourceCapabilityId: provenance?.capabilityId ?? null,
          sourceLabel: provenance?.nodeId ?? 'Facet update',
          value: entry.value
        })
      })
      runContext = {
        facets: recent.map(([facet, entry]) => {
          const provenance = Array.isArray(entry.provenance)
            ? entry.provenance[entry.provenance.length - 1]
            : undefined
          return {
            facet,
            value: entry.value,
            updatedAt: entry.updatedAt ?? 'unknown',
            provenance
          }
        }),
        clarifications: runContextSnapshot.hitlClarifications
          .slice(-8)
          .map((clarification) => ({
            questionId: clarification.questionId,
            nodeId: clarification.nodeId,
            capabilityId: clarification.capabilityId ?? null,
            question: clarification.question,
            createdAt: clarification.createdAt,
            answer: clarification.answer ?? null,
            answeredAt: clarification.answeredAt ?? null
          }))
      }
    } else {
      const nodeOutputs = state.nodeOutputs
      for (const node of plan.nodes) {
        if (!completedSet.has(node.id)) continue
        const outputFacets = node.facets?.output ?? []
        const outputPayload = nodeOutputs[node.id]
        if (!outputPayload || !outputFacets.length) continue
        for (const facet of outputFacets) {
          const candidate = (outputPayload as Record<string, unknown>)[facet]
          if (candidate === undefined || candidate === null) {
            if (outputFacets.length === 1) {
              facetValues.push({
                facet,
                sourceNodeId: node.id,
                sourceCapabilityId: node.capabilityId ?? null,
                sourceLabel: node.label,
                value: outputPayload
              })
            }
            continue
          }
          facetValues.push({
            facet,
            sourceNodeId: node.id,
            sourceCapabilityId: node.capabilityId ?? null,
            sourceLabel: node.label,
            value: candidate
          })
        }
      }
    }

    const planSnapshot: PlannerGraphContext['planSnapshot'] = {
      version: plan.version,
      nodes: plan.nodes.map((node) => {
        const status = node.status ?? (completedSet.has(node.id) ? 'completed' : 'pending')
        return {
          nodeId: node.id,
          status,
          capabilityId: node.capabilityId ?? null,
          label: node.label,
          kind: node.kind
        }
      }),
      pendingNodeIds: plan.nodes
        .filter((node) => (node.status ?? (completedSet.has(node.id) ? 'completed' : 'pending')) !== 'completed')
        .map((node) => node.id)
    }

    if (
      !completedNodes.length &&
      !facetValues.length &&
      !runContext &&
      !(planSnapshot.nodes && planSnapshot.nodes.length)
    ) {
      return undefined
    }

    return {
      completedNodes,
      facetValues,
      ...(runContext ? { runContext } : {}),
      planSnapshot
    }
  }

  async buildPlan(runId: string, envelope: TaskEnvelope, options?: BuildPlanOptions): Promise<FlexPlan> {
    const capabilitySnapshot = await this.capabilityRegistry.getSnapshot()
    const canonicalPolicies = options?.policies ?? parseTaskPolicies(envelope.policies ?? {})
    const variantCount = normalizeVariantCount(canonicalPolicies.planner?.topology?.variantCount ?? 1)
    const policyMetadata = options?.policyMetadata ?? { legacyNotes: [], legacyFields: [] }
    const envelopeForPlanner: TaskEnvelope = {
      ...envelope,
      policies: canonicalPolicies
    }
    const plannerContext = derivePlannerContext(envelopeForPlanner, canonicalPolicies, variantCount)
    const graphContext = this.summarizeGraphState(options?.graphState)
    const crcsGraphContext = graphContext
      ? {
          completedNodes: graphContext.completedNodes?.map((node) => ({ outputFacets: node.outputFacets })),
          facetValues: graphContext.facetValues?.map((entry) => ({ facet: entry.facet }))
        }
      : undefined
    const crcs = await this.capabilityRegistry.computeCrcsSnapshot({
      envelope: envelopeForPlanner,
      policies: canonicalPolicies,
      capabilities: capabilitySnapshot.active,
      graphContext: crcsGraphContext,
      goalConditions: envelopeForPlanner.goal_condition,
      goalConditionFailures: options?.graphState?.goalConditionFailures
    })
    await options?.onRequest?.({
      runId,
      variantCount,
      context: plannerContext,
      policies: canonicalPolicies,
      policyMetadata,
      capabilities: capabilitySnapshot.active,
      crcs
    })
    if (crcs.missingPinnedCapabilityIds.length) {
      try {
        getLogger().warn('flex_planner_missing_pinned_capabilities', {
          runId,
          missingPinnedCapabilityIds: crcs.missingPinnedCapabilityIds
        })
      } catch {}
      throw new MissingPinnedCapabilitiesError(crcs.missingPinnedCapabilityIds)
    }
    const plannerDraft = await this.plannerService.proposePlan({
      envelope: envelopeForPlanner,
      context: plannerContext,
      capabilities: capabilitySnapshot.active,
      graphContext,
      policies: canonicalPolicies,
      policyMetadata,
      goalConditionFailures: options?.graphState?.goalConditionFailures,
      crcs
    })
    try {
      const draftPretty = JSON.stringify(plannerDraft, null, 2)
      getLogger().debug(`flex_planner_draft_received\n${draftPretty}`, {
        runId,
        variantCount
      })
    } catch {}
    const validation = this.validationService.validate({
      draft: plannerDraft,
      capabilities: capabilitySnapshot.active,
      envelope
    })
    if (!validation.ok) {
      throw new PlannerDraftRejectedError(validation.diagnostics)
    }
    const plannerDiagnostics = validation.diagnostics

    const capabilityMap = new Map<string, CapabilityRecord>()
    for (const capability of capabilitySnapshot.active) {
      capabilityMap.set(capability.capabilityId, capability)
    }

    const availableFacets = deriveAvailableEnvelopeFacets(envelope)
    const nodes: FlexPlanNode[] = []
    const stageToNodeId = new Map<string, string>()

    plannerDraft.nodes.forEach((draftNode, index) => {
      const kind = coerceNodeKind(draftNode.kind)
      const capability = draftNode.capabilityId ? capabilityMap.get(draftNode.capabilityId) : undefined

      if (draftNode.capabilityId && !capability && kind === 'execution') {
        throw new UnsupportedObjectiveError(
          `Planner referenced capability "${draftNode.capabilityId}" which is not active or registered.`
        )
      }

      const facets = this.resolveNodeFacets(capability, draftNode, kind)

      let missingFacets: string[] = []
      if (capability) {
        missingFacets = this.findMissingFacets(facets.input, availableFacets)
        if (missingFacets.length) {
          try {
            getLogger().warn('flex_planner_missing_facets', {
              node: safeCapabilityLabel(capability, draftNode.label),
              missingFacets
            })
          } catch {}
        }
      }

      const compiledContracts = this.compileFacetContracts(facets)
      const outputContract = this.resolveOutputContract(kind, capability, facets, envelope.outputContract, compiledContracts.output)
      const nodeId = sanitizeNodeId(draftNode.capabilityId ?? draftNode.stage ?? draftNode.label ?? 'node', index)
      if (draftNode.stage) {
        stageToNodeId.set(normalizeStageKey(draftNode.stage), nodeId)
      }
      const derivedFlag = Boolean(draftNode.derived)
      const nodeLabel = draftNode.label ?? capability?.displayName ?? 'Planner node'
      const status = normalizeDraftStatus(draftNode.status)

      const executor = this.buildExecutor(capability)

      let routingConfig: ConditionalRoutingNode | null = null
      if (kind === 'routing') {
        if (!draftNode.routing) {
          throw new UnsupportedObjectiveError(`Routing node "${draftNode.stage}" is missing routing configuration.`)
        }
        try {
          routingConfig = compileConditionalRoutingNode(draftNode.routing)
        } catch (error) {
          throw new UnsupportedObjectiveError(
            `Routing node "${draftNode.stage}" has invalid routing configuration: ${
              error instanceof Error ? error.message : String(error)
            }`
          )
        }
      }

      const bundle = this.buildContextBundle({
        runId,
        envelope: envelopeForPlanner,
        kind,
        draftNode,
        capability,
        facets,
        outputContract,
        compiledContracts,
        derived: derivedFlag,
        variantCount,
        executor
      })

      const metadata: Record<string, unknown> = {
        derived: derivedFlag,
        plannerDerived: draftNode.derived ?? undefined,
        plannerStage: draftNode.stage ?? undefined,
        plannerInstructions: draftNode.instructions ?? undefined,
        facetInputSchema: compiledContracts.input ? safeJsonClone(compiledContracts.input.schema) : undefined,
        facetOutputSchema: compiledContracts.output ? safeJsonClone(compiledContracts.output.schema) : undefined,
        missingFacets: missingFacets.length ? missingFacets : undefined
      }

      if (executor) {
        metadata.executorType = executor.type
        if (executor.assignment?.defaults) {
          metadata.assignmentRole = executor.assignment.defaults.role
          metadata.assignmentDefaults = executor.assignment.defaults
        }
      }

      const node: FlexPlanNode = {
        id: nodeId,
        status,
        kind,
        capabilityId: kind === 'routing' ? null : capability?.capabilityId ?? null,
        capabilityLabel: kind === 'routing' ? nodeLabel : safeCapabilityLabel(capability, draftNode.label),
        capabilityVersion: capability?.version,
        derivedCapability: derivedFlag && capability ? { fromCapabilityId: capability.capabilityId } : undefined,
        label: nodeLabel,
        bundle,
        contracts: {
          input: compiledContracts.input,
          output: outputContract
        },
        facets,
        provenance: {
          input: compiledContracts.inputProvenance,
          output: compiledContracts.outputProvenance
        },
        rationale: draftNode.rationale ?? [],
        executor,
        routing: routingConfig,
        metadata
      }

      nodes.push(node)
      facets.output.forEach((facet) => availableFacets.add(facet))
    })

    this.resolveRoutingTargets(nodes, stageToNodeId)

    this.ensureNormalizationNode(nodes, envelope, variantCount)

    const edges = this.buildEdges(nodes)
    const derivedNodes = nodes.filter((node) => node.derivedCapability)

    const planVersion = this.computePlanVersion()
    const crcsSummary = {
      totalRows: crcs.totalRows,
      mrcsSize: crcs.mrcsSize,
      reasonCounts: crcs.reasonCounts,
      rowCap: crcs.rowCap,
      missingPinnedCapabilities: crcs.missingPinnedCapabilityIds.length,
      rows: crcs.rows.map((row) => ({
        capabilityId: row.capabilityId,
        displayName: row.displayName,
        kind: row.kind,
        inputFacets: row.inputFacets,
        outputFacets: row.outputFacets,
        postConditions: row.postConditions,
        reasonCodes: row.reasonCodes,
        source: row.source
      }))
    }

    return {
      runId,
      version: planVersion,
      createdAt: this.now().toISOString(),
      nodes,
      edges,
      metadata: {
        variantCount,
        capabilitySnapshotSize: capabilitySnapshot.active.length,
        derivedCapabilityCount: derivedNodes.length,
        derivedCapabilities: derivedNodes.map((node) => ({
          nodeId: node.id,
          capabilityId: node.capabilityId
        })),
        plannerRuntime: plannerDraft.metadata?.provider ?? 'llm',
        plannerModel: plannerDraft.metadata?.model ?? null,
        plannerDraftNodeCount: plannerDraft.nodes.length,
        plannerContext: {
          specialInstructions:
            plannerContext.specialInstructions.length ? plannerContext.specialInstructions : undefined,
          plannerDirectives:
            Object.keys(plannerContext.plannerDirectives).length ? plannerContext.plannerDirectives : undefined
        },
        policySummary: {
          hasPlanner: Boolean(canonicalPolicies.planner),
          runtimeCount: canonicalPolicies.runtime.length
        },
        legacyPolicyNotes: policyMetadata.legacyNotes.length ? policyMetadata.legacyNotes : undefined,
        legacyPolicyFields: policyMetadata.legacyFields.length ? policyMetadata.legacyFields : undefined,
        plannerDiagnostics: plannerDiagnostics.length ? plannerDiagnostics : undefined,
        planVersionTag: `v${planVersion}.0`,
        normalizationInjected: nodes.some((node) => node.kind === 'transformation'),
        emittedAt: this.now().toISOString(),
        crcs: crcsSummary
      }
    }
  }

  private resolveNodeFacets(
    capability: CapabilityRecord | undefined,
    draftNode: PlannerDraftNode,
    kind: FlexPlanNodeKind
  ): FlexPlanNodeFacets {
    if (!capability) {
      const inputNames = Array.isArray(draftNode.inputFacets) ? draftNode.inputFacets : []
      const outputNames = Array.isArray(draftNode.outputFacets) ? draftNode.outputFacets : []
      return {
        input: this.filterFacetsByDirection(unique(inputNames), 'input'),
        output: this.filterFacetsByDirection(unique(outputNames), 'output')
      }
    }

    const capabilityInput = extractFacetUnion(capability, 'input')
    const capabilityOutput = extractFacetUnion(capability, 'output')
    const draftInput = Array.isArray(draftNode.inputFacets) ? draftNode.inputFacets : []
    const draftOutput = Array.isArray(draftNode.outputFacets) ? draftNode.outputFacets : []

    const inputFacets = this.filterFacetsByDirection(unique([...capabilityInput, ...draftInput]), 'input')
    const outputFacets = this.filterFacetsByDirection(
      kind === 'fallback' ? unique(draftOutput) : unique([...capabilityOutput, ...draftOutput]),
      'output'
    )

    return { input: inputFacets, output: outputFacets }
  }

  private findMissingFacets(required: string[], available: Set<string>): string[] {
    return required.filter((facet) => !available.has(facet))
  }

  private compileFacetContracts(facets: FlexPlanNodeFacets): {
    input?: JsonSchemaContract
    output?: JsonSchemaContract
    inputProvenance?: FacetProvenance[]
    outputProvenance?: FacetProvenance[]
  } {
    const compiled = this.compiler.compileContracts({
      inputFacets: facets.input,
      outputFacets: facets.output
    })

    return {
      input: compiled.input ? toJsonSchemaContract(compiled.input) : undefined,
      output: compiled.output ? toJsonSchemaContract(compiled.output) : undefined,
      inputProvenance: compiled.input?.provenance,
      outputProvenance: compiled.output?.provenance
    }
  }

  private resolveOutputContract(
    kind: FlexPlanNodeKind,
    capability: CapabilityRecord | undefined,
    facets: FlexPlanNodeFacets,
    finalOutputContract: OutputContract,
    compiledOutput?: JsonSchemaContract
  ): OutputContract {
    if (kind === 'execution' || kind === 'validation') {
      if (capability?.outputContract) return capability.outputContract
      if (compiledOutput) return compiledOutput
    }

    if (kind === 'transformation') {
      return safeJsonClone(finalOutputContract)
    }

    return (
      compiledOutput ?? {
        mode: 'freeform',
        instructions: 'Produce output consistent with downstream expectations.'
      }
    )
  }

  private buildContextBundle(args: {
    runId: string
    envelope: TaskEnvelope
    kind: FlexPlanNodeKind
    draftNode: PlannerDraftNode
    capability: CapabilityRecord | undefined
    facets: FlexPlanNodeFacets
    outputContract: OutputContract
    compiledContracts: {
      input?: JsonSchemaContract
      output?: JsonSchemaContract
    }
    derived: boolean
    variantCount: number
    executor?: FlexPlanExecutor
  }): ContextBundle {
    const {
      runId,
      envelope,
      kind,
      draftNode,
      capability,
      facets,
      outputContract,
      derived,
      variantCount,
      executor
    } = args
    const inputs = safeJsonClone(envelope.inputs ?? {})
    const policies = safeJsonClone(envelope.policies ?? {})

    const instructions: string[] = []
    const taskLabel = draftNode.label ?? capability?.displayName ?? 'Planner node'
    instructions.push(`Task: ${taskLabel}.`)
    if (capability) {
      instructions.push(`Use capability: ${capability.displayName} (${capability.capabilityId}).`)
    } else {
      instructions.push('Virtual orchestration node (no direct capability invocation).')
    }
    if (derived) {
      instructions.push('This node operates in derived mode; apply stricter validation and logging.')
    }

    instructions.push(...composeFacetInstructions(facets.input, this.facetCatalog, 'Respect input facet'))
    instructions.push(...composeFacetInstructions(facets.output, this.facetCatalog, 'Emit facet'))

    const rationale = draftNode.rationale ?? []
    rationale.forEach((entry) => instructions.push(`Planner rationale: ${entry}`))

    const plannerInstructions = draftNode.instructions ?? []
    plannerInstructions.forEach((entry) => instructions.push(`Planner directive: ${entry}`))

    const contract: NodeContract = {
      output: outputContract,
      expectations: rationale.length ? rationale : undefined,
      maxAttempts: kind === 'execution' ? 2 : 1,
      fallback: kind === 'fallback' ? 'hitl' : 'retry'
    }

    const assignment =
      executor?.type === 'human'
        ? ({
            runId,
            nodeId: '',
            status: 'awaiting_submission',
            defaults: executor.assignment?.defaults ?? undefined,
            instructions:
              executor.assignment?.instructions ??
              capability?.instructionTemplates?.app ??
              capability?.instructionTemplates?.summary ??
              undefined,
            notifyChannels: capability?.assignmentDefaults?.notifyChannels,
            priority: capability?.assignmentDefaults?.priority,
            timeoutSeconds: capability?.assignmentDefaults?.timeoutSeconds,
            maxNotifications: capability?.assignmentDefaults?.maxNotifications,
            role: capability?.assignmentDefaults?.role,
            assignedTo: capability?.assignmentDefaults?.assignedTo,
            metadata:
              executor.assignment?.metadata && Object.keys(executor.assignment.metadata).length
                ? executor.assignment.metadata
                : undefined
          } as AssignmentSnapshot)
        : undefined

    return {
      runId,
      nodeId: '',
      agentId: capability?.capabilityId,
      objective: envelope.objective,
      instructions,
      inputs: {
        ...inputs,
        plannerKind: kind,
        plannerVariantCount: variantCount,
        derivedCapability: derived
      },
      policies,
      priorOutputs: undefined,
      artifacts: undefined,
      contract,
      ...(assignment ? { assignment } : {})
    }
  }

  private buildExecutor(capability: CapabilityRecord | undefined): FlexPlanExecutor | undefined {
    if (!capability) return undefined
    const type: FlexPlanExecutor['type'] = capability.agentType === 'human' ? 'human' : 'ai'
    const defaults = capability.assignmentDefaults ? safeJsonClone(capability.assignmentDefaults) : null
    const assignmentMetadata =
      capability.metadata && typeof capability.metadata === 'object'
        ? (capability.metadata as Record<string, unknown>).assignmentPolicy ?? null
        : null
    const instructions =
      capability.instructionTemplates?.app ??
      capability.instructionTemplates?.summary ??
      capability.summary ??
      null
    return {
      type,
      capabilityId: capability.capabilityId,
      assignment:
        type === 'human'
          ? ({
              defaults,
              instructions,
              metadata: assignmentMetadata
                ? (safeJsonClone(assignmentMetadata) as Record<string, unknown>)
                : null
            } as FlexPlanExecutor['assignment'])
          : undefined
    }
  }

  private ensureNormalizationNode(nodes: FlexPlanNode[], envelope: TaskEnvelope, variantCount: number) {
    if (envelope.outputContract.mode !== 'json_schema') return
    if (nodes.some((node) => node.kind === 'transformation')) return

    const lastExecutionIndex = [...nodes].reverse().findIndex((node) => node.kind === 'execution')
    if (lastExecutionIndex === -1) return

    const lastExecutionNode = nodes[nodes.length - 1 - lastExecutionIndex]
    const lastOutputContract = lastExecutionNode.contracts?.output
    const compiledFromFacets = this.compiler.compileContracts({
      outputFacets: lastExecutionNode.facets?.output ?? []
    }).output

    const executionSchema =
      lastOutputContract?.mode === 'json_schema'
        ? lastOutputContract.schema
        : compiledFromFacets?.schema

    const finalSchema =
      envelope.outputContract.mode === 'json_schema'
        ? envelope.outputContract.schema
        : undefined

    const schemaCompatible =
      Boolean(executionSchema && finalSchema) && this.isSchemaSubset(executionSchema, finalSchema)

    if (schemaCompatible) {
      return
    }

    const insertionIndex = nodes.length - 1 - lastExecutionIndex + 1
    const transformationId = sanitizeNodeId('transformation', nodes.length)
    const passthroughFacets = lastExecutionNode.facets?.output ?? []

    try {
      getLogger().debug('flex_normalization_injected', {
        runId: nodes[0]?.bundle.runId,
        reason: 'output_contract_mismatch',
        lastExecutionNode: lastExecutionNode.id,
        lastOutputMode: lastOutputContract?.mode,
        lastOutputSchema: executionSchema,
        finalSchema,
        schemaCompatible
      })
    } catch {}

    const bundle: ContextBundle = {
      runId: nodes[0]?.bundle.runId ?? '',
      nodeId: '',
      objective: nodes[0]?.bundle.objective ?? '',
      instructions: ['Normalize previous output to match caller JSON schema.'],
      inputs: {
        plannerKind: 'transformation',
        plannerVariantCount: variantCount
      },
      policies: {},
      contract: {
        output: safeJsonClone(envelope.outputContract),
        expectations: ['Ensure payload conforms to caller schema before downstream consumption.'],
        fallback: 'retry',
        maxAttempts: 1
      }
    }

    const node: FlexPlanNode = {
      id: transformationId,
      status: 'pending',
      kind: 'transformation',
      capabilityId: null,
      capabilityLabel: 'Contract Normalizer',
      label: 'Normalize output contract',
      bundle,
      contracts: {
        output: safeJsonClone(envelope.outputContract)
      },
      facets: {
        input: passthroughFacets,
        output: passthroughFacets
      },
      provenance: {},
      rationale: ['Ensure output matches caller contract.'],
      metadata: {
        normalization: true
      }
    }

    nodes.splice(insertionIndex, 0, node)
  }

  private isSchemaSubset(source: unknown, target: unknown): boolean {
    if (target == null) return true
    if (source == null) return false

    if (Array.isArray(target)) {
      if (!Array.isArray(source)) return false
      for (let i = 0; i < target.length; i += 1) {
        if (!this.isSchemaSubset(source[i], target[i])) return false
      }
      return true
    }

    if (typeof target !== 'object' || typeof source !== 'object') {
      return true
    }

    const sourceObj = source as Record<string, unknown>
    const targetObj = target as Record<string, unknown>

    if (typeof targetObj.type === 'string' && typeof sourceObj.type === 'string') {
      if (targetObj.type !== sourceObj.type) return false
    }

    if (Array.isArray(targetObj.required)) {
      const sourceRequired = Array.isArray(sourceObj.required)
        ? new Set(sourceObj.required as string[])
        : new Set<string>()
      for (const key of targetObj.required as string[]) {
        if (!sourceRequired.has(key)) return false
      }
    }

    if (targetObj.properties && typeof targetObj.properties === 'object') {
      const targetProps = targetObj.properties as Record<string, unknown>
      const sourceProps =
        sourceObj.properties && typeof sourceObj.properties === 'object'
          ? (sourceObj.properties as Record<string, unknown>)
          : {}
      for (const key of Object.keys(targetProps)) {
        if (!(key in sourceProps)) return false
        if (!this.isSchemaSubset(sourceProps[key], targetProps[key])) return false
      }
    }

    if (targetObj.items) {
      if (!sourceObj.items) return false
      if (!this.isSchemaSubset(sourceObj.items, targetObj.items)) return false
    }

    if (typeof targetObj.minItems === 'number') {
      const sourceMin = typeof sourceObj.minItems === 'number' ? (sourceObj.minItems as number) : undefined
      if (sourceMin !== undefined && sourceMin < (targetObj.minItems as number)) return false
    }

    if (typeof targetObj.maxItems === 'number') {
      const sourceMax = typeof sourceObj.maxItems === 'number' ? (sourceObj.maxItems as number) : undefined
      if (sourceMax !== undefined && sourceMax > (targetObj.maxItems as number)) return false
    }

    return true
  }

  private filterFacetsByDirection(names: string[], direction: 'input' | 'output'): string[] {
    const allowed = new Set<string>()
    names.forEach((name) => {
      const definition = this.facetCatalog.tryGet(name)
      if (!definition) return
      const declared = definition.metadata.direction
      if (declared === 'bidirectional' || declared === direction) {
        allowed.add(name)
      } else {
        try {
          getLogger().warn('flex_planner_dropped_facet', { name, direction, declared })
        } catch {}
      }
    })
    return Array.from(allowed)
  }

  private buildEdges(nodes: FlexPlanNode[]): FlexPlanEdge[] {
    const edges: FlexPlanEdge[] = []
    const seen = new Set<string>()

    const addEdge = (edge: FlexPlanEdge) => {
      const key = `${edge.from}->${edge.to}:${edge.reason ?? ''}`
      if (seen.has(key)) return
      seen.add(key)
      edges.push(edge)
    }

    for (let i = 0; i < nodes.length - 1; i += 1) {
      const source = nodes[i]
      const target = nodes[i + 1]
      if (source.kind === 'routing') continue
      addEdge({ from: source.id, to: target.id, reason: 'sequence' })
    }

    for (const node of nodes) {
      if (!node.routing) continue
      for (const route of node.routing.routes) {
        addEdge({ from: node.id, to: route.to, reason: route.label ?? 'routing' })
      }
      if (node.routing.elseTo) {
        addEdge({ from: node.id, to: node.routing.elseTo, reason: 'routing_else' })
      }
    }

    return edges
  }

  private computePlanVersion(): number {
    return 1
  }

  private resolveRoutingTargets(nodes: FlexPlanNode[], stageMap: Map<string, string>) {
    const nodeIds = new Set(nodes.map((node) => node.id))
    const resolveTarget = (value: string): string => {
      if (nodeIds.has(value)) return value
      const stageId = stageMap.get(normalizeStageKey(value))
      if (stageId && nodeIds.has(stageId)) {
        return stageId
      }
      throw new UnsupportedObjectiveError(`Routing target "${value}" does not match any planner node.`)
    }

    for (const node of nodes) {
      if (!node.routing) continue
      node.routing.routes = node.routing.routes.map((route) => ({
        ...route,
        to: resolveTarget(route.to)
      }))
      if (node.routing.elseTo) {
        node.routing.elseTo = resolveTarget(node.routing.elseTo)
      }
    }
  }

}

function derivePlannerContext(envelope: TaskEnvelope, policies: TaskPolicies, variantCount: number): PlannerContextHints {
  const directives = safeJsonClone(policies.planner?.directives ?? {}) as Record<string, unknown>
  return {
    objective: envelope.objective,
    variantCount,
    plannerDirectives: directives,
    specialInstructions: [...(envelope.specialInstructions ?? [])]
  }
}

function deriveAvailableEnvelopeFacets(envelope: TaskEnvelope): Set<string> {
  const facets = new Set<string>()
  if (envelope.outputContract?.mode === 'facets') {
    for (const facet of envelope.outputContract.facets ?? []) {
      facets.add(facet)
    }
  }
  return facets
}

function normalizeVariantCount(raw: unknown): number {
  const num = Number(raw)
  if (!Number.isFinite(num) || num < 1) return 1
  if (num > 6) return 6
  return Math.floor(num)
}

function toJsonSchemaContract(compiled: { schema: JsonSchemaContract['schema']; provenance: FacetProvenance[] }): JsonSchemaContract {
  return {
    mode: 'json_schema',
    schema: safeJsonClone(compiled.schema)
  }
}

function normalizeStageKey(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function safeCapabilityLabel(capability: CapabilityRecord | undefined, fallback?: string): string {
  if (capability) return capability.displayName || capability.capabilityId
  return fallback || 'Virtual node'
}

function composeFacetInstructions(facets: string[], catalog: FacetCatalog, prefix: string): string[] {
  const instructions: string[] = []
  facets.forEach((facetName) => {
    const definition = catalog.tryGet(facetName)
    if (!definition) return
    const instruction = definition.semantics?.instruction
    if (instruction) {
      instructions.push(`${prefix}: ${instruction}`)
    } else if (definition.description) {
      instructions.push(`${prefix}: ${definition.description}`)
    }
  })
  return instructions
}
