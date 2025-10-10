import { z } from 'zod'

/**
 * Canonical flex Orchestrator contracts shared between the planner,
 * participating agents, and UI surfaces. Each schema is paired with a
 * TypeScript type via `z.infer` so downstream packages can leverage
 * the same runtime validation and static typing.
 */

/**
 * Generic JSON Schema placeholder (accept any valid JSON object) used when
 * callers supply arbitrary structured output expectations.
 */
export const JsonSchemaShapeSchema = z.object({}).passthrough()
export type JsonSchemaShape = z.infer<typeof JsonSchemaShapeSchema>

const JsonSchemaContractCore = z.object({
  /**
   * JSON Schema definition describing the expected output payload.
   */
  schema: JsonSchemaShapeSchema,
  /**
   * Optional planner / validator hints such as `{ coerceDates: true }`.
   */
  hints: z.record(z.unknown()).optional(),
  /**
   * Example payload satisfying the schema. Enables previews in tooling.
   */
  example: z.unknown().optional()
})

/**
 * Structured mode for output contracts that rely on JSON Schema validation.
 */
export const JsonSchemaContractSchema = z.union([
  z.object({
    mode: z.literal('json_schema')
  }).merge(JsonSchemaContractCore),
  JsonSchemaContractCore.transform((value) => ({
    mode: 'json_schema' as const,
    ...value
  }))
])
export type JsonSchemaContract = z.infer<typeof JsonSchemaContractSchema>

/**
 * Freeform instructions for agents when a strict schema is unnecessary.
 */
export const FreeformContractSchema = z.object({
  mode: z.literal('freeform'),
  instructions: z.string().min(1),
  expectedFormat: z.string().optional(),
  example: z.string().optional()
})
export type FreeformContract = z.infer<typeof FreeformContractSchema>

/**
 * Union of supported output contract strategies.
 */
export const OutputContractSchema = z.union([JsonSchemaContractSchema, FreeformContractSchema])
export type OutputContract = z.infer<typeof OutputContractSchema>

/**
 * Shared loose record schema used for envelope metadata and agent artifacts.
 */
export const LooseRecordSchema = z.record(z.unknown())
export type LooseRecord = z.infer<typeof LooseRecordSchema>

/**
 * Contract describing expectations attached to a specific plan node.
 */
export const NodeContractSchema = z.object({
  contractId: z.string().optional(),
  description: z.string().optional(),
  output: OutputContractSchema,
  expectations: z.array(z.string()).optional(),
  maxAttempts: z.number().int().positive().optional(),
  fallback: z.enum(['retry', 'hitl', 'abort']).optional()
})
export type NodeContract = z.infer<typeof NodeContractSchema>

/**
 * Metadata accompanying a task envelope, typically used for analytics.
 */
export const TaskMetadataSchema = z.object({
  clientId: z.string().optional(),
  brandId: z.string().optional(),
  campaignId: z.string().optional(),
  correlationId: z.string().optional(),
  runLabel: z.string().optional()
})
export type TaskMetadata = z.infer<typeof TaskMetadataSchema>

/**
 * Canonical wrapper for planner requests including objectives and policies.
 */
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

/**
 * Data bundle passed to agents for a specific node execution.
 */
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

/**
 * Core set of event types emitted by the flex orchestrator over SSE.
 */
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

/**
 * Unified event payload used by the UI and agents server telemetry feeds.
 */
export const FlexEventSchema = z.object({
  type: FlexEventTypeSchema,
  id: z.string().optional(),
  timestamp: z.string(),
  payload: z.unknown().optional(),
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

/**
 * Payload agents submit during registration to advertise their capabilities.
 */
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

/**
 * Persisted capability entry augmented by orchestrator health tracking.
 */
export const CapabilityRecordSchema = CapabilityRegistrationSchema.extend({
  status: z.enum(['active', 'inactive']).default('active'),
  lastSeenAt: z.string().optional(),
  registeredAt: z.string().optional()
})
export type CapabilityRecord = z.infer<typeof CapabilityRecordSchema>
