import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  ConditionDslValidationError,
  conditionVariableCatalog,
  evaluateCondition,
  normalizeConditionInput,
  parseDsl,
  toDsl,
  type JsonLogicExpression,
} from '../src/condition-dsl/index.js'

const FIXTURES_DIR = path.resolve(process.cwd(), 'tests/fixtures/condition-dsl')

const HOOK_INTENSITY_CANONICAL =
  'metadata.runContextSnapshot.facets.planKnobs.value.hookIntensity'
const HOOK_INTENSITY_ALIAS = 'facets.planKnobs.hookIntensity'
const VARIANT_COUNT_CANONICAL =
  'metadata.runContextSnapshot.facets.planKnobs.value.variantCount'
const VARIANT_COUNT_ALIAS = 'facets.planKnobs.variantCount'
const FORMAT_TYPE_CANONICAL =
  'metadata.runContextSnapshot.facets.planKnobs.value.formatType'
const FORMAT_TYPE_ALIAS = 'facets.planKnobs.formatType'
const RECOMMENDATION_SET_CANONICAL =
  'metadata.runContextSnapshot.facets.recommendationSet.value'
const RECOMMENDATION_SET_ALIAS = 'facets.recommendationSet'
const READY_FOR_PLANNER_CANONICAL =
  'metadata.runContextSnapshot.facets.clarificationResponse.value.readyForPlanner'
const READY_FOR_PLANNER_ALIAS = 'facets.clarificationResponse.readyForPlanner'

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
    const expectedCanonical = `${HOOK_INTENSITY_ALIAS} < 0.6 && ${VARIANT_COUNT_ALIAS} > 2`
    expect(result.canonical).toBe(expectedCanonical)
    expect(result.variables.map((variable) => variable.path)).toEqual([
      HOOK_INTENSITY_CANONICAL,
      VARIANT_COUNT_CANONICAL,
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
    const result = parseDsl(`${READY_FOR_PLANNER_ALIAS} > 0`, conditionVariableCatalog)
    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.errors[0]?.code).toBe('operator_not_allowed')
    expect(result.errors[0]?.message).toContain(READY_FOR_PLANNER_ALIAS)
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
      `${HOOK_INTENSITY_ALIAS} < 0.6 && (${VARIANT_COUNT_ALIAS} > 2 || ${READY_FOR_PLANNER_ALIAS} == true)`
    const result = parseDsl(expression, conditionVariableCatalog)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.canonical).toBe(expression)
  })

  it('rejects literal type mismatches based on the catalog', () => {
    const result = parseDsl(`${HOOK_INTENSITY_ALIAS} == "bad"`, conditionVariableCatalog)
    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.errors.some((error) => error.code === 'type_mismatch')).toBe(true)
  })

  it('rejects variable-to-variable type mismatches', () => {
    const result = parseDsl(
      `${HOOK_INTENSITY_ALIAS} == ${READY_FOR_PLANNER_ALIAS}`,
      conditionVariableCatalog,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.errors.some((error) => error.code === 'type_mismatch')).toBe(true)
  })

  it('parses quantifier expressions with the default alias', () => {
    const { dsl, json } = loadFixture('quantifier-some-roundtrip')

    const result = parseDsl(dsl, conditionVariableCatalog)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.jsonLogic).toEqual(json)
    expect(result.canonical).toBe(dsl)
  })

  it('parses quantifier expressions with an explicit alias', () => {
    const { dsl, json } = loadFixture('quantifier-alias-roundtrip')

    const result = parseDsl(dsl, conditionVariableCatalog)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.jsonLogic).toEqual(json)
    expect(result.canonical).toBe(dsl)
  })

  it('parses all-quantifier expressions with the default alias', () => {
    const { dsl, json } = loadFixture('quantifier-all-roundtrip')

    const result = parseDsl(dsl, conditionVariableCatalog)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.jsonLogic).toEqual(json)
    expect(result.canonical).toBe(dsl)
  })

  it('accepts legacy aliases that include the value segment', () => {
    const result = parseDsl('facets.planKnobs.value.hookIntensity < 0.6', conditionVariableCatalog)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.canonical).toBe(`${HOOK_INTENSITY_ALIAS} < 0.6`)
  })

  it('rejects quantifiers applied to non-array variables', () => {
    const result = parseDsl(`some(${HOOK_INTENSITY_ALIAS}, item > 0.5)`, conditionVariableCatalog)
    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.errors.some((error) => error.code === 'invalid_quantifier')).toBe(true)
  })

  it('requires predicates to reference the current quantifier alias', () => {
    const result = parseDsl(
      `some(${RECOMMENDATION_SET_ALIAS}, ${VARIANT_COUNT_ALIAS} > 1)`,
      conditionVariableCatalog,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.errors.some((error) => error.code === 'invalid_quantifier')).toBe(true)
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
    const result = toDsl(
      { between: [{ var: HOOK_INTENSITY_CANONICAL }, 0.2, 0.8] },
      conditionVariableCatalog,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.errors[0]?.code).toBe('invalid_json_logic')
  })

  it('retains parentheses when rendering mixed-precedence logic', () => {
    const source =
      `${HOOK_INTENSITY_ALIAS} < 0.6 && (${VARIANT_COUNT_ALIAS} > 2 || ${READY_FOR_PLANNER_ALIAS} == true)`
    const parsed = parseDsl(source, conditionVariableCatalog)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const rendered = toDsl(parsed.jsonLogic, conditionVariableCatalog)
    expect(rendered.ok).toBe(true)
    if (!rendered.ok) return

    expect(rendered.expression).toBe(source)
  })

  it('renders quantifier payloads with default alias formatting', () => {
    const { dsl, json } = loadFixture('quantifier-some-roundtrip')

    const result = toDsl(json, conditionVariableCatalog)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.expression).toBe(dsl)
  })

  it('renders quantifier payloads with explicit aliases', () => {
    const { dsl, json } = loadFixture('quantifier-alias-roundtrip')

    const result = toDsl(json, conditionVariableCatalog)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.expression).toBe(dsl)
  })

  it('renders all-quantifier payloads with the default alias', () => {
    const { dsl, json } = loadFixture('quantifier-all-roundtrip')

    const result = toDsl(json, conditionVariableCatalog)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.expression).toBe(dsl)
  })

  it('infers default alias usage when legacy payloads omit alias metadata', () => {
    const json: JsonLogicExpression = {
      some: [
        { var: RECOMMENDATION_SET_CANONICAL },
        { '==': [{ var: 'status' }, 'open'] },
      ],
    }

    const result = toDsl(json, conditionVariableCatalog)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.expression).toBe(
      `some(${RECOMMENDATION_SET_ALIAS}, item.status == "open")`,
    )
  })
})

