import { d as defineEventHandler, r as readBody, c as createError } from '../../../nitro/nitro.mjs';
import { z } from 'zod';
import { r as requireApiAuth } from '../../../_/api-auth.mjs';
import { g as getOrchestratorPersistence } from '../../../_/orchestrator-persistence.mjs';
import { g as getHitlService, a as getLogger } from '../../../_/hitl-service.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';
import 'drizzle-orm';
import 'drizzle-orm/pg-core';
import 'drizzle-orm/node-postgres';
import 'pg';
import 'node:async_hooks';
import 'winston';

const AgentModeEnum = z.enum(['app', 'chat']);
const TargetAgentIdEnum = z.enum(['orchestrator', 'strategy', 'generator', 'qa']);
const AgentRunOptionsSchema = z.object({
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
}).optional();
z.object({
    mode: AgentModeEnum,
    objective: z.string().min(1),
    threadId: z.string().optional(),
    briefId: z.string().optional(),
    state: z.any().optional(),
    options: AgentRunOptionsSchema
});
// Generic event envelope for SSE
z.object({
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
});
// QA report schema: canonical structure produced by the QA agent/tool.
// This is used by both server (validation/normalization) and UI (rendering).
z
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
    .passthrough();
// Default structured output for app mode
// For OpenAI structured outputs, all fields must be required; use nullable for optional semantics.
// AppResult for app mode (aligned):
// - result: the final single post content and its target platform
// - rationale: short strategy rationale (nullable)
// - knobSettings: 4‑knob configuration chosen by Strategy (best‑effort, pass‑through)
// - quality-report: QA agent's evaluation output (pass‑through)
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
    ['quality-report']: z.any().optional()
});
// Final bundle schema for App mode ({ result, quality, acceptance-report })
const FinalQualitySchema = z.object({
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
    ['acceptance-report']: AcceptanceReportSchema
});
// Planning types and schemas for orchestrator-driven plan updates
const PlanStepStatusEnum = z.enum(['pending', 'in_progress', 'done', 'skipped']);
// Non-handoff actions reserved for the orchestrator (e.g., finalize)
const PlanActionEnum = z.enum(['finalize']);
// Capability-driven plan step schema.
// Either capabilityId (for a handoff-able step) OR action (for non-handoff steps like finalize).
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
// Minimal patch format used by orchestrator LLM outputs to evolve the plan.
// - stepsAdd: add new steps (id must be unique)
// - stepsUpdate: update status and/or note of existing steps by id
// - stepsRemove: remove steps by id
z.object({
    stepsAdd: z.array(PlanStepSchema).optional(),
    stepsUpdate: z.array(PlanStepUpdateSchema).optional(),
    stepsRemove: z.array(z.string()).optional(),
    note: z.string().optional()
});
// Shared step result schema used by orchestrator and specialists.
// - stepId: identifier of the plan step this result corresponds to
// - output: arbitrary structured data produced by the step
// - error: optional error message if the step failed
// - metrics: optional structured metrics (token usage, timings, etc.)
const StepResultSchema = z.object({
    stepId: z.string(),
    output: z.any().optional(),
    error: z.string().optional(),
    metrics: z.record(z.any()).optional(),
});
// Aggregate run report consisting of step results and optional summary data.
z.object({
    steps: z.array(StepResultSchema),
    summary: z.any().optional(),
});

const HitlUrgencyEnum = z.enum(['low', 'normal', 'high']);
const HitlRequestKindEnum = z.enum(['question', 'approval', 'choice']);
const HitlOriginAgentEnum = z.enum(['strategy', 'generation', 'qa']);
const HitlOptionSchema = z.object({
    id: z.string(),
    label: z.string(),
    description: z.string().optional()
});
const HitlRequestPayloadSchema = z.object({
    question: z.string().min(1),
    kind: HitlRequestKindEnum.default('question'),
    options: z.array(HitlOptionSchema).default([]),
    allowFreeForm: z.boolean().default(false),
    urgency: HitlUrgencyEnum.default('normal'),
    additionalContext: z.string().optional()
});
const HitlRequestStatusEnum = z.enum(['pending', 'resolved', 'denied']);
const HitlResponseTypeEnum = z.enum(['option', 'approval', 'rejection', 'freeform']);
const HitlResponseSchema = z.object({
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
});
const HitlRequestRecordSchema = z.object({
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
    metrics: z
        .object({
        attempt: z.number().int().nonnegative().optional()
    })
        .optional()
});
z.object({
    requests: z.array(HitlRequestRecordSchema).default([]),
    responses: z.array(HitlResponseSchema).default([]),
    pendingRequestId: z.string().nullable().optional(),
    deniedCount: z.number().int().nonnegative().default(0)
});
const HitlResponseInputSchema = z.object({
    requestId: z.string(),
    responseType: HitlResponseTypeEnum.optional(),
    selectedOptionId: z.string().optional(),
    freeformText: z.string().optional(),
    approved: z.boolean().optional(),
    responderId: z.string().optional(),
    responderDisplayName: z.string().optional(),
    metadata: z.record(z.any()).optional()
});
z.object({
    responses: z.array(HitlResponseInputSchema).optional()
});

