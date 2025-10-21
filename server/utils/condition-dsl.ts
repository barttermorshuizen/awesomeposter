import { createError, type H3Error } from 'h3'

import {
  conditionVariableCatalog,
  parseDsl,
  type ConditionDslError,
  type ConditionDslWarning,
  type ConditionVariableCatalog,
  type JsonLogicExpression,
} from '@awesomeposter/shared'

export interface ValidateConditionInput {
  dsl?: string | null
  jsonLogic?: JsonLogicExpression | null
}

export interface ValidateConditionOptions {
  catalog?: ConditionVariableCatalog
}

export interface ConditionValidationResult {
  jsonLogic: JsonLogicExpression
  canonicalDsl: string | null
  warnings: readonly ConditionDslWarning[]
  variables: readonly string[]
}

const INVALID_DSL_ERROR = 'invalid_condition_dsl'

export function validateConditionInput(
  input: ValidateConditionInput,
  options: ValidateConditionOptions = {},
): ConditionValidationResult {
  const catalog = options.catalog ?? conditionVariableCatalog
  const dsl = input.dsl?.trim() ?? ''

  if (dsl.length > 0) {
    const result = parseDsl(dsl, catalog)
    if (!result.ok) {
      throw invalidExpressionError(result.errors)
    }

    return {
      jsonLogic: result.jsonLogic,
      canonicalDsl: result.canonical,
      warnings: result.warnings,
      variables: result.variables.map((variable) => variable.path),
    }
  }

  if (input.jsonLogic != null) {
    return {
      jsonLogic: input.jsonLogic,
      canonicalDsl: null,
      warnings: [],
      variables: [],
    }
  }

  throw invalidExpressionError([
    {
      code: 'empty_expression',
      message: 'Either `dsl` or `jsonLogic` must be provided.',
      range: {
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 0, line: 1, column: 1 },
      },
    },
  ])
}

function invalidExpressionError(errors: readonly ConditionDslError[]): H3Error {
  return createError({
    statusCode: 400,
    statusMessage: 'Invalid condition expression.',
    data: {
      code: INVALID_DSL_ERROR,
      errors,
    },
  })
}
