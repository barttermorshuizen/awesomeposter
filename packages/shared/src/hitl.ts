import { z } from 'zod'
import { PlanStepStatusEnum } from './agent-run.js'
import { FlexFacetProvenanceSchema, JsonSchemaContractSchema, OutputContractSchema } from './flex/types.js'

export const HitlUrgencyEnum = z.enum(['low', 'normal', 'high'])
export type HitlUrgency = z.infer<typeof HitlUrgencyEnum>

export const HitlRequestKindEnum = z.enum(['question', 'approval', 'choice'])
export type HitlRequestKind = z.infer<typeof HitlRequestKindEnum>

export const HitlOriginAgentEnum = z.enum(['strategy', 'generation', 'qa'])
export type HitlOriginAgent = z.infer<typeof HitlOriginAgentEnum>

export const HitlOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional()
})
export type HitlOption = z.infer<typeof HitlOptionSchema>

export const HitlRequestPayloadSchema = z.object({
  question: z.string().min(1),
  kind: HitlRequestKindEnum.default('question'),
  options: z.array(HitlOptionSchema).default([]),
  allowFreeForm: z.boolean().default(false),
  urgency: HitlUrgencyEnum.default('normal'),
  additionalContext: z.string().optional()
})
export type HitlRequestPayload = z.infer<typeof HitlRequestPayloadSchema>

export const HitlRequestStatusEnum = z.enum(['pending', 'resolved', 'denied'])
export type HitlRequestStatus = z.infer<typeof HitlRequestStatusEnum>

export const HitlResponseTypeEnum = z.enum(['option', 'approval', 'rejection', 'freeform'])
export type HitlResponseType = z.infer<typeof HitlResponseTypeEnum>

export const HitlResponseSchema = z.object({
  id: z.string(),
  requestId: z.string(),
  responseType: HitlResponseTypeEnum,
  selectedOptionId: z.string().optional(),
  freeformText: z.string().optional(),
  approved: z.boolean().optional(),
  responderId: z.string().optional(),
  responderDisplayName: z.string().optional(),
  createdAt: z.coerce.date(),
  metadata: z.record(z.any()).optional()
})
export type HitlResponse = z.infer<typeof HitlResponseSchema>

export const HitlContractSummarySchema = z.object({
  nodeId: z.string(),
  nodeLabel: z.string().optional(),
  capabilityId: z.string().optional(),
  capabilityLabel: z.string().optional(),
  planVersion: z.number().int().nonnegative().optional(),
  contract: z
    .object({
      input: JsonSchemaContractSchema.optional(),
      output: OutputContractSchema.optional()
    })
    .optional(),
  facets: z
    .object({
      input: z.array(FlexFacetProvenanceSchema).optional(),
      output: z.array(FlexFacetProvenanceSchema).optional()
    })
    .optional()
})
export type HitlContractSummary = z.infer<typeof HitlContractSummarySchema>

export const HitlRequestMetadataSchema = z.object({
  pendingNodeId: z.string().optional(),
  operatorPrompt: z.string().optional(),
  contractSummary: HitlContractSummarySchema.optional()
})
export type HitlRequestMetadata = z.infer<typeof HitlRequestMetadataSchema>

export const HitlRequestRecordSchema = z.object({
  id: z.string(),
  runId: z.string(),
  threadId: z.string().optional(),
  stepId: z.string().optional(),
  stepStatusAtRequest: PlanStepStatusEnum.optional(),
  originAgent: HitlOriginAgentEnum,
  payload: HitlRequestPayloadSchema,
  status: HitlRequestStatusEnum.default('pending'),
  denialReason: z.string().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  pendingNodeId: z.string().optional(),
  operatorPrompt: z.string().optional(),
  contractSummary: HitlContractSummarySchema.optional(),
  metrics: z
    .object({
      attempt: z.number().int().nonnegative().optional()
    })
    .optional()
})
export type HitlRequestRecord = z.infer<typeof HitlRequestRecordSchema>

export const HitlRunStateSchema = z.object({
  requests: z.array(HitlRequestRecordSchema).default([]),
  responses: z.array(HitlResponseSchema).default([]),
  pendingRequestId: z.string().nullable().optional(),
  deniedCount: z.number().int().nonnegative().default(0)
})
export type HitlRunState = z.infer<typeof HitlRunStateSchema>

export const HitlResponseInputSchema = z.object({
  requestId: z.string(),
  responseType: HitlResponseTypeEnum.optional(),
  selectedOptionId: z.string().optional(),
  freeformText: z.string().optional(),
  approved: z.boolean().optional(),
  responderId: z.string().optional(),
  responderDisplayName: z.string().optional(),
  metadata: z.record(z.any()).optional()
})
export type HitlResponseInput = z.infer<typeof HitlResponseInputSchema>

export const HitlStateEnvelopeSchema = z.object({
  responses: z.array(HitlResponseInputSchema).optional()
})
export type HitlStateEnvelope = z.infer<typeof HitlStateEnvelopeSchema>
