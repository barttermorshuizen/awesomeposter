import {
  FacetContractCompiler,
  type CompiledFacetContracts,
  type FacetContractCompilerOptions,
  type NodeContract
} from '@awesomeposter/shared'

export type FacetAwareNodeDraft = {
  nodeId: string
  capabilityId: string
  label: string
  contract: NodeContract
  inputFacets: string[]
  outputFacets: string[]
}

export type FacetAwareNodeWithContracts = FacetAwareNodeDraft & {
  compiled: CompiledFacetContracts
}

export type BuildFacetAwareNodeContractsOptions = FacetContractCompilerOptions & {
  compiler?: FacetContractCompiler
}

export function buildFacetAwareNodeContracts(
  draft: FacetAwareNodeDraft,
  options?: BuildFacetAwareNodeContractsOptions
): FacetAwareNodeWithContracts {
  const compiler = options?.compiler ?? new FacetContractCompiler(options)
  const compiled = compiler.compileContracts({
    inputFacets: draft.inputFacets,
    outputFacets: draft.outputFacets
  })

  return {
    ...draft,
    compiled
  }
}

export function buildFacetSystemInstruction(node: FacetAwareNodeWithContracts): string {
  const instructionSegments: string[] = []
  const inputFacets = node.compiled.input?.provenance ?? []
  const outputFacets = node.compiled.output?.provenance ?? []

  if (inputFacets.length) {
    instructionSegments.push(
      `Consume the following facets: ${inputFacets.map((facet) => facet.title).join(', ')}.`
    )
  }

  if (outputFacets.length) {
    instructionSegments.push(
      `Produce outputs satisfying: ${outputFacets.map((facet) => facet.title).join(', ')}.`
    )
  }

  return instructionSegments.join(' ')
}

export function validateFacetInputs(node: FacetAwareNodeWithContracts, payload: unknown) {
  return node.compiled.input?.validator(payload)
}

export function validateFacetOutputs(node: FacetAwareNodeWithContracts, payload: unknown) {
  return node.compiled.output?.validator(payload)
}
