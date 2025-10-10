import { z } from 'zod'

// Generic JSON schema placeholder (accept any valid JSON object)
export const JsonSchemaShapeSchema = z.object({}).passthrough()
export type JsonSchemaShape = z.infer<typeof JsonSchemaShapeSchema>

const JsonSchemaContractCore = z.object({
  schema: JsonSchemaShapeSchema,
  hints: z.record(z.any()).optional()
})

const JsonSchemaContractSchema = z.union([
  z.object({
    mode: z.literal('json_schema')
  }).merge(JsonSchemaContractCore),
  JsonSchemaContractCore.transform((value) => ({
    mode: 'json_schema' as const,
    ...value
  }))
])
export type JsonSchemaContract = z.infer<typeof JsonSchemaContractSchema>

export const FreeformContractSchema = z.object({
  mode: z.literal('freeform'),
  instructions: z.string().min(1),
  expectedFormat: z.string().optional(),
  example: z.string().optional()
})
export type FreeformContract = z.infer<typeof FreeformContractSchema>

export const OutputContractSchema = z.union([JsonSchemaContractSchema, FreeformContractSchema])
export type OutputContract = z.infer<typeof OutputContractSchema>

export const NodeContractSchema = z.object({
  contractId: z.string().optional(),
  description: z.string().optional(),
  output: OutputContractSchema,
  expectations: z.array(z.string()).optional(),
  maxAttempts: z.number().int().positive().optional(),
  fallback: z.enum(['retry', 'hitl', 'abort']).optional()
})
export type NodeContract = z.infer<typeof NodeContractSchema>

export const TaskMetadataSchema = z.object({
  clientId: z.string().optional(),
  brandId: z.string().optional(),
  campaignId: z.string().optional(),
  correlationId: z.string().optional(),
  runLabel: z.string().optional()
})

const LooseRecordSchema = z.record(z.any())

export const TaskEnvelopeSchema = z.object({
  objective: z.string().min(1),
  inputs: LooseRecordSchema.optional(),
  constraints: LooseRecordSchema.optional(),
  policies: LooseRecordSchema.optional(),
  specialInstructions: z.array(z.string()).optional(),
  metadata: TaskMetadataSchema.optional(),
  outputContract: OutputContractSchema
})
export type TaskEnvelope = z.infer<typeof TaskEnvelopeSchema>

export const ContextBundleSchema = z.object({
  runId: z.string(),
  nodeId: z.string(),
  agentId: z.string().optional(),
  objective: z.string().min(1),
  summary: z.string().optional(),
  inputs: LooseRecordSchema.optional(),
  policies: LooseRecordSchema.optional(),
  artifacts: LooseRecordSchema.optional(),
  priorOutputs: LooseRecordSchema.optional(),
  instructions: z.array(z.string()).optional(),
  contract: NodeContractSchema,
  metadata: z
    .object({
      correlationId: z.string().optional(),
      traceId: z.string().optional(),
      stepOrder: z.number().int().nonnegative().optional()
    })
    .optional()
})
export type ContextBundle = z.infer<typeof ContextBundleSchema>

export const FlexEventTypeSchema = z.enum([
  'start',
  'plan_generated',
  'plan_updated',
  'node_start',
  'node_complete',
  'node_error',
  'hitl_request',
  'hitl_resolved',
  'validation_error',
  'policy_update',
  'log',
  'complete'
])
export type FlexEventType = z.infer<typeof FlexEventTypeSchema>

export const FlexEventSchema = z.object({
  type: FlexEventTypeSchema,
  id: z.string().optional(),
  timestamp: z.string(),
  payload: z.any().optional(),
  correlationId: z.string().optional(),
  nodeId: z.string().optional(),
  runId: z.string().optional(),
  message: z.string().optional()
})
export type FlexEvent = z.infer<typeof FlexEventSchema>

const InputTraitsSchema = z
  .object({
    languages: z.array(z.string()).optional(),
    formats: z.array(z.string()).optional(),
    strengths: z.array(z.string()).optional(),
    limitations: z.array(z.string()).optional()
  })
  .optional()

const CostInfoSchema = z
  .object({
    tier: z.string().optional(),
    estimatedTokens: z.number().int().nonnegative().optional(),
    pricePer1kTokens: z.number().nonnegative().optional(),
    currency: z.string().optional()
  })
  .optional()

const HeartbeatSchema = z
  .object({
    intervalSeconds: z.number().int().positive(),
    timeoutSeconds: z.number().int().positive().optional()
  })
  .optional()

export const CapabilityRegistrationSchema = z.object({
  capabilityId: z.string().min(1),
  version: z.string().min(1),
  displayName: z.string().min(1),
  summary: z.string().min(1),
  inputTraits: InputTraitsSchema,
  defaultContract: OutputContractSchema.optional(),
  cost: CostInfoSchema,
  preferredModels: z.array(z.string()).optional(),
  heartbeat: HeartbeatSchema,
  metadata: LooseRecordSchema.optional()
})
export type CapabilityRegistration = z.infer<typeof CapabilityRegistrationSchema>

export const CapabilityRecordSchema = CapabilityRegistrationSchema.extend({
  status: z.enum(['active', 'inactive']).default('active'),
  lastSeenAt: z.string().optional(),
  registeredAt: z.string().optional()
})
export type CapabilityRecord = z.infer<typeof CapabilityRecordSchema>
