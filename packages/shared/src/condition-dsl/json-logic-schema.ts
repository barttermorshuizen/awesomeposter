import { z } from 'zod'

import type { JsonLogicExpression } from './types.js'

export const JsonLogicExpressionSchema: z.ZodType<JsonLogicExpression> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(JsonLogicExpressionSchema),
    z.record(JsonLogicExpressionSchema)
  ])
)
