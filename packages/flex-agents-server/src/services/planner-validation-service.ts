import type { CapabilityRecord, TaskEnvelope } from '@awesomeposter/shared'
import { FacetContractCompiler, FacetContractError, getFacetCatalog } from '@awesomeposter/shared'
import type { PlannerDraft, PlannerDiagnostics } from '../planner/planner-types'

type PlannerValidationInput = {
  draft: PlannerDraft
  capabilities: CapabilityRecord[]
  envelope: TaskEnvelope
}

type PlannerValidationResult =
  | { ok: true; diagnostics: PlannerDiagnostics }
  | { ok: false; diagnostics: PlannerDiagnostics }

const OPTIONAL_NODE_KINDS = new Set(['branch', 'fallback', 'routing'])

export class PlannerValidationService {
  private readonly compiler: FacetContractCompiler

  constructor(compiler = new FacetContractCompiler({ catalog: getFacetCatalog() })) {
    this.compiler = compiler
  }

  validate(input: PlannerValidationInput): PlannerValidationResult {
    const diagnostics: PlannerDiagnostics = []
    const capabilityMap = new Map(input.capabilities.map((capability) => [capability.capabilityId, capability]))
    const catalog = getFacetCatalog()
    const outputCoverage = new Set<string>()

    input.draft.nodes.forEach((node, index) => {
      const stage = node.stage ?? `stage_${index + 1}`
      const capabilityId = node.capabilityId ?? null
      const requiredCapability = !OPTIONAL_NODE_KINDS.has((node.kind ?? 'execution').toLowerCase())

      if (capabilityId) {
        const capability = capabilityMap.get(capabilityId)
        if (!capability) {
          diagnostics.push({
            code: 'CAPABILITY_NOT_REGISTERED',
            message: `Planner referenced capability "${capabilityId}" which is not active.`,
            severity: 'error',
            capabilityId,
            nodeStage: stage
          })
        } else if (capability.status !== 'active') {
          diagnostics.push({
            code: 'CAPABILITY_INACTIVE',
            message: `Capability "${capabilityId}" is not active and cannot be used in plans.`,
            severity: 'error',
            capabilityId,
            nodeStage: stage
          })
        }
      } else if (requiredCapability) {
        diagnostics.push({
          code: 'CAPABILITY_MISSING',
          message: `Planner node "${stage}" must declare a capabilityId.`,
          severity: 'error',
          nodeStage: stage
        })
      }

      const inputFacets = node.inputFacets ?? []
      const outputFacets = node.outputFacets ?? []

      for (const facet of [...inputFacets, ...outputFacets]) {
        if (!catalog.tryGet(facet)) {
          diagnostics.push({
            code: 'UNKNOWN_FACET',
            message: `Facet "${facet}" referenced by planner node "${stage}" is not defined in the catalog.`,
            severity: 'error',
            nodeStage: stage,
            facet
          })
        }
      }

      try {
        this.compiler.compileContracts({ inputFacets, outputFacets })
      } catch (error) {
        if (error instanceof FacetContractError) {
          diagnostics.push({
            code: `FACET_CONTRACT_${error.code}`,
            message: error.message,
            severity: 'error',
            nodeStage: stage,
            facet: typeof error.detail?.facet === 'string' ? (error.detail.facet as string) : undefined
          })
        } else {
          diagnostics.push({
            code: 'FACET_CONTRACT_ERROR',
            message: (error as Error).message,
            severity: 'error',
            nodeStage: stage
          })
        }
      }

      outputFacets.forEach((facet) => outputCoverage.add(facet))
    })

    if (input.envelope.outputContract?.mode === 'facets') {
      const requiredFacets = input.envelope.outputContract.facets ?? []
      requiredFacets.forEach((facet) => {
        if (!outputCoverage.has(facet)) {
          diagnostics.push({
            code: 'OUTPUT_FACET_UNCOVERED',
            message: `Planner draft did not produce required output facet "${facet}".`,
            severity: 'error',
            facet
          })
        }
      })
    }

    const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === 'error')
    return hasErrors ? { ok: false, diagnostics } : { ok: true, diagnostics }
  }
}
