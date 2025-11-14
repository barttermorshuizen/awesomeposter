import { ZodError, z } from 'zod'
import { RuntimeConditionDslSchema, TaskPoliciesSchema } from './policies.js'
import { JsonSchemaShapeSchema, type JsonSchemaShape } from './json-schema.js'
import { JsonLogicExpressionSchema } from '../condition-dsl/json-logic-schema.js'
export { JsonSchemaShapeSchema } from './json-schema.js'
export type { JsonSchemaShape } from './json-schema.js'
import {
  ConditionDslValidationError,
  normalizeConditionInput,
  type ConditionValidationResult
} from '../condition-dsl/validation.js'
import type {
  ConditionComparisonOperator,
  ConditionDslError,
  ConditionVariableCatalog,
  JsonLogicExpression
} from '../condition-dsl/types.js'

import type { RuntimePolicyConditionDsl } from './policies.js'

/**
 * Canonical flex Orchestrator contracts shared between the planner,
 * participating agents, and UI surfaces. Each schema is paired with a
 * TypeScript type via `z.infer` so downstream packages can leverage
 * the same runtime validation and static typing.
 */

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

const UniqueFacetArraySchema = z
  .array(z.string().min(1))
  .nonempty()
  .superRefine((value, ctx) => {
    const seen = new Set<string>()
    for (const facet of value) {
      if (seen.has(facet)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Facet "${facet}" is declared multiple times`
        })
        break
      }
      seen.add(facet)
    }
  })

export const FacetContractSchema = z.object({
  mode: z.literal('facets'),
  facets: UniqueFacetArraySchema
})
export type FacetContract = z.infer<typeof FacetContractSchema>

/**
 * Union of supported output contract strategies.
 */
export const OutputContractSchema = z.union([JsonSchemaContractSchema, FreeformContractSchema, FacetContractSchema])
export type OutputContract = z.infer<typeof OutputContractSchema>

/**
 * Capability-level contracts are symmetric for inputs and outputs.
 * Currently, they mirror the output contract union.
 */
export const CapabilityContractSchema = OutputContractSchema
export type CapabilityContract = OutputContract

/**
 * Shared loose record schema used for envelope metadata and agent artifacts.
 */
export const LooseRecordSchema = z.record(z.unknown())
export type LooseRecord = z.infer<typeof LooseRecordSchema>

export const AgentTypeSchema = z.enum(['ai', 'human'])
export type AgentType = z.infer<typeof AgentTypeSchema>

export const CapabilityKindSchema = z.enum(['structuring', 'execution', 'validation', 'transformation', 'routing'])
export type CapabilityKind = z.infer<typeof CapabilityKindSchema>

export const ContextKnowledgeSnippetSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  body: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  source: z.string().min(1),
  lastUpdated: z.string().min(1),
  score: z.number().nonnegative().optional(),
  fallback: z.boolean().optional(),
  metadata: LooseRecordSchema.optional()
})
export type ContextKnowledgeSnippet = z.infer<typeof ContextKnowledgeSnippetSchema>

export const ContextKnowledgeRefreshSchema = z.object({
  frequency: z.string().min(1),
  lastRefreshedAt: z.string().min(1),
  nextRefreshDueAt: z.string().min(1).optional(),
  notes: z.string().optional()
})
export type ContextKnowledgeRefresh = z.infer<typeof ContextKnowledgeRefreshSchema>

export const ContextKnowledgeBundleSchema = z.object({
  corpusId: z.string().min(1),
  version: z.string().min(1),
  refreshCadence: ContextKnowledgeRefreshSchema,
  status: z.enum(['ready', 'fallback', 'disabled', 'unavailable']),
  reason: z.string().optional(),
  snippets: z.array(ContextKnowledgeSnippetSchema)
})
export type ContextKnowledgeBundle = z.infer<typeof ContextKnowledgeBundleSchema>

const InstructionTemplatesSchemaCore = z
  .record(z.string(), z.string().min(1))
  .superRefine((value, ctx) => {
    const appTemplate = value.app
    if (typeof appTemplate !== 'string' || appTemplate.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Instruction templates must include a non-empty `app` entry.',
        path: ['app']
      })
    }
  })

export const InstructionTemplatesSchema = InstructionTemplatesSchemaCore
export type InstructionTemplates = z.infer<typeof InstructionTemplatesSchema>

const AssignmentDefaultsSchemaCore = z
  .object({
    role: z.string().min(1),
    assignedTo: z.string().min(1).optional(),
    notifyChannels: z.array(z.string().min(1)).optional(),
    maxNotifications: z.number().int().positive().optional(),
    timeoutSeconds: z.number().int().positive().optional(),
    onDecline: z.enum(['fail_run', 'requeue', 'escalate']).optional(),
    priority: z.enum(['urgent', 'high', 'normal', 'low']).optional(),
    instructions: z.string().optional()
  })
  .passthrough()

export const AssignmentDefaultsSchema = AssignmentDefaultsSchemaCore
export type AssignmentDefaults = z.infer<typeof AssignmentDefaultsSchema>

const AssignmentSnapshotSchemaCore = z
  .object({
    assignmentId: z.string().min(1).optional(),
    runId: z.string().min(1).optional(),
    nodeId: z.string().min(1).optional(),
    status: z.enum(['pending', 'in_progress', 'awaiting_submission', 'completed', 'cancelled']).optional(),
    assignedTo: z.string().min(1).optional(),
    role: z.string().min(1).optional(),
    notifyChannels: z.array(z.string().min(1)).optional(),
    dueAt: z.string().min(1).optional(),
    submittedAt: z.string().min(1).optional(),
    timeoutSeconds: z.number().int().positive().optional(),
    maxNotifications: z.number().int().positive().optional(),
    priority: z.enum(['urgent', 'high', 'normal', 'low']).optional(),
    instructions: z.string().optional(),
    defaults: AssignmentDefaultsSchema.optional(),
    metadata: LooseRecordSchema.optional(),
    createdAt: z.string().min(1).optional(),
    updatedAt: z.string().min(1).optional()
  })
  .passthrough()

export const AssignmentSnapshotSchema = AssignmentSnapshotSchemaCore
export type AssignmentSnapshot = z.infer<typeof AssignmentSnapshotSchema>

const FlexFacetProvenanceDirectionSchema = z.enum(['input', 'output'])

export const FlexFacetProvenanceSchema = z.object({
  facet: z.string().min(1),
  title: z.string().min(1),
  direction: FlexFacetProvenanceDirectionSchema,
  pointer: z.string().min(1)
})

export const FlexFacetProvenanceMapSchema = z
  .object({
    input: z.array(FlexFacetProvenanceSchema).optional(),
    output: z.array(FlexFacetProvenanceSchema).optional()
  })
  .optional()

export type FlexFacetProvenanceMap = {
  input?: import('./facets/contract-compiler.js').FacetProvenance[]
  output?: import('./facets/contract-compiler.js').FacetProvenance[]
}

/**
 * Canonical contracts persisted on each flex plan node.
 */
export type FlexPlanNodeContracts = {
  input?: JsonSchemaContract | null
  output: OutputContract
}

/**
 * Normalized facet lists advertised by a flex plan node.
 */
export type FlexPlanNodeFacets = {
  input: string[]
  output: string[]
}

/**
 * Provenance metadata describing how a node's facet schema was composed.
 */
export type FlexPlanNodeProvenance = FlexFacetProvenanceMap

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
 * Declarative predicate describing the desired state of a specific facet.
 *
 * Each entry targets a facet by name, drills into its payload via `path`,
 * and wraps a Condition DSL payload that downstream services will evaluate.
 * Arrays of these conditions combine with AND semantics: every condition must
 * pass for the goal to be considered satisfied.
 */
export const FacetConditionSchema = z
  .object({
    facet: z.string().min(1),
    path: z.string().min(1),
    condition: RuntimeConditionDslSchema
  })
  .strict()
export type FacetCondition = z.infer<typeof FacetConditionSchema>

export type CapabilityPostConditionDslEntry = {
  facet: string
  path: string
  condition: {
    dsl: string
  }
}

export type CapabilityPostConditionGuard = {
  facet: string
  paths: string[]
}

export type CapabilityPostConditionMetadata = {
  conditions: FacetCondition[]
  guards: CapabilityPostConditionGuard[]
}

export function buildPostConditionDslSnapshot(conditions: FacetCondition[]): CapabilityPostConditionDslEntry[] {
  if (!conditions.length) return []
  return conditions.map((condition) => ({
    facet: condition.facet,
    path: condition.path,
    condition: {
      dsl: condition.condition.dsl
    }
  }))
}

export function buildPostConditionMetadata(conditions: FacetCondition[]): CapabilityPostConditionMetadata {
  const guardMap = new Map<string, Set<string>>()
  for (const entry of conditions) {
    const paths = guardMap.get(entry.facet) ?? new Set<string>()
    paths.add(entry.path)
    guardMap.set(entry.facet, paths)
  }
  const guards: CapabilityPostConditionGuard[] = Array.from(guardMap.entries()).map(([facet, paths]) => ({
    facet,
    paths: Array.from(paths)
  }))
  return {
    conditions,
    guards
  }
}

/**
 * Helper type for consumers who only require direct access to the DSL payload.
 * Exposed to avoid re-importing the policies module in downstream packages.
 */
export type FacetConditionDsl = RuntimePolicyConditionDsl

/**
 * Result payload emitted after evaluating a single goal condition.
 */
export const GoalConditionResultSchema = z
  .object({
    facet: z.string().min(1),
    path: z.string().min(1),
    expression: z.string().min(1),
    satisfied: z.boolean(),
    error: z.string().min(1).optional(),
    dsl: z.string().min(1).optional(),
    jsonLogic: JsonLogicExpressionSchema.optional(),
    observedValue: z.unknown().optional()
  })
  .strict()
export type GoalConditionResult = z.infer<typeof GoalConditionResultSchema>

/**
 * Canonical wrapper for planner requests including objectives and policies.
 */
export const TaskEnvelopeSchema = z.object({
  objective: z.string().min(1),
  inputs: LooseRecordSchema.optional(),
  constraints: LooseRecordSchema.optional(),
  policies: TaskPoliciesSchema.optional(),
  specialInstructions: z.array(z.string()).optional(),
  metadata: TaskMetadataSchema.optional(),
  /**
   * Optional list of facet-specific predicates that must all evaluate truthy
   * before the orchestrator marks the task objective complete.
   */
  goal_condition: z.array(FacetConditionSchema).min(1).optional(),
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
  assignment: AssignmentSnapshotSchema.optional(),
  metadata: z
    .object({
      correlationId: z.string().optional(),
      traceId: z.string().optional(),
      stepOrder: z.number().int().nonnegative().optional()
    })
    .optional(),
  knowledge: ContextKnowledgeBundleSchema.optional()
})
export type ContextBundle = z.infer<typeof ContextBundleSchema>

export type HitlClarificationEntry = {
  questionId: string
  nodeId: string
  capabilityId?: string
  question: string
  answer?: string
  createdAt: string
  answeredAt?: string
}

export const FlexEnvelopeConversationMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(['assistant', 'user', 'system']),
  content: z.string(),
  timestamp: z.string().min(1)
})
export type FlexEnvelopeConversationMessage = z.infer<typeof FlexEnvelopeConversationMessageSchema>

export const FlexEnvelopeConversationDeltaSchema = z.object({
  summary: z.array(z.string()).default([]),
  missingFields: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  envelope: TaskEnvelopeSchema
})
export type FlexEnvelopeConversationDelta = z.infer<typeof FlexEnvelopeConversationDeltaSchema>

export const FlexEnvelopeConversationResponseSchema = z.object({
  conversationId: z.string().min(1),
  messages: z.array(FlexEnvelopeConversationMessageSchema).default([]),
  delta: FlexEnvelopeConversationDeltaSchema.optional()
})
export type FlexEnvelopeConversationResponse = z.infer<typeof FlexEnvelopeConversationResponseSchema>

/**
 * Core set of event types emitted by the flex orchestrator over SSE.
 */
export const FlexEventTypeSchema = z.enum([
  'start',
  'plan_requested',
  'plan_rejected',
  'plan_generated',
  'plan_updated',
  'node_start',
  'node_complete',
  'node_error',
  'hitl_request',
  'hitl_resolved',
  'validation_error',
  'policy_triggered',
  'policy_update',
  'goal_condition_failed',
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
  message: z.string().optional(),
  planVersion: z.number().int().nonnegative().optional(),
  facetProvenance: FlexFacetProvenanceMapSchema
})
export type FlexEvent = z.infer<typeof FlexEventSchema>

/**
 * Helper describing the payload emitted on `complete` frames.
 */
export type FlexCompleteEventPayload = {
  status?: string
  output?: Record<string, unknown>
  error?: unknown
  policyId?: string
  action?: Record<string, unknown> | null
  goal_condition_results?: GoalConditionResult[]
}

export type FlexCompleteEvent = Omit<FlexEvent, 'type' | 'payload'> & {
  type: 'complete'
  payload?: FlexCompleteEventPayload
}

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

type ContractCarrier = {
  inputContract?: CapabilityContract | null
  outputContract?: CapabilityContract | null
}

type PostConditionCarrier = {
  postConditions?: FacetCondition[] | null
}

function normalizeCapabilityContracts<T extends ContractCarrier>(value: T) {
  const inputContract = value.inputContract ?? null
  const outputContract = value.outputContract ?? null
  return {
    ...value,
    inputContract: inputContract ?? undefined,
    outputContract: outputContract ?? undefined
  }
}

function normalizeCapabilityPayload<T extends ContractCarrier & PostConditionCarrier>(value: T) {
  const contracts = normalizeCapabilityContracts(value)
  return normalizePostConditions(contracts)
}

function ensureCapabilityContracts(value: ContractCarrier, ctx: z.RefinementCtx) {
  if (!value.outputContract) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['outputContract'],
      message: 'Capability registrations must include an `outputContract`.'
    })
  }
}

function normalizePostConditions<T extends PostConditionCarrier>(value: T) {
  if (!value.postConditions) {
    if (value.postConditions === undefined) {
      return value
    }
    const clone = { ...value }
    delete (clone as PostConditionCarrier).postConditions
    return clone
  }
  if (!value.postConditions.length) {
    return {
      ...value,
      postConditions: []
    }
  }
  const compiled = compileCapabilityPostConditions(value.postConditions)
  return {
    ...value,
    postConditions: compiled
  }
}

function compileCapabilityPostConditions(conditions: FacetCondition[]): FacetCondition[] {
  const results: FacetCondition[] = []
  const seen = new Set<string>()

  conditions.forEach((entry, index) => {
    const facet = entry.facet?.trim()
    if (!facet) {
      buildPostConditionError('Facet name must be provided for each post-condition.', index, ['facet'])
    }

    const path = entry.path?.trim()
    if (!path) {
      buildPostConditionError('JSON-pointer path must be provided for each post-condition.', index, ['path'])
    }

    const key = `${facet}::${path}`
    if (seen.has(key)) {
      buildPostConditionError(`Duplicate post-condition for facet "${facet}" at path "${path}".`, index)
    }
    seen.add(key)

    const dsl = entry.condition.dsl?.trim()
    if (!dsl?.length) {
      buildPostConditionError('Condition `dsl` must be a non-empty string.', index, ['condition', 'dsl'])
    }

    let normalized: ConditionValidationResult
    try {
      normalized = normalizeFacetConditionExpression(dsl, entry.condition.jsonLogic)
    } catch (error) {
      if (error instanceof ConditionDslValidationError) {
        const detail = error.errors.map((item) => item.message).join('; ')
        buildPostConditionError(`Invalid condition DSL: ${detail}`, index, ['condition', 'dsl'])
      }
      const message = error instanceof Error ? error.message : 'Invalid condition DSL payload.'
      buildPostConditionError(message, index, ['condition', 'dsl'])
    }

    const warnings = normalized.warnings.length ? normalized.warnings.map((warning) => ({ ...warning })) : undefined
    const variables = normalized.variables.length ? [...normalized.variables] : undefined
    const canonicalDsl = normalized.canonicalDsl ?? entry.condition.canonicalDsl ?? dsl

    results.push({
      facet,
      path,
      condition: {
        dsl,
        canonicalDsl,
        jsonLogic: normalized.jsonLogic,
        ...(warnings ? { warnings } : {}),
        ...(variables ? { variables } : {})
      }
    })
  })

  return results
}

const FALLBACK_OPERATORS: ConditionComparisonOperator[] = ['==', '!=', '>', '>=', '<', '<=']
const BOOLEAN_OPERATORS: ConditionComparisonOperator[] = ['==', '!=']

function normalizeFacetConditionExpression(dsl: string, jsonLogic?: JsonLogicExpression): ConditionValidationResult {
  try {
    return normalizeConditionInput({ dsl, jsonLogic })
  } catch (error) {
    if (!(error instanceof ConditionDslValidationError)) {
      throw error
    }
    const fallbackCatalog = buildFallbackCatalog(dsl, error.errors)
    if (!fallbackCatalog) {
      throw error
    }
    return normalizeConditionInput({ dsl, jsonLogic }, { catalog: fallbackCatalog })
  }
}

function buildFallbackCatalog(
  dsl: string,
  errors: readonly ConditionDslError[]
): ConditionVariableCatalog | null {
  if (!errors.length) return null
  const missing = new Set<string>()
  for (const error of errors) {
    if (error.code !== 'unknown_variable') {
      return null
    }
    const match = error.message.match(/Variable\s+[`'"]?([A-Za-z0-9_.]+)[`'"]?\s+is\s+not\s+registered/i)
    if (!match) {
      return null
    }
    missing.add(match[1])
  }
  if (!missing.size) {
    return null
  }
  const variables = Array.from(missing).map((name) => {
    const type = inferFallbackVariableType(name, dsl)
    const allowedOperators = type === 'boolean' ? BOOLEAN_OPERATORS : FALLBACK_OPERATORS
    return {
      id: `post_condition:${name}`,
      path: name,
      dslPath: name,
      label: name,
      type,
      allowedOperators
    }
  })
  return { variables }
}

function inferFallbackVariableType(variable: string, dsl: string): 'string' | 'number' | 'boolean' {
  const identifier = escapeRegExp(variable)
  const numericPattern = new RegExp(`${identifier}\\s*(?:>=|<=|>|<)`, 'i')
  if (numericPattern.test(dsl)) {
    return 'number'
  }
  const booleanPattern = new RegExp(`${identifier}\\s*(?:==|!=)\\s*(true|false)`, 'i')
  if (booleanPattern.test(dsl)) {
    return 'boolean'
  }
  return 'string'
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildPostConditionError(message: string, index: number, subPath: (string | number)[] = []): never {
  throw new ZodError([
    {
      code: 'custom',
      message,
      path: ['postConditions', index, ...subPath]
    }
  ])
}

const CapabilityRegistrationCoreSchema = z.object({
  capabilityId: z.string().min(1),
  version: z.string().min(1),
  displayName: z.string().min(1),
  summary: z.string().min(1),
  kind: CapabilityKindSchema,
  agentType: AgentTypeSchema.default('ai'),
  inputTraits: InputTraitsSchema,
  inputContract: CapabilityContractSchema.optional(),
  outputContract: CapabilityContractSchema.optional(),
  cost: CostInfoSchema,
  preferredModels: z.array(z.string()).optional(),
  heartbeat: HeartbeatSchema,
  instructionTemplates: InstructionTemplatesSchema.optional(),
  assignmentDefaults: AssignmentDefaultsSchema.optional(),
  metadata: LooseRecordSchema.optional(),
  postConditions: z.array(FacetConditionSchema).optional()
})

/**
 * Payload agents submit during registration to advertise their capabilities.
 */
export const CapabilityRegistrationSchema = CapabilityRegistrationCoreSchema.superRefine(ensureCapabilityContracts).transform(
  (value) => normalizeCapabilityPayload(value)
)
export type CapabilityRegistration = z.infer<typeof CapabilityRegistrationSchema>

/**
 * Persisted capability entry augmented by orchestrator health tracking.
 */
const CapabilityRecordCoreSchema = CapabilityRegistrationCoreSchema.extend({
  status: z.enum(['active', 'inactive']).default('active'),
  lastSeenAt: z.string().optional(),
  registeredAt: z.string().optional()
}).extend({
  inputFacets: z.array(z.string().min(1)).optional(),
  outputFacets: z.array(z.string().min(1)).optional()
})
export const CapabilityRecordSchema = CapabilityRecordCoreSchema.superRefine(ensureCapabilityContracts).transform(
  (value) => normalizeCapabilityPayload(value)
)
export type CapabilityRecord = z.infer<typeof CapabilityRecordSchema>

export const FlexCrcsReasonCodeSchema = z.enum(['path', 'policy_reference', 'goal_condition'])
export type FlexCrcsReasonCode = z.infer<typeof FlexCrcsReasonCodeSchema>

export const FlexCrcsCapabilityEntrySchema = z.object({
  capabilityId: z.string().min(1),
  displayName: z.string().min(1),
  kind: CapabilityKindSchema.default('execution'),
  inputFacets: z.array(z.string().min(1)).default([]),
  outputFacets: z.array(z.string().min(1)).default([]),
  postConditions: z
    .array(
      z.object({
        facet: z.string().min(1),
        path: z.string().min(1),
        expression: z.string().min(1)
      })
    )
    .default([]),
  reasonCodes: z.array(FlexCrcsReasonCodeSchema).nonempty(),
  source: z.enum(['mrcs', 'expansion']).default('expansion')
})
export type FlexCrcsCapabilityEntry = z.infer<typeof FlexCrcsCapabilityEntrySchema>

export const FlexCrcsSummarySchema = z.object({
  totalRows: z.number().int().nonnegative(),
  mrcsSize: z.number().int().nonnegative(),
  reasonCounts: z.record(z.string(), z.number().int().nonnegative()).default({}),
  rowCap: z.number().int().positive().optional(),
  missingPinnedCapabilities: z.number().int().nonnegative().optional()
})
export type FlexCrcsSummary = z.infer<typeof FlexCrcsSummarySchema>

export const FlexCrcsSnapshotSchema = FlexCrcsSummarySchema.extend({
  rows: z.array(FlexCrcsCapabilityEntrySchema),
  truncated: z.boolean().optional(),
  pinnedCapabilityIds: z.array(z.string().min(1)).default([]),
  mrcsCapabilityIds: z.array(z.string().min(1)).default([]),
  missingPinnedCapabilityIds: z.array(z.string().min(1)).default([])
})
export type FlexCrcsSnapshot = z.infer<typeof FlexCrcsSnapshotSchema>
