import type {
  CapabilityRecord,
  ContextBundle,
  JsonSchemaContract,
  NodeContract,
  OutputContract,
  TaskEnvelope,
  TaskPolicies
} from '@awesomeposter/shared'
import {
  FacetContractCompiler,
  type FacetCatalog,
  type FacetProvenance,
  getFacetCatalog,
  parseTaskPolicies
} from '@awesomeposter/shared'
import { getFlexCapabilityRegistryService, type FlexCapabilityRegistryService } from './flex-capability-registry'
import { getLogger } from './logger'
import {
  PlannerService,
  type PlannerServiceInterface,
  type PlannerGraphContext,
  type PlannerContextHints
} from './planner-service'
import type { FacetSnapshot } from './run-context'
import type { PlannerDraft, PlannerDraftNode, PlannerDiagnostics } from '../planner/planner-types'
import { PlannerValidationService } from './planner-validation-service'

export type FlexPlanNodeKind =
  | 'structuring'
  | 'branch'
  | 'execution'
  | 'transformation'
  | 'validation'
  | 'fallback'

export type FlexPlanEdge = {
  from: string
  to: string
  reason?: string
}

export type FlexPlanNodeContracts = {
  input?: JsonSchemaContract
  output: OutputContract
}

export type FlexPlanNodeFacets = {
  input: string[]
  output: string[]
}

export type FlexPlanNodeProvenance = {
  input?: FacetProvenance[]
  output?: FacetProvenance[]
}

