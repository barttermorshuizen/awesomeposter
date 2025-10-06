import { eq, asc, inArray } from 'drizzle-orm';
import { a as getDb, g as getOrchestratorPersistence, h as hitlRequests, b as hitlResponses } from './orchestrator-persistence.mjs';
import { AsyncLocalStorage } from 'node:async_hooks';
import winston from 'winston';
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
z.object({
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
z.object({
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

const HitlUrgencyEnum = z.enum(["low", "normal", "high"]);
const HitlRequestKindEnum = z.enum(["question", "approval", "choice"]);
const HitlOriginAgentEnum = z.enum(["strategy", "generation", "qa"]);
const HitlOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional()
});
const HitlRequestPayloadSchema = z.object({
  question: z.string().min(1),
  kind: HitlRequestKindEnum.default("question"),
  options: z.array(HitlOptionSchema).default([]),
  allowFreeForm: z.boolean().default(false),
  urgency: HitlUrgencyEnum.default("normal"),
  additionalContext: z.string().optional()
});
const HitlRequestStatusEnum = z.enum(["pending", "resolved", "denied"]);
const HitlResponseTypeEnum = z.enum(["option", "approval", "rejection", "freeform"]);
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
  status: HitlRequestStatusEnum.default("pending"),
  denialReason: z.string().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  metrics: z.object({
    attempt: z.number().int().nonnegative().optional()
  }).optional()
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
const HitlStateEnvelopeSchema = z.object({
  responses: z.array(HitlResponseInputSchema).optional()
});

var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
const EMPTY_STATE = { requests: [], responses: [], pendingRequestId: null, deniedCount: 0 };
const globalStructuredClone = globalThis.structuredClone;
function clone(value) {
  if (value == null) return value;
  try {
    if (typeof globalStructuredClone === "function") return globalStructuredClone(value);
  } catch {
  }
  return JSON.parse(JSON.stringify(value));
}
class DatabaseHitlRepository {
  constructor(dbInstance = getDb(), persistenceInstance = getOrchestratorPersistence()) {
    __publicField(this, "db");
    __publicField(this, "persistence");
    this.db = dbInstance;
    this.persistence = persistenceInstance;
  }
  async create(request) {
    var _a, _b, _c, _d, _e;
    await this.persistence.ensure(request.runId);
    const snapshot = await this.persistence.load(request.runId);
    await this.db.insert(hitlRequests).values({
      id: request.id,
      runId: request.runId,
      briefId: (_a = snapshot.briefId) != null ? _a : null,
      threadId: (_b = request.threadId) != null ? _b : null,
      stepId: (_c = request.stepId) != null ? _c : null,
      originAgent: request.originAgent,
      status: request.status,
      payloadJson: clone(request.payload),
      denialReason: (_d = request.denialReason) != null ? _d : null,
      metricsJson: request.metrics ? clone(request.metrics) : {},
      createdAt: request.createdAt,
      updatedAt: request.updatedAt
    }).onConflictDoUpdate({
      target: hitlRequests.id,
      set: {
        status: request.status,
        payloadJson: clone(request.payload),
        denialReason: (_e = request.denialReason) != null ? _e : null,
        metricsJson: request.metrics ? clone(request.metrics) : {},
        updatedAt: request.updatedAt
      }
    });
  }
  async updateStatus(requestId, status, updates) {
    var _a, _b, _c;
    const now = /* @__PURE__ */ new Date();
    await this.db.update(hitlRequests).set({ status, denialReason: (_a = updates == null ? void 0 : updates.denialReason) != null ? _a : null, updatedAt: now }).where(eq(hitlRequests.id, requestId));
    const record = await this.getRequestById(requestId);
    if (!record) return;
    const state = await this.getRunState(record.runId);
    const nextRequests = state.requests.map(
      (req) => req.id === requestId ? {
        ...req,
        status,
        denialReason: updates == null ? void 0 : updates.denialReason,
        updatedAt: now
      } : req
    );
    const pendingId = (_c = (_b = nextRequests.find((req) => req.status === "pending")) == null ? void 0 : _b.id) != null ? _c : null;
    const nextState = {
      requests: nextRequests,
      responses: [...state.responses],
      pendingRequestId: pendingId,
      deniedCount: nextRequests.filter((req) => req.status === "denied").length
    };
    await this.setRunState(record.runId, nextState);
  }
  async appendResponse(response) {
    var _a, _b, _c, _d, _e;
    const request = await this.getRequestById(response.requestId);
    if (!request) return;
    await this.db.insert(hitlResponses).values({
      id: response.id,
      requestId: response.requestId,
      responseType: response.responseType,
      selectedOptionId: (_a = response.selectedOptionId) != null ? _a : null,
      freeformText: (_b = response.freeformText) != null ? _b : null,
      approved: (_c = response.approved) != null ? _c : null,
      responderId: (_d = response.responderId) != null ? _d : null,
      responderDisplayName: (_e = response.responderDisplayName) != null ? _e : null,
      metadataJson: response.metadata ? clone(response.metadata) : {},
      createdAt: response.createdAt
    });
    await this.db.update(hitlRequests).set({ status: "resolved", updatedAt: new Date(response.createdAt) }).where(eq(hitlRequests.id, response.requestId));
    const updatedState = await this.getRunState(request.runId);
    await this.setRunState(request.runId, updatedState);
  }
  async getRequestById(requestId) {
    const [row] = await this.db.select().from(hitlRequests).where(eq(hitlRequests.id, requestId)).limit(1);
    if (!row) return void 0;
    return this.mapRequest(row);
  }
  async getRunState(runId) {
    var _a, _b, _c, _d, _e;
    await this.persistence.ensure(runId);
    const snapshot = await this.persistence.load(runId);
    const requestRows = await this.db.select().from(hitlRequests).where(eq(hitlRequests.runId, runId)).orderBy(asc(hitlRequests.createdAt));
    const responseRows = requestRows.length ? await this.db.select().from(hitlResponses).where(inArray(hitlResponses.requestId, requestRows.map((row) => row.id))).orderBy(asc(hitlResponses.createdAt)) : [];
    const requests = requestRows.map((row) => this.mapRequest(row));
    const responses = responseRows.map((row) => this.mapResponse(row));
    const pendingFromRequests = (_b = (_a = requests.find((req) => req.status === "pending")) == null ? void 0 : _a.id) != null ? _b : null;
    const fallbackPending = snapshot.pendingRequestId ? (_d = (_c = requests.find((req) => req.id === snapshot.pendingRequestId && req.status === "pending")) == null ? void 0 : _c.id) != null ? _d : null : null;
    const pendingRequestId = (_e = pendingFromRequests != null ? pendingFromRequests : fallbackPending) != null ? _e : null;
    return {
      requests,
      responses,
      pendingRequestId,
      deniedCount: requests.filter((req) => req.status === "denied").length
    };
  }
  async setRunState(runId, state) {
    var _a;
    const snapshot = await this.persistence.load(runId);
    const nextStatus = state.pendingRequestId ? "awaiting_hitl" : snapshot.status === "awaiting_hitl" || snapshot.status === "pending" ? "running" : snapshot.status;
    await this.persistence.save(runId, {
      hitlState: state,
      pendingRequestId: (_a = state.pendingRequestId) != null ? _a : null,
      status: nextStatus
    });
  }
  mapRequest(row) {
    var _a, _b, _c;
    const metrics = row.metricsJson ? clone(row.metricsJson) : void 0;
    return {
      id: row.id,
      runId: row.runId,
      threadId: (_a = row.threadId) != null ? _a : void 0,
      stepId: (_b = row.stepId) != null ? _b : void 0,
      stepStatusAtRequest: void 0,
      originAgent: row.originAgent,
      payload: clone(row.payloadJson),
      status: row.status,
      denialReason: (_c = row.denialReason) != null ? _c : void 0,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
      metrics: metrics && Object.keys(metrics).length > 0 ? metrics : void 0
    };
  }
  mapResponse(row) {
    var _a, _b, _c, _d, _e;
    const metadata = row.metadataJson ? clone(row.metadataJson) : void 0;
    return {
      id: row.id,
      requestId: row.requestId,
      responseType: row.responseType,
      selectedOptionId: (_a = row.selectedOptionId) != null ? _a : void 0,
      freeformText: (_b = row.freeformText) != null ? _b : void 0,
      approved: (_c = row.approved) != null ? _c : void 0,
      responderId: (_d = row.responderId) != null ? _d : void 0,
      responderDisplayName: (_e = row.responderDisplayName) != null ? _e : void 0,
      createdAt: new Date(row.createdAt),
      metadata: metadata && Object.keys(metadata).length > 0 ? metadata : void 0
    };
  }
}
class InMemoryHitlRepository {
  constructor() {
    __publicField(this, "requests", /* @__PURE__ */ new Map());
    __publicField(this, "responses", /* @__PURE__ */ new Map());
    __publicField(this, "runSnapshots", /* @__PURE__ */ new Map());
  }
  async create(request) {
    this.requests.set(request.id, clone(request));
    const state = await this.getRunState(request.runId);
    const others = state.requests.filter((r) => r.id !== request.id);
    this.runSnapshots.set(request.runId, {
      requests: [...others, clone(request)],
      responses: [...state.responses],
      pendingRequestId: request.status === "pending" ? request.id : state.pendingRequestId,
      deniedCount: state.deniedCount + (request.status === "denied" ? 1 : 0)
    });
  }
  async updateStatus(requestId, status, updates) {
    var _a, _b;
    const record = this.requests.get(requestId);
    if (!record) return;
    const next = { ...record, status, denialReason: updates == null ? void 0 : updates.denialReason, updatedAt: /* @__PURE__ */ new Date() };
    this.requests.set(requestId, next);
    const state = await this.getRunState(record.runId);
    const requests = state.requests.map((req) => req.id === requestId ? next : req);
    const pendingId = (_b = (_a = requests.find((req) => req.status === "pending")) == null ? void 0 : _a.id) != null ? _b : null;
    this.runSnapshots.set(record.runId, {
      requests,
      responses: state.responses.map((r) => ({ ...r })),
      pendingRequestId: pendingId,
      deniedCount: requests.filter((req) => req.status === "denied").length
    });
  }
  async appendResponse(response) {
    const list = this.responses.get(response.requestId) || [];
    list.push(clone(response));
    this.responses.set(response.requestId, list);
    const request = this.requests.get(response.requestId);
    if (!request) return;
    await this.updateStatus(response.requestId, "resolved");
    const state = await this.getRunState(request.runId);
    this.runSnapshots.set(request.runId, {
      ...state,
      responses: [...state.responses, clone(response)],
      pendingRequestId: state.pendingRequestId === response.requestId ? null : state.pendingRequestId
    });
  }
  async getRequestById(requestId) {
    const record = this.requests.get(requestId);
    return record ? clone(record) : void 0;
  }
  async getRunState(runId) {
    var _a;
    const snap = this.runSnapshots.get(runId);
    if (!snap) {
      this.runSnapshots.set(runId, clone(EMPTY_STATE));
      return clone(EMPTY_STATE);
    }
    return {
      requests: snap.requests.map((r) => clone(r)),
      responses: snap.responses.map((r) => clone(r)),
      pendingRequestId: (_a = snap.pendingRequestId) != null ? _a : null,
      deniedCount: snap.deniedCount
    };
  }
  async setRunState(runId, state) {
    var _a;
    this.runSnapshots.set(runId, {
      requests: state.requests.map((r) => clone(r)),
      responses: state.responses.map((r) => clone(r)),
      pendingRequestId: (_a = state.pendingRequestId) != null ? _a : null,
      deniedCount: state.deniedCount
    });
    for (const request of state.requests) {
      this.requests.set(request.id, clone(request));
    }
    for (const response of state.responses) {
      const list = this.responses.get(response.requestId) || [];
      list.push(clone(response));
      this.responses.set(response.requestId, list);
    }
  }
}
let activeRepository = null;
function getHitlRepository() {
  if (!activeRepository) {
    if (process.env.DATABASE_URL) {
      try {
        activeRepository = new DatabaseHitlRepository();
      } catch {
        activeRepository = new InMemoryHitlRepository();
      }
    } else {
      activeRepository = new InMemoryHitlRepository();
    }
  }
  return activeRepository;
}

const storage = new AsyncLocalStorage();
function getHitlContext() {
  return storage.getStore();
}

let logger = null;
function getLogger() {
  if (logger) return logger;
  const level = process.env.LOG_LEVEL || "info";
  const baseFormat = winston.format.json() ;
  logger = winston.createLogger({
    level,
    defaultMeta: { service: "agents-server" },
    transports: [new winston.transports.Console({ format: baseFormat })]
  });
  return logger;
}
function genCorrelationId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `cid_${Math.random().toString(36).slice(2)}`;
  }
}

