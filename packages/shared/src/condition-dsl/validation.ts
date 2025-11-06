import { conditionVariableCatalog } from './catalog.js'
import { parseDsl } from './engine.js'
import {
  type ConditionVariableCatalog,
  type ConditionDslError,
  type ConditionDslWarning,
  type JsonLogicExpression
} from './types.js'

export interface ConditionValidationInput {
  dsl?: string | null
  jsonLogic?: JsonLogicExpression | null
}

export interface ConditionValidationOptions {
  catalog?: ConditionVariableCatalog
}

export interface ConditionValidationResult {
  jsonLogic: JsonLogicExpression
  canonicalDsl: string | null
  warnings: readonly ConditionDslWarning[]
  variables: readonly string[]
}

export const INVALID_CONDITION_DSL_ERROR = 'invalid_condition_dsl'

export class ConditionDslValidationError extends Error {
  constructor(public readonly errors: readonly ConditionDslError[]) {
    super('Invalid condition expression.')
    this.name = 'ConditionDslValidationError'
  }
}

export function normalizeConditionInput(
  input: ConditionValidationInput,
  options: ConditionValidationOptions = {}
): ConditionValidationResult {
  const catalog = options.catalog ?? conditionVariableCatalog
  const dsl = input.dsl?.trim() ?? ''

  if (dsl.length > 0) {
    const result = parseDsl(dsl, catalog)
    if (!result.ok) {
      throw new ConditionDslValidationError(result.errors)
    }

    return {
      jsonLogic: result.jsonLogic,
      canonicalDsl: result.canonical,
      warnings: result.warnings,
      variables: result.variables.map((variable) => variable.path)
    }
  }

  if (input.jsonLogic != null) {
    return {
      jsonLogic: input.jsonLogic,
      canonicalDsl: null,
      warnings: [],
      variables: []
    }
  }

  throw new ConditionDslValidationError([
    {
      code: 'empty_expression',
      message: 'Either `dsl` or `jsonLogic` must be provided.',
      range: {
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 0, line: 1, column: 1 }
      }
    }
  ])
}
