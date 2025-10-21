import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  conditionVariableCatalog,
  evaluateCondition,
  parseDsl,
  toDsl,
  type JsonLogicExpression,
} from '../src/condition-dsl/index.js'

const FIXTURES_DIR = path.resolve(process.cwd(), 'tests/fixtures/condition-dsl')

function loadFixture(name: string): { dsl: string; json: JsonLogicExpression } {
  const dslPath = path.join(FIXTURES_DIR, `${name}.dsl`)
  const jsonPath = path.join(FIXTURES_DIR, `${name}.json`)
  const dsl = readFileSync(dslPath, 'utf8').trim()
  const json = JSON.parse(readFileSync(jsonPath, 'utf8')) as JsonLogicExpression
  return { dsl, json }
}

describe('parseDsl', () => {
  it('parses DSL into JSON-Logic with canonical formatting', () => {
    const { dsl, json } = loadFixture('basic-roundtrip')

    const result = parseDsl(dsl, conditionVariableCatalog)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.jsonLogic).toEqual(json)
    expect(result.canonical).toBe('qaFindings.overallScore < 0.6 && qaFindings.flagsCount > 2')
    expect(result.variables.map((variable) => variable.path)).toEqual([
      'qaFindings.overallScore',
      'qaFindings.flagsCount',
    ])
    expect(result.warnings).toHaveLength(0)
  })

  it('validates variables against the catalog', () => {
    const result = parseDsl('unknownVar > 1', conditionVariableCatalog)
    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.errors[0]?.code).toBe('unknown_variable')
    expect(result.errors[0]?.range.start.column).toBe(1)
  })

  it('validates operators based on variable type', () => {
    const result = parseDsl('qaFindings.containsCritical > 0', conditionVariableCatalog)
    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.errors[0]?.code).toBe('operator_not_allowed')
    expect(result.errors[0]?.message).toContain('qaFindings.containsCritical')
  })

  it('returns warnings when expression is always true', () => {
    const result = parseDsl('true', conditionVariableCatalog)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]?.code).toBe('noop_true')
  })

  it('preserves parentheses when mixing logical precedence', () => {
    const expression =
      'qaFindings.overallScore < 0.6 && (qaFindings.flagsCount > 2 || qaFindings.containsCritical == true)'
    const result = parseDsl(expression, conditionVariableCatalog)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.canonical).toBe(expression)
  })

  it('rejects literal type mismatches based on the catalog', () => {
    const result = parseDsl('qaFindings.overallScore == "bad"', conditionVariableCatalog)
    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.errors.some((error) => error.code === 'type_mismatch')).toBe(true)
  })

  it('rejects variable-to-variable type mismatches', () => {
    const result = parseDsl('qaFindings.overallScore == qaFindings.containsCritical', conditionVariableCatalog)
    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.errors.some((error) => error.code === 'type_mismatch')).toBe(true)
  })
})

describe('toDsl', () => {
  it('renders JSON-Logic payloads back into the DSL', () => {
    const { dsl, json } = loadFixture('grouped-roundtrip')

    const result = toDsl(json, conditionVariableCatalog)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.expression).toBe(dsl)
  })

  it('fails when JSON-Logic payload references unknown operators', () => {
    const result = toDsl({ between: [{ var: 'qaFindings.overallScore' }, 0.2, 0.8] }, conditionVariableCatalog)
    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.errors[0]?.code).toBe('invalid_json_logic')
  })

  it('retains parentheses when rendering mixed-precedence logic', () => {
    const source =
      'qaFindings.overallScore < 0.6 && (qaFindings.flagsCount > 2 || qaFindings.containsCritical == true)'
    const parsed = parseDsl(source, conditionVariableCatalog)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const rendered = toDsl(parsed.jsonLogic, conditionVariableCatalog)
    expect(rendered.ok).toBe(true)
    if (!rendered.ok) return

    expect(rendered.expression).toBe(source)
  })
})

describe('evaluateCondition', () => {
  it('evaluates JSON-Logic output against payloads', () => {
    const { json } = loadFixture('basic-roundtrip')
    const payload = {
      qaFindings: {
        overallScore: 0.51,
        flagsCount: 4,
      },
    }

    const result = evaluateCondition(json, payload)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.result).toBe(true)
    expect(result.resolvedVariables).toMatchObject({
      'qaFindings.overallScore': 0.51,
      'qaFindings.flagsCount': 4,
    })
  })
})
