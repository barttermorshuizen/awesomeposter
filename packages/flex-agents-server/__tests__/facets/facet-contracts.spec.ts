import { describe, expect, it } from 'vitest'

import { buildFacetFixtureNode } from '../../src/utils/__fixtures__/facet-node.fixture'
import { buildFacetSystemInstruction, validateFacetInputs, validateFacetOutputs } from '../../src/utils/facet-contracts'

describe('Facet contract planner helpers', () => {
  it('builds compiled facet contracts for mock node', () => {
    const node = buildFacetFixtureNode()
    expect(node.compiled.input?.schema.properties?.writerBrief).toBeDefined()
    expect(node.compiled.output?.schema.properties?.copyVariants).toBeDefined()
  })

  it('renders an instruction summary', () => {
    const node = buildFacetFixtureNode()
    const instruction = buildFacetSystemInstruction(node)
    expect(instruction).toContain('Consume the following facets')
    expect(instruction).toContain('Produce outputs satisfying')
  })

  it('validates payloads with provenance aware errors', () => {
    const node = buildFacetFixtureNode()

    const invalidInput = validateFacetInputs(node, {
      writerBrief: { angle: 'Test', keyPoints: [] }
    })
    expect(invalidInput?.valid).toBe(false)
    expect(invalidInput?.errors?.[0]?.facet).toBe('writerBrief')

    const invalidOutput = validateFacetOutputs(node, {
      copyVariants: {
        variants: [
          {
            headline: 'Valid headline'
          }
        ]
      }
    })
    expect(invalidOutput?.valid).toBe(false)
    expect(invalidOutput?.errors?.[0]?.facet).toBe('copyVariants')
  })
})