describe('normalizeConditionInput', () => {
  it('returns canonical data for DSL expressions', () => {
    const result = normalizeConditionInput(
      { dsl: `${HOOK_INTENSITY_ALIAS} < 0.6` },
      { catalog: conditionVariableCatalog },
    )

    expect(result.jsonLogic).toEqual({
      '<': [{ var: HOOK_INTENSITY_CANONICAL }, 0.6],
    })
    expect(result.canonicalDsl).toBe(`${HOOK_INTENSITY_ALIAS} < 0.6`)
    expect(result.warnings).toHaveLength(0)
    expect(result.variables).toEqual([HOOK_INTENSITY_CANONICAL])
  })

  it('passes JSON-Logic payloads through unchanged', () => {
    const jsonLogic: JsonLogicExpression = {
      and: [{ '<': [{ var: HOOK_INTENSITY_CANONICAL }, 0.4] }],
    }

    const result = normalizeConditionInput({ jsonLogic })

    expect(result.jsonLogic).toBe(jsonLogic)
    expect(result.canonicalDsl).toBeNull()
    expect(result.warnings).toHaveLength(0)
    expect(result.variables).toHaveLength(0)
  })

  it('throws when neither DSL nor JSON-Logic is provided', () => {
    expect(() => normalizeConditionInput({})).toThrowError(
      ConditionDslValidationError,
    )
  })
})

