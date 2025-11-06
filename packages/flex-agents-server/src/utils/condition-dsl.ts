import { createError, type H3Error } from 'h3'

import {
  ConditionDslValidationError,
  INVALID_CONDITION_DSL_ERROR,
  normalizeConditionInput,
  type ConditionDslError,
  type ConditionValidationInput,
  type ConditionValidationOptions,
  type ConditionValidationResult
} from '@awesomeposter/shared'

export type ValidateConditionInput = ConditionValidationInput
export type ValidateConditionOptions = ConditionValidationOptions

export { INVALID_CONDITION_DSL_ERROR as INVALID_DSL_ERROR }

export function validateConditionInput(
  input: ValidateConditionInput,
  options: ValidateConditionOptions = {}
): ConditionValidationResult {
  try {
    return normalizeConditionInput(input, options)
  } catch (error) {
    if (error instanceof ConditionDslValidationError) {
      throw invalidExpressionError(error.errors)
    }
    throw error
  }
}

function invalidExpressionError(errors: readonly ConditionDslError[]): H3Error {
  return createError({
    statusCode: 400,
    statusMessage: 'Invalid condition expression.',
    data: {
      code: INVALID_CONDITION_DSL_ERROR,
      errors
    }
  })
}
