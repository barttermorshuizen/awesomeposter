import { z } from 'zod'

export const AgentModeEnum = z.enum(['app', 'chat'])
export type AgentMode = z.infer<typeof AgentModeEnum>

export const TargetAgentIdEnum = z.enum(['orchestrator', 'strategy', 'generator', 'qa'])
export type TargetAgentId = z.infer<typeof TargetAgentIdEnum>

export const AgentRunOptionsSchema = z.object({
  toolPolicy: z.enum(['auto', 'required', 'off']).default('auto').optional(),
  schemaName: z.string().optional(),
  systemPromptOverride: z.string().max(8000).optional(),
  toolsAllowlist: z.array(z.string()).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTurns: z.number().int().positive().optional(),
  // Per-run override: how many QA revision cycles to allow before finalizing
  maxRevisionCycles: z.number().int().min(0).optional(),
  qualityThreshold: z.number().min(0).max(1).optional(),
  trace: z.boolean().optional(),
  // For chat mode only: choose which agent to converse with
  targetAgentId: TargetAgentIdEnum.optional()
}).optional()

export const AgentRunRequestSchema = z.object({
  mode: AgentModeEnum,
  objective: z.string().min(1),
  threadId: z.string().optional(),
  briefId: z.string().optional(),
  state: z.any().optional(),
  options: AgentRunOptionsSchema
})
export type AgentRunRequest = z.infer<typeof AgentRunRequestSchema>

// Generic event envelope for SSE
export const AgentEventSchema = z.object({
  type: z.enum([
    'start',
    'phase',
    'plan_update',
    'tool_call',
    'tool_result',
    'message',
    'delta',
    'handoff',
    'prompt_preview',
    'metrics',
    'warning',
    'error',
    'complete'
  ]),
  phase: z.enum(['analysis', 'planning', 'generation', 'qa', 'finalization', 'idle']).optional(),
  message: z.string().optional(),
  data: z.any().optional(),
  tokens: z.number().optional(),
  durationMs: z.number().optional(),
  correlationId: z.string().optional()
})
export type AgentEvent = z.infer<typeof AgentEventSchema>

// QA report schema: canonical structure produced by the QA agent/tool.
// This is used by both server (validation/normalization) and UI (rendering).
export const QAReportSchema = z
  .object({
    // Primary, normalized fields
    composite: z.number().min(0).max(1).optional(),
    compliance: z.boolean().optional(),
    readability: z.number().min(0).max(1).optional(),
    clarity: z.number().min(0).max(1).optional(),
    objectiveFit: z.number().min(0).max(1).optional(),
    brandRisk: z.number().min(0).max(1).optional(),
    // Recommendations: canonical field is contentRecommendations (strings)
    contentRecommendations: z.array(z.string()).optional(),
    // Back-compat aliases (accepted but not preferred)
    suggestedChanges: z.array(z.string()).optional(),
    Suggestions: z.array(z.string()).optional()
  })
  .passthrough()
export type QAReport = z.infer<typeof QAReportSchema>

// Default structured output for app mode
// For OpenAI structured outputs, all fields must be required; use nullable for optional semantics.
// AppResult for app mode (aligned):
// - result: the final single post content and its target platform
// - rationale: short strategy rationale (nullable)
// - knobSettings: 4‑knob configuration chosen by Strategy (best‑effort, pass‑through)
// - quality-report: QA agent's evaluation output (pass‑through)
export const PostResultSchema = z.object({
  content: z.string(),
  platform: z.string()
}).passthrough()

export const KnobSettingsSchema = z.object({
  formatType: z.string().optional(),
  hookIntensity: z.union([z.number(), z.string()]).optional(),
  expertiseDepth: z.union([z.number(), z.string()]).optional(),
  structure: z.union([
    z.string(),
    z.object({ lengthLevel: z.number().optional(), scanDensity: z.number().optional() }).passthrough()
  ]).optional()
}).passthrough()

export const AppResultSchema = z.object({
  result: PostResultSchema,
  rationale: z.string().nullable(),
  knobSettings: KnobSettingsSchema.optional(),
  ['quality-report']: z.any().optional()
})
export type AppResult = z.infer<typeof AppResultSchema>