const DEFAULT_FALLBACK_QUESTION = "Human assistance required to continue this orchestration step.";
const HitlOptionForTool = HitlOptionSchema.extend({
  description: z.string().nullable().default(null)
});
z.object({
  question: z.string().min(1, "question is required"),
  kind: HitlRequestKindEnum.default("question"),
  options: z.array(HitlOptionForTool).default([]),
  allowFreeForm: z.boolean().default(true),
  urgency: HitlUrgencyEnum.default("normal"),
  additionalContext: z.string().nullable().optional()
});

const DEFAULT_MAX_REQUESTS = Number.parseInt(process.env.HITL_MAX_REQUESTS || "", 10) || 3;
class HitlService {
  constructor(repo = getHitlRepository()) {
    this.repo = repo;
  }
  getMaxRequestsPerRun() {
    return DEFAULT_MAX_REQUESTS;
  }
  async loadRunState(runId) {
    return this.repo.getRunState(runId);
  }
  async persistRunState(runId, state) {
    await this.repo.setRunState(runId, state);
  }
  async raiseRequest(rawPayload) {
    var _a, _b;
    const ctx = getHitlContext();
    if (!ctx) {
      throw new Error("HITL context unavailable for request");
    }
    const payload = HitlRequestPayloadSchema.parse(rawPayload);
    if (payload.question === DEFAULT_FALLBACK_QUESTION) {
      try {
        getLogger().warn("hitl_request_fallback_used", { runId: ctx.runId, capabilityId: ctx.capabilityId });
      } catch {
      }
    }
    const originAgent = (_a = ctx.capabilityId) != null ? _a : "strategy";
    const limitMax = ctx.limit.max;
    const currentAccepted = ctx.limit.current;
    const reasonTooMany = "Too many HITL requests";
    const now = /* @__PURE__ */ new Date();
    const request = {
      id: genCorrelationId(),
      runId: ctx.runId,
      threadId: ctx.threadId,
      stepId: ctx.stepId,
      stepStatusAtRequest: void 0,
      originAgent,
      payload,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      metrics: { attempt: currentAccepted + 1 }
    };
    if (currentAccepted >= limitMax) {
      request.status = "denied";
      request.denialReason = reasonTooMany;
      await this.repo.create(request);
      ctx.snapshot = {
        ...ctx.snapshot,
        requests: [...ctx.snapshot.requests.filter((r) => r.id !== request.id), request],
        pendingRequestId: (_b = ctx.snapshot.pendingRequestId) != null ? _b : null,
        deniedCount: ctx.snapshot.deniedCount + 1
      };
      await this.repo.setRunState(ctx.runId, ctx.snapshot);
      try {
        getLogger().info("hitl_request_denied", {
          requestId: request.id,
          runId: ctx.runId,
          originAgent,
          limitMax,
          limitUsed: currentAccepted,
          reason: reasonTooMany
        });
      } catch {
      }
      ctx.onDenied(reasonTooMany, ctx.snapshot);
      return { status: "denied", reason: reasonTooMany, request };
    }
    await this.repo.create(request);
    ctx.limit.current = currentAccepted + 1;
    ctx.snapshot = {
      ...ctx.snapshot,
      requests: [...ctx.snapshot.requests.filter((r) => r.id !== request.id), request],
      pendingRequestId: request.id,
      deniedCount: ctx.snapshot.deniedCount
    };
    await this.repo.setRunState(ctx.runId, ctx.snapshot);
    try {
      getLogger().info("hitl_request_created", {
        requestId: request.id,
        runId: ctx.runId,
        originAgent,
        limitUsed: ctx.limit.current,
        limitMax
      });
    } catch {
    }
    ctx.onRequest(request, ctx.snapshot);
    return { status: "pending", request };
  }
  async registerDenied(requestId, reason) {
    await this.repo.updateStatus(requestId, "denied", { denialReason: reason });
  }
  async applyResponses(runId, responses) {
    if (!responses || responses.length === 0) return this.repo.getRunState(runId);
    const parsed = responses.map((r) => HitlResponseInputSchema.parse(r));
    for (const response of parsed) {
      const existing = await this.repo.getRequestById(response.requestId);
      if (!existing) continue;
      const record = {
        id: genCorrelationId(),
        requestId: response.requestId,
        responseType: response.responseType || (typeof response.approved === "boolean" ? response.approved ? "approval" : "rejection" : response.selectedOptionId ? "option" : "freeform"),
        selectedOptionId: response.selectedOptionId,
        freeformText: response.freeformText,
        approved: response.approved,
        responderId: response.responderId,
        responderDisplayName: response.responderDisplayName,
        createdAt: /* @__PURE__ */ new Date(),
        metadata: response.metadata
      };
      await this.repo.appendResponse(record);
      try {
        getLogger().info("hitl_response_recorded", {
          requestId: record.requestId,
          runId,
          responseType: record.responseType
        });
      } catch {
      }
    }
    return this.repo.getRunState(runId);
  }
  parseEnvelope(raw) {
    var _a;
    if (!raw) return null;
    const parsed = HitlStateEnvelopeSchema.safeParse(raw);
    if (!parsed.success) return null;
    const responses = (_a = parsed.data.responses) != null ? _a : [];
    return { responses };
  }
}
let singleton = null;
function getHitlService() {
  if (!singleton) singleton = new HitlService();
  return singleton;
}

export { getLogger as a, getHitlService as g };
//# sourceMappingURL=hitl-service.mjs.map
