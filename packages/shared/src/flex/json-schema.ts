import { z } from 'zod'

export const JsonSchemaShapeSchema = z.object({}).passthrough()
export type JsonSchemaShape = z.infer<typeof JsonSchemaShapeSchema>