export type FlexPlanNode = {
  id: string
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
  facets?: FacetSnapshot
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

type FlexPlannerDependencies = {
  capabilityRegistry?: FlexCapabilityRegistryService
  plannerService?: PlannerServiceInterface
  validationService?: PlannerValidationService
}

type PlannerOptions = {
  now?: () => Date
}

type BranchRequest = {
  id: string
  label: string
  rationale?: string
  source: 'planner' | 'envelope'
}

type PlannerContextInternal = PlannerContextHints & {
  normalizedFormats: string[]
  normalizedLanguages: string[]
  normalizedAudiences: string[]
  normalizedTags: string[]
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
      return kind
    default:
      return 'execution'
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
    const completedSet = new Set(state.completedNodeIds)
    if (!plan.nodes.length || !completedSet.size) return undefined

    const completedNodes: PlannerGraphContext['completedNodes'] = []
    const facetValues: PlannerGraphContext['facetValues'] = []

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

    if (state.facets) {
      const entries = Object.entries(state.facets)
      const recent = entries.slice(-12)
      recent.forEach(([facet, entry]) => {
        const provenance = entry.provenance.at(-1)
        facetValues.push({
          facet,
          sourceNodeId: provenance?.nodeId ?? 'unknown',
          sourceCapabilityId: provenance?.capabilityId ?? null,
          sourceLabel: provenance?.nodeId ?? 'Facet update',
          value: entry.value
        })
      })
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

    if (!completedNodes.length && !facetValues.length) return undefined

    return {
      completedNodes,
      facetValues
    }
  }

  async buildPlan(runId: string, envelope: TaskEnvelope, options?: BuildPlanOptions): Promise<FlexPlan> {
    const capabilitySnapshot = await this.capabilityRegistry.getSnapshot()
    const canonicalPolicies = options?.policies ?? parseTaskPolicies(envelope.policies ?? {})
    const variantCount = normalizeVariantCount(
      (envelope.inputs as Record<string, unknown> | undefined)?.variantCount ??
        canonicalPolicies.planner?.topology?.variantCount ??
        1
    )
    const policyMetadata = options?.policyMetadata ?? { legacyNotes: [], legacyFields: [] }
    const envelopeForPlanner: TaskEnvelope = {
      ...envelope,
      policies: canonicalPolicies
    }
    const plannerContextInternal = derivePlannerContext(envelopeForPlanner, canonicalPolicies, variantCount)
    const plannerContextHints = toPlannerContextHints(plannerContextInternal)
    await options?.onRequest?.({
      runId,
      variantCount,
      context: plannerContextHints,
      policies: canonicalPolicies,
      policyMetadata,
      capabilities: capabilitySnapshot.active
    })
    const graphContext = this.summarizeGraphState(options?.graphState)
    const plannerDraft = await this.plannerService.proposePlan({
      envelope: envelopeForPlanner,
      context: plannerContextHints,
      capabilities: capabilitySnapshot.active,
      graphContext,
      policies: canonicalPolicies,
      policyMetadata
    })
    try {
      const draftPretty = JSON.stringify(plannerDraft, null, 2)
      getLogger().debug(`flex_planner_draft_received\n${draftPretty}`, {
        runId,
        variantCount,
        channel: plannerContextHints.channel,
        platform: plannerContextHints.platform,
        formats: plannerContextHints.formats
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

    const availableFacets = this.collectEnvelopeFacets(envelope, canonicalPolicies)
    const nodes: FlexPlanNode[] = []

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
      const compatibilityScore = capability ? this.computeCapabilityCompatibility(capability, plannerContextInternal) : undefined
      const derivedFlag = Boolean(
        draftNode.derived ??
          (capability ? this.isDerivedCapability(capability, plannerContextInternal, compatibilityScore) : false)
      )
      const nodeLabel = draftNode.label ?? capability?.displayName ?? 'Planner node'

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
        variantCount
      })

      const node: FlexPlanNode = {
        id: nodeId,
        kind,
        capabilityId: capability?.capabilityId ?? null,
        capabilityLabel: safeCapabilityLabel(capability, draftNode.label),
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
        metadata: {
          capabilityScore: compatibilityScore,
          derived: derivedFlag,
          plannerDerived: draftNode.derived ?? undefined,
          plannerStage: draftNode.stage ?? undefined,
          plannerInstructions: draftNode.instructions ?? undefined,
          facetInputSchema: compiledContracts.input ? safeJsonClone(compiledContracts.input.schema) : undefined,
          facetOutputSchema: compiledContracts.output ? safeJsonClone(compiledContracts.output.schema) : undefined,
          missingFacets: missingFacets.length ? missingFacets : undefined
        }
      }

      nodes.push(node)
      facets.output.forEach((facet) => availableFacets.add(facet))
    })

    const branchRequests = this.collectBranchRequests(plannerDraft, envelope)
    this.injectBranchNodes(nodes, branchRequests)
    this.ensureNormalizationNode(nodes, envelope, variantCount)
    this.ensureFallbackNode(nodes, variantCount)

    const edges = this.buildEdges(nodes)
    const derivedNodes = nodes.filter((node) => node.derivedCapability)

    const planVersion = this.computePlanVersion(nodes)

    return {
      runId,
      version: planVersion,
      createdAt: this.now().toISOString(),
      nodes,
      edges,
      metadata: {
        variantCount,
        branchCount: branchRequests.length || nodes.filter((node) => node.kind === 'branch').length,
        branchPolicySources: unique(branchRequests.map((request) => request.source)),
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
          channel: plannerContextHints.channel ?? null,
          platform: plannerContextHints.platform ?? null,
          formats: plannerContextHints.formats,
          languages: plannerContextHints.languages,
          audiences: plannerContextHints.audiences,
          tags: plannerContextHints.tags,
          specialInstructions: plannerContextHints.specialInstructions.length ? plannerContextHints.specialInstructions : undefined
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
        emittedAt: this.now().toISOString()
      }
    }
  }

  private collectEnvelopeFacets(envelope: TaskEnvelope, policies: TaskPolicies): Set<string> {
    const facets = new Set<string>()
    const inputs = (envelope.inputs ?? {}) as Record<string, unknown>
    const directives = policies.planner?.directives ?? {}
    const hasDirective = (key: string) => Boolean(directives && Object.prototype.hasOwnProperty.call(directives, key))

    facets.add('objectiveBrief')

    if (inputs.toneOfVoice || hasDirective('toneOfVoice') || hasDirective('brandVoice')) {
      facets.add('toneOfVoice')
    }
    if (inputs.writerBrief || (inputs as Record<string, unknown>).brief || (inputs as Record<string, unknown>).planBrief) {
      facets.add('writerBrief')
    }
    if (inputs.planKnobs) {
      facets.add('planKnobs')
    }
    if (inputs.audienceProfile || inputs.audience || hasDirective('audienceProfile')) {
      facets.add('audienceProfile')
    }
    if (inputs.qaRubric || hasDirective('qaRubric')) {
      facets.add('qaRubric')
    }
    if (Array.isArray(inputs.contextBundles)) {
      const hasCompanyProfile = inputs.contextBundles.some((entry: unknown) => {
        if (typeof entry !== 'object' || entry === null) return false
        const candidate = entry as Record<string, unknown>
        const typeValue = candidate.type
        return typeof typeValue === 'string' && typeValue === 'company_profile'
      })
      if (hasCompanyProfile) facets.add('assetBundle')
    }

    this.facetCatalog.list().forEach((definition) => {
      if (definition.name in inputs || hasDirective(definition.name)) {
        facets.add(definition.name)
      }
    })

    return facets
  }

  private collectBranchRequests(plannerDraft: PlannerDraft, envelope: TaskEnvelope): BranchRequest[] {
    const fromPlanner =
      plannerDraft.branchRequests?.map((entry, index) => ({
        id: entry.id ?? `planner_branch_${index + 1}`,
        label: entry.label,
        rationale: entry.rationale,
        source: 'planner' as const
      })) ?? []

    if (fromPlanner.length) {
      return fromPlanner
    }

    return collectEnvelopeBranchRequests(envelope)
  }

  private injectBranchNodes(nodes: FlexPlanNode[], requests: BranchRequest[]) {
    if (!requests.length) return
    const executionIndex = nodes.findIndex((node) => node.kind === 'execution')
    const insertIndex = executionIndex === -1 ? nodes.length : executionIndex

    requests.forEach((request, offset) => {
      const nodeId = sanitizeNodeId(request.id || 'branch', nodes.length + offset)
      const bundle: ContextBundle = {
        runId: nodes[0]?.bundle.runId ?? '',
        nodeId: '',
        objective: nodes[0]?.bundle.objective ?? '',
        instructions: [
          `Branch "${request.label}" requested prior to execution.`,
          request.rationale ? `Rationale: ${request.rationale}` : 'Planner recommends collecting additional variants.'
        ],
        inputs: {
          plannerKind: 'branch',
          branchSource: request.source
        },
        policies: {},
        contract: {
          output: {
            mode: 'freeform',
            instructions: 'Document branch-specific requirements to guide downstream nodes.'
          },
          fallback: 'retry',
          maxAttempts: 1
        }
      }

      const node: FlexPlanNode = {
        id: nodeId,
        kind: 'branch',
        capabilityId: null,
        capabilityLabel: `Branch (${request.label})`,
        capabilityVersion: undefined,
        label: `Inject branch: ${request.label}`,
        bundle,
        contracts: {
          output: bundle.contract.output
        },
        facets: {
          input: [],
          output: []
        },
        provenance: {},
        rationale: request.rationale ? [request.rationale] : [],
        metadata: {
          branchSource: request.source
        }
      }

      nodes.splice(insertIndex + offset, 0, node)
    })
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
  }): ContextBundle {
    const { runId, envelope, kind, draftNode, capability, facets, outputContract, derived, variantCount } = args
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
      contract
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

  private ensureFallbackNode(nodes: FlexPlanNode[], variantCount: number) {
    if (nodes.some((node) => node.kind === 'fallback')) return

    const fallbackId = sanitizeNodeId('fallback', nodes.length)
    const bundle: ContextBundle = {
      runId: nodes[0]?.bundle.runId ?? '',
      nodeId: '',
      objective: nodes[0]?.bundle.objective ?? '',
      instructions: ['Escalate to HITL operator with latest outputs and diagnostics.'],
      inputs: {
        plannerKind: 'fallback',
        plannerVariantCount: variantCount
      },
      policies: {},
      contract: {
        output: {
          mode: 'freeform',
          instructions: 'Document HITL escalation decision and context.'
        },
        fallback: 'hitl',
        maxAttempts: 1
      }
    }

    nodes.push({
      id: fallbackId,
      kind: 'fallback',
      capabilityId: null,
      capabilityLabel: 'HITL Fallback',
      label: 'HITL fallback path',
      bundle,
      contracts: {
        output: bundle.contract.output
      },
      facets: {
        input: ['copyVariants'],
        output: ['qaFindings']
      },
      provenance: {},
      rationale: ['Provide HITL escape hatch when automated paths fail.'],
      metadata: {}
    })
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
    for (let i = 0; i < nodes.length - 1; i += 1) {
      edges.push({ from: nodes[i].id, to: nodes[i + 1].id, reason: 'sequence' })
    }
    return edges
  }

  private computePlanVersion(nodes: FlexPlanNode[]): number {
    const branchWeight = nodes.filter((node) => node.kind === 'branch').length
    const derivedWeight = nodes.filter((node) => node.derivedCapability).length
    const transformationWeight = nodes.some((node) => node.kind === 'transformation') ? 1 : 0
    return 1 + branchWeight + derivedWeight + transformationWeight
  }

  private computeCapabilityCompatibility(capability: CapabilityRecord, context: PlannerContextInternal): number {
    const traits = capability.inputTraits ?? {}
    let score = 40

    const capabilityFormats = (traits.formats ?? []).map(normalizeHint)
    const capabilityLanguages = (traits.languages ?? []).map(normalizeHint)
    const capabilityStrengths = traits.strengths ?? []

    const formatMatches =
      capabilityFormats.length &&
      context.normalizedFormats.length &&
      capabilityFormats.some((format) =>
        context.normalizedFormats.some((hint) => format.includes(hint) || hint.includes(format))
      )
    if (formatMatches) score += 30

    const languageMatches =
      capabilityLanguages.length &&
      context.normalizedLanguages.length &&
      capabilityLanguages.some((language) =>
        context.normalizedLanguages.some((hint) => language === hint || language.includes(hint) || hint.includes(language))
      )
    if (languageMatches) score += 20

    if (context.variantCount > 1) {
      const variantStrength = capabilityStrengths.some((strength) => /variant|diversity|multi/i.test(strength))
      if (variantStrength) score += 10
    }

    const qaStrength = capabilityStrengths.some((strength) => /qa|quality|review|compliance/i.test(strength))
    if (
      qaStrength &&
      context.normalizedTags.some((tag) => ['qa', 'quality', 'compliance'].some((keyword) => tag.includes(keyword)))
    ) {
      score += 10
    }

    return Math.min(100, score)
  }

  private isDerivedCapability(
    capability: CapabilityRecord,
    context: PlannerContextInternal,
    precomputedScore?: number
  ): boolean {
    const score = precomputedScore ?? this.computeCapabilityCompatibility(capability, context)
    return score < 60
  }
}

