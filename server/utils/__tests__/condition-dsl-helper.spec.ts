import { describe, expect, it } from 'vitest'
import { H3Error } from 'h3'

import { conditionVariableCatalog } from '@awesomeposter/shared'

import { validateConditionInput } from '../condition-dsl'

describe('validateConditionInput', () => {
  it('parses DSL input and returns canonical data', () => {
    const dsl =
      'facets.planKnobs.hookIntensity < 0.6 && facets.planKnobs.variantCount > 2'
    const result = validateConditionInput({ dsl })

    expect(result.jsonLogic).toMatchObject({
      and: [
        {
          '<': [
            { var: 'metadata.runContextSnapshot.facets.planKnobs.value.hookIntensity' },
            0.6,
          ],
        },
        {
          '>': [
            { var: 'metadata.runContextSnapshot.facets.planKnobs.value.variantCount' },
            2,
          ],
        },
      ],
    })
    expect(result.canonicalDsl).toBe(dsl)
    expect(result.warnings).toHaveLength(0)
    expect(result.variables).toEqual([
      'metadata.runContextSnapshot.facets.planKnobs.value.hookIntensity',
      'metadata.runContextSnapshot.facets.planKnobs.value.variantCount',
    ])
  })

  it('throws HTTP errors when DSL is invalid', () => {
    expect(() =>
      validateConditionInput({ dsl: 'unknownVar > 1' }, { catalog: conditionVariableCatalog }),
    ).toThrowError(H3Error)

    try {
      validateConditionInput({ dsl: 'unknownVar > 1' })
    } catch (error) {
      expect(error).toBeInstanceOf(H3Error)
      const h3 = error as H3Error & { data?: Record<string, unknown> }
      expect(h3.statusCode).toBe(400)
      expect(h3.data).toMatchObject({
        code: 'invalid_condition_dsl',
      })
    }
  })

  it('accepts JSON-Logic payloads unchanged', () => {
    const jsonLogic = {
      and: [
        {
          '<': [
            { var: 'metadata.runContextSnapshot.facets.planKnobs.value.variantCount' },
            5,
          ],
        },
      ],
    }
    const result = validateConditionInput({ jsonLogic })

    expect(result.jsonLogic).toBe(jsonLogic)
    expect(result.canonicalDsl).toBeNull()
    expect(result.warnings).toHaveLength(0)
    expect(result.variables).toHaveLength(0)
  })
})