// Final bundle schema for App mode ({ result, quality, acceptance-report })
export const FinalQualitySchema = z.object({
  score: z.number().min(0).max(1).nullable().optional(),
  issues: z.array(z.string()).optional(),
  // metrics are explicit to improve UI reliability, but we allow passthrough for
  // future dimensions. The known keys are typed for 0..1 numeric values.
  metrics: z
    .object({
      readability: z.number().min(0).max(1).optional(),
      clarity: z.number().min(0).max(1).optional(),
      objectiveFit: z.number().min(0).max(1).optional(),
      brandRisk: z.number().min(0).max(1).optional(),
      compliance: z.boolean().optional(),
      composite: z.number().min(0).max(1).optional()
    })
    .passthrough()
    .optional(),
  pass: z.boolean().optional()
})
export type FinalQuality = z.infer<typeof FinalQualitySchema>

export const AcceptanceCriterionSchema = z.object({
  criterion: z.string(),
  passed: z.boolean(),
  details: z.string().optional()
})
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>

export const AcceptanceReportSchema = z.object({
  overall: z.boolean(),
  criteria: z.array(AcceptanceCriterionSchema).default([])
})
export type AcceptanceReport = z.infer<typeof AcceptanceReportSchema>

export const FinalBundleSchema = z.object({
  result: z.any(),
  quality: FinalQualitySchema,
  ['acceptance-report']: AcceptanceReportSchema
})
export type FinalBundle = z.infer<typeof FinalBundleSchema>


// Planning types and schemas for orchestrator-driven plan updates



export const PlanStepStatusEnum = z.enum(['pending', 'in_progress', 'done', 'skipped'])
export type PlanStepStatus = z.infer<typeof PlanStepStatusEnum>

// Non-handoff actions reserved for the orchestrator (e.g., finalize)
export const PlanActionEnum = z.enum(['finalize'])
export type PlanAction = z.infer<typeof PlanActionEnum>

// Capability-driven plan step schema.
// Either capabilityId (for a handoff-able step) OR action (for non-handoff steps like finalize).
export const PlanStepSchema = z.object({
 id: z.string(),
 capabilityId: z.string().min(1).optional(),
 action: PlanActionEnum.optional(),
 label: z.string().optional(),
 status: PlanStepStatusEnum,
 note: z.string().optional()
})
export type PlanStep = z.infer<typeof PlanStepSchema>

export const PlanSchema = z.object({
 version: z.number().int().nonnegative().default(0),
 steps: z.array(PlanStepSchema)
})
export type Plan = z.infer<typeof PlanSchema>

export const PlanStepUpdateSchema = z.object({
 id: z.string(),
 status: PlanStepStatusEnum.optional(),
 note: z.string().optional()
})
export type PlanStepUpdate = z.infer<typeof PlanStepUpdateSchema>

// Minimal patch format used by orchestrator LLM outputs to evolve the plan.
// - stepsAdd: add new steps (id must be unique)
// - stepsUpdate: update status and/or note of existing steps by id
// - stepsRemove: remove steps by id
export const PlanPatchSchema = z.object({
  stepsAdd: z.array(PlanStepSchema).optional(),
  stepsUpdate: z.array(PlanStepUpdateSchema).optional(),
  stepsRemove: z.array(z.string()).optional(),
  note: z.string().optional()
})
export type PlanPatch = z.infer<typeof PlanPatchSchema>

// Shared step result schema used by orchestrator and specialists.
// - stepId: identifier of the plan step this result corresponds to
// - output: arbitrary structured data produced by the step
// - error: optional error message if the step failed
// - metrics: optional structured metrics (token usage, timings, etc.)
export const StepResultSchema = z.object({
  stepId: z.string(),
  output: z.any().optional(),
  error: z.string().optional(),
  metrics: z.record(z.any()).optional(),
})
export type StepResult = z.infer<typeof StepResultSchema>

// Aggregate run report consisting of step results and optional summary data.
export const RunReportSchema = z.object({
  steps: z.array(StepResultSchema),
  summary: z.any().optional(),
})
export type RunReport = z.infer<typeof RunReportSchema>