function collectEnvelopeBranchRequests(envelope: TaskEnvelope): BranchRequest[] {
  const policies = (envelope.policies ?? {}) as Record<string, unknown>
  const constraints = (envelope.constraints ?? {}) as Record<string, unknown>

  const keys = ['branchVariants', 'variantStrategies', 'preExecutionBranches']

  for (const key of keys) {
    const fromPolicies = Array.isArray(policies[key]) ? (policies[key] as unknown[]) : []
    const fromConstraints = Array.isArray(constraints[key]) ? (constraints[key] as unknown[]) : []
    const merged = [...fromPolicies, ...fromConstraints]
    if (!merged.length) continue
    return merged
      .map((entry, index): BranchRequest | null => {
        if (typeof entry === 'string') {
          const branch: BranchRequest = {
            id: `${key}_${index + 1}`,
            label: entry.trim(),
            source: 'envelope'
          }
          return branch
        }
        if (entry && typeof entry === 'object') {
          const obj = entry as Record<string, unknown>
          const label = typeof obj.label === 'string' ? obj.label : typeof obj.name === 'string' ? obj.name : `branch_${index + 1}`
          const branch: BranchRequest = {
            id: typeof obj.id === 'string' ? obj.id : `${key}_${index + 1}`,
            label,
            rationale: typeof obj.rationale === 'string' ? obj.rationale : undefined,
            source: 'envelope'
          }
          return branch
        }
        return null
      })
      .filter((value): value is BranchRequest => value !== null)
  }

  return []
}

