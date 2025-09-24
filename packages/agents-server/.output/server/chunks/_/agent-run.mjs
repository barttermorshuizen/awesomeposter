import { z } from 'zod';

const AgentModeEnum = z.enum(["app", "chat"]);
const TargetAgentIdEnum = z.enum(["orchestrator", "strategy", "generator", "qa"]);
const AgentRunOptionsSchema = z.object({
  toolPolicy: z.enum(["auto", "required", "off"]).default("auto").optional(),
  schemaName: z.string().optional(),
  systemPromptOverride: z.string().max(8e3).optional(),
  toolsAllowlist: z.array(z.string()).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTurns: z.number().int().positive().optional(),
  // Per-run override: how many QA revision cycles to allow before finalizing
  maxRevisionCycles: z.number().int().min(0).optional(),
  qualityThreshold: z.number().min(0).max(1).optional(),
  trace: z.boolean().optional(),
  // For chat mode only: choose which agent to converse with
  targetAgentId: TargetAgentIdEnum.optional()
}).optional();
const AgentRunRequestSchema = z.object({
  mode: AgentModeEnum,
  objective: z.string().min(1),
  threadId: z.string().optional(),
  briefId: z.string().optional(),
  state: z.any().optional(),
  options: AgentRunOptionsSchema
});
z.object({
  type: z.enum([
    "start",
    "phase",
    "plan_update",
    "tool_call",
    "tool_result",
    "message",
    "delta",
    "handoff",
    "prompt_preview",
    "metrics",
    "warning",
    "error",
    "complete"
  ]),
  phase: z.enum(["analysis", "planning", "generation", "qa", "finalization", "idle"]).optional(),
  message: z.string().optional(),
  data: z.any().optional(),
  tokens: z.number().optional(),
  durationMs: z.number().optional(),
  correlationId: z.string().optional()
});
z.object({
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
}).passthrough();
const PostResultSchema = z.object({
  content: z.string(),
  platform: z.string()
}).passthrough();
const KnobSettingsSchema = z.object({
  formatType: z.string().optional(),
  hookIntensity: z.union([z.number(), z.string()]).optional(),
  expertiseDepth: z.union([z.number(), z.string()]).optional(),
  structure: z.union([
    z.string(),
    z.object({ lengthLevel: z.number().optional(), scanDensity: z.number().optional() }).passthrough()
  ]).optional()
}).passthrough();
z.object({
  result: PostResultSchema,
  rationale: z.string().nullable(),
  knobSettings: KnobSettingsSchema.optional(),
  ["quality-report"]: z.any().optional()
});
const FinalQualitySchema = z.object({
  score: z.number().min(0).max(1).nullable().optional(),
  issues: z.array(z.string()).optional(),
  // metrics are explicit to improve UI reliability, but we allow passthrough for
  // future dimensions. The known keys are typed for 0..1 numeric values.
  metrics: z.object({
    readability: z.number().min(0).max(1).optional(),
    clarity: z.number().min(0).max(1).optional(),
    objectiveFit: z.number().min(0).max(1).optional(),
    brandRisk: z.number().min(0).max(1).optional(),
    compliance: z.boolean().optional(),
    composite: z.number().min(0).max(1).optional()
  }).passthrough().optional(),
  pass: z.boolean().optional()
});
const AcceptanceCriterionSchema = z.object({
  criterion: z.string(),
  passed: z.boolean(),
  details: z.string().optional()
});
const AcceptanceReportSchema = z.object({
  overall: z.boolean(),
  criteria: z.array(AcceptanceCriterionSchema).default([])
});
z.object({
  result: z.any(),
  quality: FinalQualitySchema,
  ["acceptance-report"]: AcceptanceReportSchema
});
const PlanStepStatusEnum = z.enum(["pending", "in_progress", "done", "skipped"]);
const PlanActionEnum = z.enum(["finalize"]);
const PlanStepSchema = z.object({
  id: z.string(),
  capabilityId: z.string().min(1).optional(),
  action: PlanActionEnum.optional(),
  label: z.string().optional(),
  status: PlanStepStatusEnum,
  note: z.string().optional()
});
z.object({
  version: z.number().int().nonnegative().default(0),
  steps: z.array(PlanStepSchema)
});
const PlanStepUpdateSchema = z.object({
  id: z.string(),
  status: PlanStepStatusEnum.optional(),
  note: z.string().optional()
});
const PlanPatchSchema = z.object({
  stepsAdd: z.array(PlanStepSchema).optional(),
  stepsUpdate: z.array(PlanStepUpdateSchema).optional(),
  stepsRemove: z.array(z.string()).optional(),
  note: z.string().optional()
});
const StepResultSchema = z.object({
  stepId: z.string(),
  output: z.any().optional(),
  error: z.string().optional(),
  metrics: z.record(z.any()).optional()
});
z.object({
  steps: z.array(StepResultSchema),
  summary: z.any().optional()
});

export { AgentRunRequestSchema as A, PlanPatchSchema as P, PlanStepStatusEnum as a };
//# sourceMappingURL=agent-run.mjs.map
