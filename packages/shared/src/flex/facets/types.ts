import { z } from 'zod'

import { JsonSchemaShapeSchema } from '../json-schema.js'

export const FacetDirectionSchema = z
  .enum(['input', 'output', 'bidirectional', 'both'])
  .transform((direction) => (direction === 'both' ? 'bidirectional' : direction))
  .pipe(z.enum(['input', 'output', 'bidirectional']))

export type FacetDirection = z.infer<typeof FacetDirectionSchema>

export const FacetSemanticsSchema = z.union([
  z
    .object({
      summary: z.string().min(1).optional(),
      instruction: z.string().min(1),
      checkpoints: z.array(z.string().min(1)).optional()
    })
    .strict(),
  z.string().min(1).transform((instruction) => ({
    instruction
  }))
])

export type FacetSemantics = z.infer<typeof FacetSemanticsSchema>

export const FacetMetadataSchema = z
  .object({
    version: z.string().min(1),
    direction: FacetDirectionSchema,
    dependsOn: z.array(z.string().min(1)).optional(),
    owner: z.string().optional(),
    tags: z.array(z.string().min(1)).optional(),
    requiredByDefault: z.boolean().default(true),
    propertyKey: z
      .string()
      .min(1)
      .optional()
  })
  .strict()

export type FacetMetadata = z.infer<typeof FacetMetadataSchema>

export const FacetDefinitionSchema = z
  .object({
    name: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    schema: JsonSchemaShapeSchema,
    semantics: FacetSemanticsSchema,
    metadata: FacetMetadataSchema
  })
  .strict()

export type FacetDefinition = z.infer<typeof FacetDefinitionSchema>