function derivePlannerContext(
  envelope: TaskEnvelope,
  policies: TaskPolicies,
  variantCount: number
): PlannerContextInternal {
  const inputs = (envelope.inputs ?? {}) as Record<string, unknown>
  const formats = new Set<string>()
  const normalizedFormats = new Set<string>()
  const languages = new Set<string>()
  const normalizedLanguages = new Set<string>()
  const audiences = new Set<string>()
  const normalizedAudiences = new Set<string>()
  const tags = new Set<string>()
  const normalizedTags = new Set<string>()

  const addFormat = (value: unknown) => addStringToSets(value, formats, normalizedFormats)
  const addLanguage = (value: unknown) => addStringToSets(value, languages, normalizedLanguages)
  const addAudience = (value: unknown) => addStringToSets(value, audiences, normalizedAudiences)
  const addTag = (value: unknown) => addStringToSets(value, tags, normalizedTags)

  const channel = firstString(inputs.channel ?? inputs.primaryChannel ?? inputs.destination)
  if (channel) addFormat(channel)

  const platform = firstString(inputs.platform ?? inputs.surface)
  if (platform) addFormat(platform)

  addFormat(inputs.format)
  addFormat(inputs.contentFormat)
  addFormat(inputs.medium)
  collectStringValues(inputs.formats).forEach(addFormat)

  const writerBrief = asRecord(inputs.writerBrief)
  if (writerBrief) {
    addFormat(writerBrief.channel)
    addFormat(writerBrief.platform)
    addFormat(writerBrief.format)
    collectStringValues(writerBrief.formats).forEach(addFormat)
    addLanguage(writerBrief.language)
    collectStringValues(writerBrief.languages).forEach(addLanguage)
    addAudience(writerBrief.persona)
    collectStringValues(writerBrief.audience).forEach(addAudience)
    const writerAudienceProfile = asRecord(writerBrief.audienceProfile)
    if (writerAudienceProfile) {
      addAudience(writerAudienceProfile.persona)
      addAudience(writerAudienceProfile.role)
      addAudience(writerAudienceProfile.segment)
      addAudience(writerAudienceProfile.industry)
      addAudience(writerAudienceProfile.jobTitle)
      addAudience(writerAudienceProfile.geo)
    }
    collectStringValues(writerBrief.tags).forEach(addTag)
  }

  addLanguage(inputs.language)
  collectStringValues(inputs.languages).forEach(addLanguage)

  const planKnobs = asRecord(inputs.planKnobs)
  if (planKnobs) {
    addLanguage(planKnobs.language)
    collectStringValues(planKnobs.languages).forEach(addLanguage)
    addFormat(planKnobs.format)
    collectStringValues(planKnobs.formats).forEach(addFormat)
  }

  const audienceProfile = asRecord(inputs.audienceProfile)
  if (audienceProfile) {
    addAudience(audienceProfile.persona)
    addAudience(audienceProfile.role)
    addAudience(audienceProfile.segment)
    addAudience(audienceProfile.industry)
    addAudience(audienceProfile.jobTitle)
    addAudience(audienceProfile.geo)
  }

  collectStringValues(inputs.audience).forEach(addAudience)
  collectStringValues(inputs.personas).forEach(addAudience)

  collectStringValues(inputs.tags).forEach(addTag)

  const plannerSelection = policies.planner?.selection
  if (plannerSelection) {
    collectStringValues(plannerSelection.require).forEach(addTag)
    collectStringValues(plannerSelection.prefer).forEach(addTag)
    collectStringValues(plannerSelection.avoid).forEach(addTag)
  }

  const directives = safeJsonClone(policies.planner?.directives ?? {}) as Record<string, unknown>
  Object.entries(directives).forEach(([key, value]) => {
    const normalizedKey = key.toLowerCase()
    if (normalizedKey.includes('format') || normalizedKey.includes('channel') || normalizedKey.includes('platform')) {
      collectStringValues(value).forEach(addFormat)
    }
    if (normalizedKey.includes('language')) {
      collectStringValues(value).forEach(addLanguage)
    }
    if (normalizedKey.includes('audience')) {
      collectStringValues(value).forEach(addAudience)
    }
    if (normalizedKey.includes('tag') || normalizedKey.includes('keyword')) {
      collectStringValues(value).forEach(addTag)
    }
  })

  return {
    objective: envelope.objective,
    channel: channel ?? undefined,
    platform: platform ?? undefined,
    formats: Array.from(formats),
    languages: Array.from(languages),
    audiences: Array.from(audiences),
    tags: Array.from(tags),
    variantCount,
    plannerDirectives: directives,
    specialInstructions: [...(envelope.specialInstructions ?? [])],
    normalizedFormats: Array.from(normalizedFormats),
    normalizedLanguages: Array.from(normalizedLanguages),
    normalizedAudiences: Array.from(normalizedAudiences),
    normalizedTags: Array.from(normalizedTags)
  }
}

