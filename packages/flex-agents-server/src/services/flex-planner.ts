import type {
  CapabilityRecord,
  ContextBundle,
  JsonSchemaContract,
  NodeContract,
  OutputContract,
  TaskEnvelope
} from '@awesomeposter/shared'
import {
  FacetContractCompiler,
  type FacetCatalog,
  type FacetProvenance,
  getFacetCatalog
} from '@awesomeposter/shared'
import { getFlexCapabilityRegistryService, type FlexCapabilityRegistryService } from './flex-capability-registry'
import { getLogger } from './logger'
import { PlannerService, type PlannerServiceInterface, type PlannerDraft, type PlannerDraftNode } from './planner-service'

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

export class UnsupportedObjectiveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedObjectiveError'
  }
}

type ScenarioId = 'linkedin_post_variants' | 'blog_post' | 'generic_copy'

type ScenarioDefinition = {
  id: ScenarioId
  description: string
  matches: (input: { objective: string; channel: string; tags: string[] }) => boolean
}

type FlexPlannerDependencies = {
  capabilityRegistry?: FlexCapabilityRegistryService
  plannerService?: PlannerServiceInterface
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

const SCENARIO_DEFINITIONS: ScenarioDefinition[] = [
  {
    id: 'linkedin_post_variants',
    description: 'LinkedIn short-form content with variants and platform optimisation.',
    matches: ({ channel, objective }) =>
      channel.includes('linkedin') ||
      (objective.includes('linkedin') && (objective.includes('variant') || objective.includes('post')))
  },
  {
    id: 'blog_post',
    description: 'Long-form article or blog post content.',
    matches: ({ channel, objective, tags }) =>
      channel.includes('blog') ||
      channel.includes('article') ||
      objective.includes('blog') ||
      objective.includes('long form') ||
      tags.includes('long_form')
  },
  {
    id: 'generic_copy',
    description: 'Fallback scenario when no specialised planner template matches.',
    matches: () => true
  }
]

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

export class FlexPlanner {
  private readonly now: () => Date
  private readonly capabilityRegistry: FlexCapabilityRegistryService
  private readonly plannerService: PlannerServiceInterface
  private readonly facetCatalog: FacetCatalog
  private readonly compiler: FacetContractCompiler

  constructor(deps: FlexPlannerDependencies = {}, options?: PlannerOptions) {
    this.capabilityRegistry = deps.capabilityRegistry ?? getFlexCapabilityRegistryService()
    this.plannerService = deps.plannerService ?? new PlannerService()
    this.now = options?.now ?? (() => new Date())
    this.facetCatalog = getFacetCatalog()
    this.compiler = new FacetContractCompiler({ catalog: this.facetCatalog })
  }

  async buildPlan(runId: string, envelope: TaskEnvelope): Promise<FlexPlan> {
    const scenarioInfo = deriveScenario(envelope)
    const variantCount = normalizeVariantCount(
      (envelope.inputs as Record<string, unknown> | undefined)?.variantCount ??
        (envelope.policies as Record<string, unknown> | undefined)?.variantCount ??
        1
    )

    const capabilitySnapshot = await this.capabilityRegistry.getSnapshot()
    const plannerDraft = await this.plannerService.proposePlan({
      envelope,
      scenario: scenarioInfo.id,
      variantCount,
      capabilities: capabilitySnapshot.active
    })

    const capabilityMap = new Map<string, CapabilityRecord>()
    for (const capability of capabilitySnapshot.active) {
      capabilityMap.set(capability.capabilityId, capability)
    }

    const availableFacets = this.collectEnvelopeFacets(envelope)
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
      const derivedFlag = Boolean(draftNode.derived || (capability ? this.isDerivedCapability(capability) : false))
      const nodeLabel = draftNode.label ?? capability?.displayName ?? 'Planner node'

      const bundle = this.buildContextBundle({
        runId,
        envelope,
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
          capabilityScore: capability ? this.computeCapabilityScore(capability, scenarioInfo.id) : undefined,
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
        scenario: scenarioInfo.id,
        scenarioDescription: scenarioInfo.descriptor.description,
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
        planVersionTag: `v${planVersion}.0`,
        normalizationInjected: nodes.some((node) => node.kind === 'transformation'),
        emittedAt: this.now().toISOString()
      }
    }
  }

  private collectEnvelopeFacets(envelope: TaskEnvelope): Set<string> {
    const facets = new Set<string>()
    const inputs = (envelope.inputs ?? {}) as Record<string, unknown>
    const policies = (envelope.policies ?? {}) as Record<string, unknown>

    facets.add('objectiveBrief')

    if (inputs.toneOfVoice || policies.toneOfVoice || policies.brandVoice) {
      facets.add('toneOfVoice')
    }
    if (inputs.writerBrief || (inputs as Record<string, unknown>).brief || (inputs as Record<string, unknown>).planBrief) {
      facets.add('writerBrief')
    }
    if (inputs.planKnobs) {
      facets.add('planKnobs')
    }
    if (inputs.audienceProfile || inputs.audience || policies.audienceProfile) {
      facets.add('audienceProfile')
    }
    if (inputs.qaRubric || policies.qaRubric) {
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
      if (definition.name in inputs || definition.name in policies) {
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

    const insertionIndex = nodes.length - 1 - lastExecutionIndex + 1
    const transformationId = sanitizeNodeId('transformation', nodes.length)

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
        input: ['copyVariants'],
        output: ['copyVariants']
      },
      provenance: {},
      rationale: ['Ensure output matches caller contract.'],
      metadata: {
        normalization: true
      }
    }

    nodes.splice(insertionIndex, 0, node)
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

  private computeCapabilityScore(capability: CapabilityRecord, scenario: ScenarioId): number {
    const scenarios = extractCapabilityScenarios(capability)
    return scenarios.includes(scenario) ? 100 : scenarios.length ? 60 : 20
  }

  private isDerivedCapability(capability: CapabilityRecord): boolean {
    const scenarios = extractCapabilityScenarios(capability)
    return scenarios.length === 0
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

function deriveScenario(envelope: TaskEnvelope): { id: ScenarioId; descriptor: ScenarioDefinition } {
  const objective = (envelope.objective || '').toLowerCase()
  const inputs = (envelope.inputs ?? {}) as Record<string, unknown>
  const channel = String(inputs.channel ?? inputs.platform ?? '').toLowerCase()
  const tags = Array.isArray(inputs.tags) ? (inputs.tags as unknown[]) : []
  const normalizedTags = tags.map((tag) => String(tag || '').toLowerCase())

  for (const descriptor of SCENARIO_DEFINITIONS) {
    if (descriptor.matches({ objective, channel, tags: normalizedTags })) {
      return { id: descriptor.id, descriptor }
    }
  }
  return { id: 'generic_copy', descriptor: SCENARIO_DEFINITIONS.find((entry) => entry.id === 'generic_copy')! }
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

function extractCapabilityScenarios(capability: CapabilityRecord): string[] {
  const metadata = (capability.metadata ?? {}) as Record<string, unknown>
  const scenarios = Array.isArray(metadata.scenarios) ? metadata.scenarios : []
  return scenarios.map((value) => String(value || '').toLowerCase()).filter(Boolean)
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
