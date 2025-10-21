import { describe, expect, it } from 'vitest'
import { H3Error } from 'h3'

import { conditionVariableCatalog } from '@awesomeposter/shared'

import { validateConditionInput } from '../condition-dsl'

describe('validateConditionInput', () => {
  it('parses DSL input and returns canonical data', () => {
    const result = validateConditionInput({
      dsl: 'qaFindings.overallScore < 0.6 && qaFindings.flagsCount > 2',
    })

    expect(result.jsonLogic).toMatchObject({
      and: [
        { '<': [{ var: 'qaFindings.overallScore' }, 0.6] },
        { '>': [{ var: 'qaFindings.flagsCount' }, 2] },
      ],
    })
    expect(result.canonicalDsl).toBe('qaFindings.overallScore < 0.6 && qaFindings.flagsCount > 2')
    expect(result.warnings).toHaveLength(0)
    expect(result.variables).toEqual([
      'qaFindings.overallScore',
      'qaFindings.flagsCount',
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
    const jsonLogic = { and: [{ '<': [{ var: 'qaFindings.flagsCount' }, 5] }] }
    const result = validateConditionInput({ jsonLogic })

    expect(result.jsonLogic).toBe(jsonLogic)
    expect(result.canonicalDsl).toBeNull()
    expect(result.warnings).toHaveLength(0)
    expect(result.variables).toHaveLength(0)
  })
})