describe('evaluateCondition', () => {
  it('evaluates JSON-Logic output against payloads', () => {
    const { json } = loadFixture('basic-roundtrip')
    const payload = {
      metadata: {
        runContextSnapshot: {
          facets: {
            planKnobs: {
              value: {
                hookIntensity: 0.51,
                variantCount: 4,
                formatType: 'text',
              },
            },
          },
        },
      },
    }

    const result = evaluateCondition(json, payload)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.result).toBe(true)
    expect(result.resolvedVariables).toMatchObject({
      [HOOK_INTENSITY_CANONICAL]: 0.51,
      [VARIANT_COUNT_CANONICAL]: 4,
    })
  })

  it('supports `some` quantifier semantics with scoped predicate variables', () => {
    const expression: JsonLogicExpression = {
      some: [
        { var: RECOMMENDATION_SET_CANONICAL },
        { '==': [{ var: 'severity' }, 'critical'] },
      ],
    }
    const payload = {
      metadata: {
        runContextSnapshot: {
          facets: {
            recommendationSet: {
              value: [
                { severity: 'critical', recommendation: 'Review copy', status: 'open' },
                { severity: 'minor', recommendation: 'Refresh CTA', status: 'closed' },
              ],
            },
          },
        },
      },
    }

    const result = evaluateCondition(expression, payload)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.result).toBe(true)
    expect(result.resolvedVariables).toMatchObject({
      [RECOMMENDATION_SET_CANONICAL]:
        payload.metadata.runContextSnapshot.facets.recommendationSet.value,
    })
    expect(result.resolvedVariables).not.toHaveProperty('severity')
  })

  it('supports `all` quantifier semantics including empty arrays', () => {
    const expression: JsonLogicExpression = {
      all: [
        { var: RECOMMENDATION_SET_CANONICAL },
        { '!=': [{ var: 'severity' }, 'critical'] },
      ],
    }
    const payload = {
      metadata: {
        runContextSnapshot: {
          facets: {
            recommendationSet: {
              value: [
                { severity: 'minor', recommendation: 'Polish headline' },
                { severity: 'moderate', recommendation: 'Tighten CTA' },
              ],
            },
          },
        },
      },
    }

    const positive = evaluateCondition(expression, payload)
    expect(positive.ok).toBe(true)
    if (!positive.ok) return
    expect(positive.result).toBe(true)

    const failing = evaluateCondition(expression, {
      metadata: {
        runContextSnapshot: {
          facets: {
            recommendationSet: {
              value: [
                { severity: 'critical', recommendation: 'Escalate' },
                { severity: 'moderate', recommendation: 'Adjust tone' },
              ],
            },
          },
        },
      },
    })
    expect(failing.ok).toBe(true)
    if (failing.ok) {
      expect(failing.result).toBe(false)
    }

    const empty = evaluateCondition(expression, {
      metadata: {
        runContextSnapshot: {
          facets: {
            recommendationSet: { value: [] },
          },
        },
      },
    })
    expect(empty.ok).toBe(true)
    if (empty.ok) {
      expect(empty.result).toBe(false)
    }
  })

  it('returns descriptive errors when quantifier source does not resolve to an array', () => {
    const expression: JsonLogicExpression = {
      some: [
        { var: HOOK_INTENSITY_CANONICAL },
        { '==': [{ var: '' }, 0.6] },
      ],
    }
    const payload = {
      metadata: {
        runContextSnapshot: {
          facets: {
            planKnobs: {
              value: {
                hookIntensity: 0.42,
              },
            },
          },
        },
      },
    }

    const result = evaluateCondition(expression, payload)
    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error).toContain(
      `Operator \`some\` expected path "${HOOK_INTENSITY_CANONICAL}" to resolve to an array`,
    )
  })

  it('evaluates nested predicate lookups within quantifiers', () => {
    const expression: JsonLogicExpression = {
      some: [
        { var: RECOMMENDATION_SET_CANONICAL },
        {
          'and': [
            { '>=': [{ var: 'item.score' }, 0.8] },
            { '==': [{ var: 'status' }, 'open'] },
          ],
        },
      ],
    }

    const payload = {
      metadata: {
        runContextSnapshot: {
          facets: {
            recommendationSet: {
              value: [
                { status: 'closed', item: { score: 0.82 } },
                { status: 'open', item: { score: 0.81 } },
              ],
            },
          },
        },
      },
    }

    const result = evaluateCondition(expression, payload)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.result).toBe(true)

    const noMatch = evaluateCondition(expression, {
      metadata: {
        runContextSnapshot: {
          facets: {
            recommendationSet: {
              value: [
                { status: 'closed', item: { score: 0.9 } },
                { status: 'open', item: { score: 0.7 } },
              ],
            },
          },
        },
      },
    })

    expect(noMatch.ok).toBe(true)
    if (!noMatch.ok) return

    expect(noMatch.result).toBe(false)
  })
})
