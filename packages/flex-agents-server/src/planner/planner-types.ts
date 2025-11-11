import { z } from 'zod'
import { RoutingConditionSchema } from '@awesomeposter/shared'

const StringOrArraySchema = z
  .union([z.array(z.string().min(1)), z.string().min(1)])
  .transform((value) => (Array.isArray(value) ? value : [value]))

const PlannerDraftNodeStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'awaiting_hitl',
  'awaiting_human',
  'error'
])

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

const PlannerRoutingConditionInputSchema = z.union([z.string().min(1), RoutingConditionSchema]).or(
  z.object({
    dsl: z.string().min(1),
    jsonLogic: z.any().optional()
  })
)

const PlannerRoutingEdgeSchema = z
  .object({
    to: z.string().min(1),
    condition: PlannerRoutingConditionInputSchema.optional(),
    if: PlannerRoutingConditionInputSchema.optional(),
    label: z.string().optional(),
    metadata: z.record(z.unknown()).optional()
  })
  .superRefine((value, ctx) => {
    if (!value.condition && !value.if) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Routing edge requires `condition` or `if`.',
        path: ['condition']
      })
    }
  })

const PlannerRoutingSchema = z.object({
  routes: z.array(PlannerRoutingEdgeSchema).nonempty(),
  elseTo: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).optional()
})

export const PlannerDraftNodeSchema = z.object({
  label: z.string().min(1).optional(),
  stage: z.string().min(1),
  capabilityId: z.string().min(1).optional(),
  derived: z.boolean().optional(),
  status: PlannerDraftNodeStatusSchema,
  kind: z
    .enum(['structuring', 'execution', 'transformation', 'validation', 'fallback', 'routing'])
    .optional(),
  inputFacets: FacetListSchema.optional(),
  outputFacets: FacetListSchema.optional(),
  rationale: StringOrArraySchema.optional(),
  instructions: StringOrArraySchema.optional(),
  routing: PlannerRoutingSchema.optional()
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
export type PlannerDraftNodeStatus = z.infer<typeof PlannerDraftNodeStatusSchema>

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
