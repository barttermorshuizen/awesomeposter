import { z } from 'zod'

const StringOrArraySchema = z
  .union([z.array(z.string().min(1)), z.string().min(1)])
  .transform((value) => (Array.isArray(value) ? value : [value]))

const FacetListSchema = z
  .union([
    z.array(z.string().min(1)),
    z.string().min(1),
    z.record(z.unknown())
  ])
  .transform((value) => {
    if (Array.isArray(value)) return value
    if (typeof value === 'string') return [value]
    return Object.keys(value)
  })

export const PlannerDraftNodeSchema = z.object({
  label: z.string().min(1).optional(),
  stage: z.string().min(1),
  capabilityId: z.string().min(1).optional(),
  derived: z.boolean().optional(),
  kind: z
    .enum(['structuring', 'execution', 'transformation', 'validation', 'fallback'])
    .optional(),
  inputFacets: FacetListSchema.optional(),
  outputFacets: FacetListSchema.optional(),
  rationale: StringOrArraySchema.optional(),
  instructions: StringOrArraySchema.optional()
})

export const PlannerDraftMetadataSchema = z.object({
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional()
})

export const PlannerDraftSchema = z.object({
  nodes: z.array(PlannerDraftNodeSchema).min(1),
  metadata: PlannerDraftMetadataSchema.optional()
})

export type PlannerDraftNode = z.infer<typeof PlannerDraftNodeSchema>
export type PlannerDraftMetadata = z.infer<typeof PlannerDraftMetadataSchema>

export type PlannerDraft = {
  nodes: PlannerDraftNode[]
  metadata?: PlannerDraftMetadata
}

export type PlannerDiagnostic = {
  code: string
  message: string
  severity: 'error' | 'warning'
  nodeStage?: string
  capabilityId?: string
  facet?: string
}

export type PlannerDiagnostics = PlannerDiagnostic[]
