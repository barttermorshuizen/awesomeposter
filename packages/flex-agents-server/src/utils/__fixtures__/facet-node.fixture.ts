import { JsonSchemaContractSchema, type NodeContract } from '@awesomeposter/shared'
import { buildFacetAwareNodeContracts, type FacetAwareNodeWithContracts } from '../facet-contracts'

const baseContract: NodeContract = {
  description: 'Mock node contract for planner fixture.',
  output: JsonSchemaContractSchema.parse({
    mode: 'json_schema',
    schema: {
      type: 'object'
    }
  }),
  expectations: ['Fixture node used for planner integration tests.']
}

export function buildFacetFixtureNode(): FacetAwareNodeWithContracts {
  return buildFacetAwareNodeContracts({
    nodeId: 'mock.writer',
    capabilityId: 'ContentGeneratorAgent.linkedinVariants',
    label: 'Generate copy variants',
    contract: baseContract,
    inputFacets: ['writerBrief', 'toneOfVoice'],
    outputFacets: ['copyVariants']
  })
}
