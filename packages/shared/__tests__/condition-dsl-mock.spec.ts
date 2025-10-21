import { describe, expect, it } from 'vitest'
import {
  evaluateMockCondition,
  transpileMockConditionDsl,
  type MockConditionCatalog,
} from '../src/condition-dsl/mockTranspiler.js'

const catalog: MockConditionCatalog = {
  variables: [
    { id: 'qaFindings.overallScore', path: 'qaFindings.overallScore', type: 'number' },
    { id: 'qaFindings.flagsCount', path: 'qaFindings.flagsCount', type: 'number' },
    { id: 'brief.language', path: 'brief.language', type: 'string' },
  ],
}

describe('transpileMockConditionDsl', () => {
  it('transpiles boolean expressions with comparisons into JSON-Logic', () => {
    const result = transpileMockConditionDsl(
      'qaFindings.overallScore < 0.6 && qaFindings.flagsCount > 2',
      catalog,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toHaveLength(0)
    expect(result.variables).toEqual([
      'qaFindings.overallScore',
      'qaFindings.flagsCount',
    ])
    expect(result.jsonLogic).toEqual({
      and: [
        { '<': [{ var: 'qaFindings.overallScore' }, 0.6] },
        { '>': [{ var: 'qaFindings.flagsCount' }, 2] },
      ],
    })
  })

  it('returns warnings for unknown variables', () => {
    const result = transpileMockConditionDsl('unknownVar > 1', catalog)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('unknownVar')
  })

  it('surfaces parse errors with position metadata', () => {
    const result = transpileMockConditionDsl('qaFindings.overallScore <', catalog)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message.toLowerCase()).toContain('unexpected')
    expect(typeof result.error.position === 'number').toBe(true)
  })
})

describe('evaluateMockCondition', () => {
  it('evaluates generated JSON-Logic against sample payloads', () => {
    const transpiled = transpileMockConditionDsl(
      'qaFindings.overallScore < 0.6 && qaFindings.flagsCount > 2',
      catalog,
    )
    if (!transpiled.ok) {
      throw new Error('Expected transpilation to succeed')
    }

    const payload = {
      qaFindings: {
        overallScore: 0.51,
        flagsCount: 4,
      },
    }

    const evaluation = evaluateMockCondition(transpiled.jsonLogic, payload)
    expect(evaluation.ok).toBe(true)
    if (!evaluation.ok) return
    expect(evaluation.result).toBe(true)
    expect(evaluation.resolvedVariables).toMatchObject({
      'qaFindings.overallScore': 0.51,
      'qaFindings.flagsCount': 4,
    })
  })
})