const ResumeRequestSchema = z.object({
  runId: z.string().optional(),
  threadId: z.string().optional(),
  requestId: z.string().min(1),
  responses: z.array(HitlResponseInputSchema).min(1),
  operator: z.object({
    id: z.string().optional(),
    displayName: z.string().optional(),
    email: z.string().optional()
  }).optional(),
  note: z.string().optional()
}).refine((data) => data.runId || data.threadId, {
  message: "runId or threadId is required",
  path: ["runId"]
}).refine((data) => data.responses.every((res) => res.requestId === data.requestId), {
  message: "responses must reference requestId",
  path: ["responses"]
});
const resume_post = defineEventHandler(async (event) => {
  var _a, _b, _c, _d, _e, _f, _g;
  requireApiAuth(event);
  const body = await readBody(event);
  const payload = ResumeRequestSchema.parse(body);
  const persistence = getOrchestratorPersistence();
  let resolvedRunId = (_a = payload.runId) != null ? _a : null;
  let snapshot = resolvedRunId ? await persistence.load(resolvedRunId) : null;
  if (!resolvedRunId && payload.threadId) {
    const found = await persistence.findByThreadId(payload.threadId);
    if (!found) {
      throw createError({ statusCode: 404, statusMessage: "Thread not found" });
    }
    resolvedRunId = found.runId;
    snapshot = found.snapshot;
  }
  if (!resolvedRunId || !snapshot) {
    throw createError({ statusCode: 404, statusMessage: "Run not found" });
  }
  const pendingRequest = snapshot.hitlState.requests.find((req) => req.id === payload.requestId);
  if (!pendingRequest) {
    throw createError({ statusCode: 404, statusMessage: "Request not found for run" });
  }
  if (pendingRequest.status !== "pending") {
    throw createError({ statusCode: 409, statusMessage: "Request already resolved" });
  }
  if (snapshot.pendingRequestId && snapshot.pendingRequestId !== payload.requestId) {
    throw createError({ statusCode: 409, statusMessage: "Run waiting on a different request" });
  }
  const hitlService = getHitlService();
  const updatedState = await hitlService.applyResponses(resolvedRunId, payload.responses);
  const refreshed = await persistence.load(resolvedRunId);
  const metadata = refreshed.runnerMetadata || {};
  const auditLog = Array.isArray(metadata.auditLog) ? [...metadata.auditLog] : [];
  auditLog.push({
    action: "resume",
    requestId: payload.requestId,
    operator: (_b = payload.operator) != null ? _b : null,
    note: (_c = payload.note) != null ? _c : null,
    at: (/* @__PURE__ */ new Date()).toISOString()
  });
  const runnerMetadata = {
    ...metadata,
    auditLog,
    lastResumeAt: (/* @__PURE__ */ new Date()).toISOString(),
    lastOperator: (_e = (_d = payload.operator) != null ? _d : metadata.lastOperator) != null ? _e : null
  };
  await persistence.save(resolvedRunId, {
    pendingRequestId: (_f = updatedState.pendingRequestId) != null ? _f : null,
    status: "running",
    runnerMetadata
  });
  try {
    getLogger().info("hitl_resume_api", {
      runId: resolvedRunId,
      requestId: payload.requestId,
      responses: updatedState.responses.length
    });
  } catch {
  }
  return {
    ok: true,
    runId: resolvedRunId,
    status: "running",
    pendingRequestId: (_g = updatedState.pendingRequestId) != null ? _g : null,
    requests: updatedState.requests,
    responses: updatedState.responses
  };
});

export { resume_post as default };
//# sourceMappingURL=resume.post.mjs.map