function toPlannerContextHints(context: PlannerContextInternal): PlannerContextHints {
  const { normalizedFormats, normalizedLanguages, normalizedAudiences, normalizedTags, ...hints } = context
  return hints
}

function addStringToSets(value: unknown, displaySet: Set<string>, normalizedSet: Set<string>) {
  collectStringValues(value).forEach((entry) => {
    const trimmed = entry.trim()
    if (!trimmed) return
    displaySet.add(trimmed)
    normalizedSet.add(normalizeHint(trimmed))
  })
}

function collectStringValues(value: unknown): string[] {
  if (value == null) return []
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? [trimmed] : []
  }
  if (Array.isArray(value)) {
    const results: string[] = []
    value.forEach((entry) => {
      if (typeof entry === 'string') {
        const trimmed = entry.trim()
        if (trimmed) results.push(trimmed)
      } else if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>
        if (typeof record.label === 'string') {
          const trimmed = record.label.trim()
          if (trimmed) results.push(trimmed)
        } else if (typeof record.value === 'string') {
          const trimmed = record.value.trim()
          if (trimmed) results.push(trimmed)
        } else if (typeof record.name === 'string') {
          const trimmed = record.name.trim()
          if (trimmed) results.push(trimmed)
        } else if (typeof record.text === 'string') {
          const trimmed = record.text.trim()
          if (trimmed) results.push(trimmed)
        }
      }
    })
    return results
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.label === 'string') {
      const trimmed = record.label.trim()
      return trimmed ? [trimmed] : []
    }
    if (typeof record.value === 'string') {
      const trimmed = record.value.trim()
      return trimmed ? [trimmed] : []
    }
    if (typeof record.name === 'string') {
      const trimmed = record.name.trim()
      return trimmed ? [trimmed] : []
    }
    if (typeof record.text === 'string') {
      const trimmed = record.text.trim()
      return trimmed ? [trimmed] : []
    }
  }
  return []
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function firstString(value: unknown): string | null {
  const [first] = collectStringValues(value)
  return first ?? null
}

function normalizeHint(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')
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
