import { z, ZodObject } from 'zod';
import { tool, Runner, Agent } from '@openai/agents';
import { g as getDefaultModelName } from './model.mjs';
import { getLogger, genCorrelationId } from './logger.mjs';
import { g as getDb, o as orchestratorRuns, h as hitlRequests, c as hitlResponses, b as briefs, d as clients, a as assets, e as getClientProfileByClientId } from './index.mjs';
import { eq, and, isNotNull, asc, inArray } from 'drizzle-orm';
import { AsyncLocalStorage } from 'node:async_hooks';
import { a as PlanStepStatusEnum } from './agent-run.mjs';

const scoringWeights = {
  readability: 0.35,
  objectiveFit: 0.35,
  clarity: 0.2,
  brandRisk: -0.2
  // magnitude used in composite; brand risk is applied inversely (brandSafety = 1 - brandRisk) with an offset to preserve scale
};
const agentThresholds = {
  minCompositeScore: 0.78,
  maxBrandRisk: 0.2};

const clamp01 = (n) => Math.max(0, Math.min(1, n));
function computeCompositeScore({ readability, clarity, objectiveFit, brandRisk }, opts) {
  const r = clamp01(Number(readability != null ? readability : 0));
  const c = clamp01(Number(clarity != null ? clarity : 0));
  const o = clamp01(Number(objectiveFit != null ? objectiveFit : 0));
  const br = clamp01(Number(brandRisk != null ? brandRisk : 0));
  const base = scoringWeights;
  let w = base;
  if ((opts == null ? void 0 : opts.weights) && typeof opts.weights === "object") {
    w = { ...base, ...opts.weights };
  } else if (opts == null ? void 0 : opts.platform) {
    const p = String(opts.platform).toLowerCase();
    if (p === "linkedin") {
      w = { ...base, readability: 0.4, clarity: 0.25, objectiveFit: 0.25, brandRisk: -0.2 };
    } else if (p === "x" || p === "twitter") {
      w = { ...base, readability: 0.25, clarity: 0.35, objectiveFit: 0.3, brandRisk: -0.2 };
    } else {
      w = base;
    }
  }
  const brW = Math.abs(w.brandRisk);
  const score = r * w.readability + o * w.objectiveFit + c * w.clarity + brW * (1 - br) - brW;
  return clamp01(score);
}

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

var __defProp$2 = Object.defineProperty;
var __defNormalProp$2 = (obj, key, value) => key in obj ? __defProp$2(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField$2 = (obj, key, value) => __defNormalProp$2(obj, typeof key !== "symbol" ? key + "" : key, value);
function extractResponseText(res) {
  try {
    const outputs = res.output || res.outputs || [];
    for (const o of outputs) {
      const content = (o == null ? void 0 : o.content) || [];
      for (const part of content) {
        if ((part.type === "output_text" || part.type === "text") && typeof part.text === "string") {
          return part.text;
        }
      }
    }
  } catch {
  }
  return (res == null ? void 0 : res.output_text) || "";
}
class AgentRuntime {
  constructor() {
    __publicField$2(this, "model", getDefaultModelName());
    __publicField$2(this, "tools", []);
    if (!process.env.OPENAI_API_KEY) {
      try {
        getLogger().warn("openai_api_key_missing");
      } catch {
        console.warn("[AgentRuntime] OPENAI_API_KEY not set; SDK calls will fail");
      }
    }
  }
  registerTool(tool) {
    this.tools.push(tool);
  }
  getModel() {
    return this.model;
  }
  // Return wrapped agent tools, with support for allowlists and policy
  // Backward compatible signature: getAgentTools(allowlist?: string[], onEvent?: ...)
  // New signature: getAgentTools(options?: { allowlist?: string[]; policy?: 'auto' | 'required' | 'off'; requestAllowlist?: string[] }, onEvent?: ...)
  getAgentTools(allowlistOrOptions, onEvent) {
    const opts = Array.isArray(allowlistOrOptions) ? { allowlist: allowlistOrOptions } : allowlistOrOptions || {};
    const policy = opts.policy;
    if (policy === "off") {
      return [];
    }
    const listA = opts.allowlist;
    const listB = opts.requestAllowlist;
    const combineAllowlist = (a, b) => {
      if (a && a.length && b && b.length) return a.filter((n) => b.includes(n));
      return (a && a.length ? a : b) || void 0;
    };
    const finalAllowlist = combineAllowlist(listA, listB);
    const selected = finalAllowlist && finalAllowlist.length > 0 ? this.tools.filter((t) => finalAllowlist.includes(t.name)) : this.tools;
    return selected.map((t) => {
      const paramsSchema = t.parameters instanceof ZodObject ? t.parameters : z.object({});
      return tool({
        name: t.name,
        description: t.description,
        parameters: paramsSchema,
        execute: async (input) => {
          var _a, _b;
          const start = Date.now();
          onEvent == null ? void 0 : onEvent({ type: "tool_call", name: t.name, args: input });
          let args = input;
          const schema = t.parameters;
          if (schema && typeof schema.safeParse === "function") {
            const parsed = schema.safeParse(input);
            if (!parsed.success) {
              const issues = (_b = (_a = parsed.error) == null ? void 0 : _a.issues) == null ? void 0 : _b.map((i) => ({
                path: i.path,
                message: i.message,
                code: i.code
              }));
              try {
                getLogger().warn("tool_invalid_args", { tool: t.name, issues });
              } catch {
              }
              const res = { error: true, code: "INVALID_ARGUMENT", message: "Invalid tool arguments", issues };
              onEvent == null ? void 0 : onEvent({ type: "tool_result", name: t.name, result: res, durationMs: Date.now() - start });
              return res;
            }
            args = parsed.data;
          }
          try {
            const res = await t.handler(args);
            onEvent == null ? void 0 : onEvent({ type: "tool_result", name: t.name, result: res, durationMs: Date.now() - start });
            return res;
          } catch (err) {
            const res = { error: true, code: "TOOL_HANDLER_ERROR", message: (err == null ? void 0 : err.message) || "Tool handler error" };
            onEvent == null ? void 0 : onEvent({ type: "tool_result", name: t.name, result: res, durationMs: Date.now() - start });
            return res;
          }
        }
      });
    });
  }
  async runStructured(schema, messages, opts) {
    const { agent, prompt } = this.buildAgentAndPrompt(messages, void 0, opts);
    const runner = new Runner({ model: this.model });
    const result = await runner.run(agent, prompt);
    const out = result == null ? void 0 : result.finalOutput;
    const text = typeof out === "string" ? out : JSON.stringify(out != null ? out : "");
    if (!text) throw new Error("No content from model");
    return schema.parse(JSON.parse(text));
  }
  async runWithTools(messages, onEvent, opts) {
    var _a, _b, _c;
    const { agent, prompt } = this.buildAgentAndPrompt(messages, onEvent, opts);
    const runner = new Runner({ model: this.model });
    const started = Date.now();
    const result = await runner.run(agent, prompt);
    const durationMs = Date.now() - started;
    const tokens = (((_a = result == null ? void 0 : result.usage) == null ? void 0 : _a.inputTokens) || 0) + (((_b = result == null ? void 0 : result.usage) == null ? void 0 : _b.outputTokens) || 0);
    onEvent == null ? void 0 : onEvent({ type: "metrics", durationMs, tokens: Number.isFinite(tokens) && tokens > 0 ? tokens : void 0 });
    const content = typeof (result == null ? void 0 : result.finalOutput) === "string" ? result.finalOutput : extractResponseText(result) || JSON.stringify((_c = result == null ? void 0 : result.finalOutput) != null ? _c : "");
    return { content };
  }
  // Backward-compatible convenience: non-streaming chat that may use tools per policy
  async runChat(messages, onEvent, opts) {
    return this.runWithTools(messages, onEvent, opts);
  }
  async runChatStream(messages, onDelta, opts) {
    var _a, _b;
    const { agent, prompt } = this.buildAgentAndPrompt(messages, void 0, opts);
    const runner = new Runner({ model: this.model });
    const stream = await runner.run(agent, prompt, { stream: true });
    let full = "";
    const textStream = stream.toTextStream({ compatibleWithNodeStreams: false });
    for await (const chunk of textStream) {
      const d = (_b = (_a = chunk == null ? void 0 : chunk.toString) == null ? void 0 : _a.call(chunk)) != null ? _b : String(chunk);
      if (d) {
        full += d;
        onDelta(d);
      }
    }
    await stream.completed;
    const result = await stream.finalResult;
    if (typeof (result == null ? void 0 : result.finalOutput) === "string") full += result.finalOutput;
    return full;
  }
  buildAgentAndPrompt(messages, onEvent, opts) {
    const systemText = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n") || "You are a helpful assistant.";
    const userText = messages.filter((m) => m.role !== "system").map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");
    const filteredTools = (() => {
      if ((opts == null ? void 0 : opts.toolPolicy) === "off") return [];
      if ((opts == null ? void 0 : opts.toolsAllowlist) && opts.toolsAllowlist.length > 0) {
        return this.tools.filter((t) => opts.toolsAllowlist.includes(t.name));
      }
      return this.tools;
    })();
    const wrappedTools = filteredTools.map((t) => {
      const paramsSchema = t.parameters instanceof ZodObject ? t.parameters : z.object({});
      return tool({
        name: t.name,
        description: t.description,
        parameters: paramsSchema,
        execute: async (input) => {
          var _a, _b;
          const start = Date.now();
          onEvent == null ? void 0 : onEvent({ type: "tool_call", name: t.name, args: input });
          let args = input;
          const schema = t.parameters;
          if (schema && typeof schema.safeParse === "function") {
            const parsed = schema.safeParse(input);
            if (!parsed.success) {
              const issues = (_b = (_a = parsed.error) == null ? void 0 : _a.issues) == null ? void 0 : _b.map((i) => ({
                path: i.path,
                message: i.message,
                code: i.code
              }));
              try {
                getLogger().warn("tool_invalid_args", { tool: t.name, issues });
              } catch {
              }
              const res = {
                error: true,
                code: "INVALID_ARGUMENT",
                message: "Invalid tool arguments",
                issues
              };
              onEvent == null ? void 0 : onEvent({ type: "tool_result", name: t.name, result: res, durationMs: Date.now() - start });
              return res;
            }
            args = parsed.data;
          }
          try {
            const res = await t.handler(args);
            onEvent == null ? void 0 : onEvent({ type: "tool_result", name: t.name, result: res, durationMs: Date.now() - start });
            return res;
          } catch (err) {
            const res = {
              error: true,
              code: "TOOL_HANDLER_ERROR",
              message: (err == null ? void 0 : err.message) || "Tool handler error"
            };
            onEvent == null ? void 0 : onEvent({ type: "tool_result", name: t.name, result: res, durationMs: Date.now() - start });
            return res;
          }
        }
      });
    });
    const agent = new Agent({
      name: "Orchestrator",
      instructions: systemText,
      tools: wrappedTools
    });
    return { agent, prompt: userText || "Proceed." };
  }
}

var __defProp$1 = Object.defineProperty;
var __defNormalProp$1 = (obj, key, value) => key in obj ? __defProp$1(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField$1 = (obj, key, value) => __defNormalProp$1(obj, typeof key !== "symbol" ? key + "" : key, value);
const DEFAULT_PLAN = { version: 0, steps: [] };
const DEFAULT_HITL_STATE = { requests: [], responses: [], pendingRequestId: null, deniedCount: 0 };
function clone$1(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}
class OrchestratorPersistence {
  constructor(dbInstance = getDb()) {
    __publicField$1(this, "db");
    this.db = dbInstance;
  }
  async ensure(runId) {
    await this.db.insert(orchestratorRuns).values({ runId }).onConflictDoNothing();
  }
  async load(runId) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m;
    await this.ensure(runId);
    const [row] = await this.db.select().from(orchestratorRuns).where(eq(orchestratorRuns.runId, runId)).limit(1);
    if (!row) {
      return {
        runId,
        plan: clone$1(DEFAULT_PLAN),
        history: [],
        runReport: null,
        hitlState: clone$1(DEFAULT_HITL_STATE),
        pendingRequestId: null,
        status: "pending",
        executionContext: {},
        runnerMetadata: {}
      };
    }
    const plan = (_a = row.planSnapshotJson) != null ? _a : clone$1(DEFAULT_PLAN);
    const history = Array.isArray(row.stepHistoryJson) ? row.stepHistoryJson : [];
    const hitl = (_b = row.hitlStateJson) != null ? _b : clone$1(DEFAULT_HITL_STATE);
    return {
      runId,
      plan,
      history,
      runReport: (_c = row.runReportJson) != null ? _c : null,
      hitlState: hitl,
      pendingRequestId: (_e = (_d = row.pendingRequestId) != null ? _d : hitl.pendingRequestId) != null ? _e : null,
      status: (_f = row.status) != null ? _f : "pending",
      threadId: (_g = row.threadId) != null ? _g : null,
      briefId: (_h = row.briefId) != null ? _h : null,
      executionContext: (_i = row.executionContextJson) != null ? _i : {},
      runnerMetadata: (_j = row.runnerMetadataJson) != null ? _j : {},
      lastError: (_k = row.lastError) != null ? _k : null,
      createdAt: (_l = row.createdAt) != null ? _l : void 0,
      updatedAt: (_m = row.updatedAt) != null ? _m : void 0
    };
  }
  async save(runId, updates) {
    await this.ensure(runId);
    const now = /* @__PURE__ */ new Date();
    const set = { updatedAt: now };
    if (updates.plan) set.planSnapshotJson = clone$1(updates.plan);
    if (updates.history) set.stepHistoryJson = clone$1(updates.history);
    if (updates.runReport !== void 0) set.runReportJson = updates.runReport ? clone$1(updates.runReport) : null;
    if (updates.hitlState) set.hitlStateJson = clone$1(updates.hitlState);
    if (updates.pendingRequestId !== void 0) set.pendingRequestId = updates.pendingRequestId;
    if (updates.status) set.status = updates.status;
    if (updates.threadId !== void 0) set.threadId = updates.threadId;
    if (updates.briefId !== void 0) set.briefId = updates.briefId;
    if (updates.executionContext) set.executionContextJson = clone$1(updates.executionContext);
    if (updates.runnerMetadata) set.runnerMetadataJson = clone$1(updates.runnerMetadata);
    if (updates.lastError !== void 0) set.lastError = updates.lastError;
    await this.db.update(orchestratorRuns).set(set).where(eq(orchestratorRuns.runId, runId));
  }
  async touch(runId, status) {
    await this.save(runId, { status });
  }
  async listAwaitingHitl() {
    const rows = await this.db.select().from(orchestratorRuns).where(and(isNotNull(orchestratorRuns.pendingRequestId), eq(orchestratorRuns.status, "awaiting_hitl")));
    return Promise.all(
      rows.map(async (row) => {
        var _a, _b, _c;
        const snapshot = await this.load(row.runId);
        const pendingRequest = snapshot.hitlState.requests.find((req) => req.id === row.pendingRequestId);
        return {
          runId: row.runId,
          threadId: (_a = row.threadId) != null ? _a : null,
          briefId: (_b = row.briefId) != null ? _b : null,
          pendingRequestId: row.pendingRequestId,
          status: snapshot.status,
          updatedAt: (_c = row.updatedAt) != null ? _c : void 0,
          executionContext: snapshot.executionContext,
          pendingRequest
        };
      })
    );
  }
  async findByThreadId(threadId) {
    const [row] = await this.db.select().from(orchestratorRuns).where(eq(orchestratorRuns.threadId, threadId)).limit(1);
    if (!row) return null;
    const snapshot = await this.load(row.runId);
    return { runId: row.runId, snapshot };
  }
}
class InMemoryOrchestratorPersistence {
  constructor() {
    __publicField$1(this, "runs", /* @__PURE__ */ new Map());
  }
  ensureSnapshot(runId) {
    if (!this.runs.has(runId)) {
      this.runs.set(runId, {
        runId,
        plan: clone$1(DEFAULT_PLAN),
        history: [],
        runReport: null,
        hitlState: clone$1(DEFAULT_HITL_STATE),
        pendingRequestId: null,
        status: "pending",
        executionContext: {},
        runnerMetadata: {}
      });
    }
    return this.runs.get(runId);
  }
  async ensure(runId) {
    this.ensureSnapshot(runId);
  }
  async load(runId) {
    const snap = clone$1(this.ensureSnapshot(runId));
    return snap;
  }
  async save(runId, updates) {
    var _a;
    const current = this.ensureSnapshot(runId);
    const next = {
      ...current,
      plan: updates.plan ? clone$1(updates.plan) : current.plan,
      history: updates.history ? clone$1(updates.history) : current.history,
      runReport: updates.runReport === void 0 ? current.runReport : updates.runReport ? clone$1(updates.runReport) : null,
      hitlState: updates.hitlState ? clone$1(updates.hitlState) : current.hitlState,
      pendingRequestId: updates.pendingRequestId !== void 0 ? updates.pendingRequestId : current.pendingRequestId,
      status: (_a = updates.status) != null ? _a : current.status,
      threadId: updates.threadId !== void 0 ? updates.threadId : current.threadId,
      briefId: updates.briefId !== void 0 ? updates.briefId : current.briefId,
      executionContext: updates.executionContext ? clone$1(updates.executionContext) : current.executionContext,
      runnerMetadata: updates.runnerMetadata ? clone$1(updates.runnerMetadata) : current.runnerMetadata,
      lastError: updates.lastError !== void 0 ? updates.lastError : current.lastError,
      runId
    };
    this.runs.set(runId, next);
  }
  async touch(runId, status) {
    if (status) await this.save(runId, { status });
  }
  async listAwaitingHitl() {
    const results = [];
    for (const snapshot of this.runs.values()) {
      if (snapshot.status === "awaiting_hitl" && snapshot.pendingRequestId) {
        const pendingRequest = snapshot.hitlState.requests.find((req) => req.id === snapshot.pendingRequestId);
        results.push({
          runId: snapshot.runId,
          threadId: snapshot.threadId,
          briefId: snapshot.briefId,
          pendingRequestId: snapshot.pendingRequestId,
          status: snapshot.status,
          executionContext: snapshot.executionContext,
          pendingRequest
        });
      }
    }
    return results;
  }
  async findByThreadId(threadId) {
    for (const snapshot of this.runs.values()) {
      if (snapshot.threadId === threadId) {
        return { runId: snapshot.runId, snapshot: await this.load(snapshot.runId) };
      }
    }
    return null;
  }
}
let singleton$1 = null;
function getOrchestratorPersistence() {
  if (!singleton$1) {
    if (process.env.ORCHESTRATOR_PERSISTENCE === "memory" || false) {
      singleton$1 = new InMemoryOrchestratorPersistence();
    } else {
      singleton$1 = new OrchestratorPersistence();
    }
  }
  return singleton$1;
}

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
    var _a, _b;
    await this.persistence.ensure(runId);
    const snapshot = await this.persistence.load(runId);
    const requestRows = await this.db.select().from(hitlRequests).where(eq(hitlRequests.runId, runId)).orderBy(asc(hitlRequests.createdAt));
    const responseRows = requestRows.length ? await this.db.select().from(hitlResponses).where(inArray(hitlResponses.requestId, requestRows.map((row) => row.id))).orderBy(asc(hitlResponses.createdAt)) : [];
    const requests = requestRows.map((row) => this.mapRequest(row));
    const responses = responseRows.map((row) => this.mapResponse(row));
    const pendingFromRequests = (_b = (_a = requests.find((req) => req.status === "pending")) == null ? void 0 : _a.id) != null ? _b : null;
    const pendingRequestId = pendingFromRequests != null ? pendingFromRequests : snapshot.pendingRequestId && requests.some((r) => r.id === snapshot.pendingRequestId) ? snapshot.pendingRequestId : null;
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
function withHitlContext(ctx, fn) {
  return storage.run(ctx, fn);
}
function getHitlContext() {
  return storage.getStore();
}

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

const DEFAULT_FALLBACK_QUESTION = "Human assistance required to continue this orchestration step.";
function coerceString(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : void 0;
  }
  return void 0;
}
function normalizeOptions(raw) {
  if (!Array.isArray(raw)) return void 0;
  const items = [];
  raw.forEach((entry, idx) => {
    if (typeof entry === "string") {
      const label = entry.trim();
      if (!label) return;
      items.push({ id: `opt_${idx + 1}`, label });
      return;
    }
    if (entry && typeof entry === "object") {
      const obj = entry;
      const label = coerceString(obj.label) || coerceString(obj.title) || coerceString(obj.value);
      if (!label) return;
      const id = coerceString(obj.id) || `opt_${idx + 1}`;
      const description = coerceString(obj.description) || coerceString(obj.detail);
      items.push({ id, label, description });
    }
  });
  return items.length ? items : void 0;
}
function normalizeHitlPayload(raw) {
  var _a;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const input = { ...raw };
  let fallbackReason;
  if (input.prompt && !input.question) input.question = input.prompt;
  if (input.message && !input.question) input.question = input.message;
  if (input.query && !input.question) input.question = input.query;
  if (!input.additionalContext && input.context) input.additionalContext = input.context;
  const normalizedOptions = normalizeOptions((_a = input.options) != null ? _a : input.choices);
  if (normalizedOptions) {
    input.options = normalizedOptions;
  }
  let question = coerceString(input.question);
  if (!question) {
    question = coerceString(input.additionalContext);
  }
  if (!question && normalizedOptions && normalizedOptions.length) {
    question = "Please select the best option to proceed.";
  }
  if (!question) {
    question = DEFAULT_FALLBACK_QUESTION;
    fallbackReason = "fallback_question";
  } else if (!coerceString(raw.question)) {
    fallbackReason = "normalized_question";
  }
  input.question = question;
  if (!input.kind && normalizedOptions && normalizedOptions.length) {
    input.kind = "choice";
  }
  if (fallbackReason) {
    try {
      getLogger().warn("hitl_request_autofix", {
        reason: fallbackReason,
        providedKeys: Object.keys(raw),
        hasOptions: Boolean(normalizedOptions && normalizedOptions.length)
      });
    } catch {
    }
  }
  return input;
}
const HITL_TOOL_NAME = "hitl_request";
const HitlOptionForTool = HitlOptionSchema.extend({
  description: z.string().nullable().default(null)
});
const HitlToolInputSchema = z.object({
  question: z.string().min(1, "question is required"),
  kind: HitlRequestKindEnum.default("question"),
  options: z.array(HitlOptionForTool).default([]),
  allowFreeForm: z.boolean().default(true),
  urgency: HitlUrgencyEnum.default("normal"),
  additionalContext: z.string().nullable().optional()
});
function registerHitlTools(runtime) {
  const service = getHitlService();
  runtime.registerTool({
    name: HITL_TOOL_NAME,
    description: "Request human-in-the-loop input (question, approval, or choice).",
    parameters: HitlToolInputSchema,
    handler: async (raw) => {
      const normalized = HitlToolInputSchema.parse(normalizeHitlPayload(raw));
      const question = normalized.question.trim();
      if (!question || question === DEFAULT_FALLBACK_QUESTION) {
        throw new Error("hitl_request requires a non-empty `question` describing what the operator must decide.");
      }
      const payloadForService = {
        ...normalized,
        options: normalized.options.map((opt) => {
          var _a;
          return {
            ...opt,
            description: (_a = opt.description) != null ? _a : void 0
          };
        })
      };
      const result = await service.raiseRequest(payloadForService);
      if (result.status === "denied") {
        return {
          status: "denied",
          reason: result.reason,
          requestId: result.request.id
        };
      }
      return {
        status: "pending",
        requestId: result.request.id,
        originAgent: result.request.originAgent,
        urgency: result.request.payload.urgency,
        kind: result.request.payload.kind
      };
    }
  });
}

class StrategyManagerAgent {
  constructor(runtime) {
    this.runtime = runtime;
  }
}
const STRATEGY_TOOLS = [
  "strategy_analyze_assets",
  "strategy_plan_knobs",
  HITL_TOOL_NAME
];
const HITL_ENABLED$2 = process.env.ENABLE_HITL === "true";
const STRATEGY_INSTRUCTIONS_APP = [
  "You are the Strategy Manager agent for social content.",
  'Before planning, validate the brief: if the objective is missing, extremely short (< 10 characters), or obviously placeholder text (e.g., "tbd", "???", "kkk"), or if the audienceId is empty/unknown, you must pause and escalate.',
  "Escalate by calling hitl_request with a concise human-readable question that states exactly what decision the operator needs to make. Always include any clear options the operator should choose between when you know them.",
  'Your input payload includes briefValidation.objectiveStatus and briefValidation.audienceStatus. If either status is not "ok", you must call hitl_request immediately and wait for operator guidance before continuing.',
  "Plan using the 4\u2011knob system and enforce strict knob typing.",
  "Never invent assets or client data. Use tools to analyze assets before choosing a format.",
  "formatType MUST be achievable with available assets. If a requested format is unachievable, select the closest achievable alternative and explain the tradeoff in rationale.",
  "",
  "Knob schema (STRICT):",
  '- formatType: one of "text" | "single_image" | "multi_image" | "document_pdf" | "video" (must be achievable).',
  "- hookIntensity: number 0.0\u20131.0 (opening line strength).",
  "- expertiseDepth: number 0.0\u20131.0 (practitioner\u2011level specificity).",
  "- structure: { lengthLevel: number 0.0\u20131.0, scanDensity: number 0.0\u20131.0 }.",
  "",
  "Use tools:",
  "- strategy_analyze_assets to determine achievableFormats and recommendations.",
  "- strategy_plan_knobs to compute a compliant knob configuration given the objective and asset analysis.",
  "",
  "Deliverable (APP/WORKFLOW MODE): return ONE JSON object only (no code fences) with fields: rationale, writerBrief (including knob settings), and knobs. Do NOT generate content drafts.",
  "Align language, tone/voice, hashtags, and cultural context with the client profile and guardrails.",
  "Output contract (strict JSON, one object only):",
  "{",
  '  "rationale": "<short reasoning for the chosen approach and key strategic choices>",',
  '  "writerBrief": {',
  '    "clientName": "<exact client/company name>",',
  '    "objective": "<what the content must achieve>",',
  '    "audience": "<who we are targeting>",',
  '    "platform": "<e.g., linkedin | x>",',
  '    "language": "<e.g., nl | en>",',
  '    "tone": "<tone/voice guidance>",',
  '    "angle": "<selected angle>",',
  '    "hooks": [ "<hook option 1>", "<hook option 2>" ],',
  '    "cta": "<clear CTA>",',
  '    "customInstructions": [ "<string>" ],',
  '    "constraints": { "maxLength?": <number> },',
  '    "knobs": {',
  '      "formatType": "text" | "single_image" | "multi_image" | "document_pdf" | "video",',
  '      "hookIntensity": <number 0.0-1.0>,',
  '      "expertiseDepth": <number 0.0-1.0>,',
  '      "structure": { "lengthLevel": <number 0.0-1.0>, "scanDensity": <number 0.0-1.0> }',
  "    }",
  "  },",
  '  "knobs": {',
  '    "formatType": "text" | "single_image" | "multi_image" | "document_pdf" | "video",',
  '    "hookIntensity": <number 0.0-1.0>,',
  '    "expertiseDepth": <number 0.0-1.0>,',
  '    "structure": { "lengthLevel": <number 0.0-1.0>, "scanDensity": <number 0.0-1.0> }',
  "  }",
  "}",
  "Notes:",
  "- Use the client/company name from the provided Client Profile (do not invent or translate it).",
  "- writerBrief.knobs must mirror the top\u2011level knobs exactly.",
  "- Keep rationale concise (3\u20135 sentences max).",
  "- Return one JSON object only; do NOT include markdown or code fences."
].concat(
  HITL_ENABLED$2 ? [
    "If required brief data is missing (no objective, meaningless/placeholder objective, unknown audience), call the `hitl_request` tool. DO NOT continue planning without human clarification.",
    'When you invoke `hitl_request`, set the `question` field to a single sentence summarising the human decision (e.g., hitl_request({"question":"Operator: provide a real objective for this brief","options":[{"id":"await","label":"Pause until objective provided"}]})).'
  ] : []
).join("\n");
const STRATEGY_INSTRUCTIONS_CHAT = [
  "You are the Strategy Manager agent speaking directly with a user.",
  "Respond conversationally with plain\u2011text, actionable recommendations.",
  "If critical info is missing, ask at most one clarifying question before proposing a safe default.",
  "Reflect client language, tone/voice, and guardrails when known. Do NOT return JSON or code fences."
].concat(
  HITL_ENABLED$2 ? [
    "Escalate with the `hitl_request` tool when a human decision is required (e.g., conflicting guardrails or missing approvals) instead of improvising.",
    "Always populate the `question` field when calling `hitl_request`; never leave it empty."
  ] : []
).join("\n");
function createStrategyAgent(runtime, onEvent, opts, mode = "app") {
  const tools = runtime.getAgentTools({ allowlist: [...STRATEGY_TOOLS], policy: opts == null ? void 0 : opts.policy, requestAllowlist: opts == null ? void 0 : opts.requestAllowlist }, onEvent);
  const instructions = mode === "chat" ? STRATEGY_INSTRUCTIONS_CHAT : STRATEGY_INSTRUCTIONS_APP;
  return new Agent({ name: "Strategy Manager", instructions, tools });
}

const HITL_ENABLED$1 = process.env.ENABLE_HITL === "true";
class ContentGeneratorAgent {
  constructor(runtime) {
    this.runtime = runtime;
  }
}
const CONTENT_TOOLS = [
  "apply_format_rendering",
  "optimize_for_platform",
  HITL_TOOL_NAME
];
const CONTENT_INSTRUCTIONS_APP = [
  "You are the Content Generator agent.",
  "Generate or revise a post based on the description of the brief and the guidelines provided in the writer brief.",
  "A post has the structure: first line is the hook, then a blank line, then the body, then the hashtags (if any).",
  "Payload contract:",
  '- "writerBrief" and optional "knobs" describe the target content.',
  '- If "contentRecommendations" (array of strings) is present, this is a revision task: apply the recommendations with minimal necessary edits.',
  '- If "previousDraft" is provided, use it as the base and only change what is required to follow the recommendations; otherwise, regenerate while deviating only where needed to satisfy them.',
  "Use tools to apply format\u2011specific rendering and platform optimization while respecting platform rules and client policy.",
  "Output only the final post as plain text (no JSON or code fences)."
].concat(
  HITL_ENABLED$1 ? [
    "If brand, legal, or tone decisions cannot be resolved safely, pause and call the `hitl_request` tool with the question and any viable draft options instead of publishing uncertain copy.",
    "When you invoke `hitl_request`, ensure the `question` field clearly states the decision the operator must make and include any draft alternatives as options."
  ] : []
).join("\n");
const CONTENT_INSTRUCTIONS_CHAT = [
  "You are the Content Generator agent speaking directly with a user.",
  "Return plain text only (no JSON/code fences).",
  "Default to one post unless asked for multiple. If multiple, number variants 1\u2013N separated by blank lines.",
  "Structure each post: first line hook, blank line, then body.",
  'If the user provides "contentRecommendations" and/or a previous draft, treat it as a revision: keep the copy intact except changes required to follow the recommendations.',
  "Use tools to apply format\u2011specific rendering and platform optimization while respecting platform rules and client policy."
].concat(
  HITL_ENABLED$1 ? [
    "If the user requests content that conflicts with policy or needs human approval, invoke the `hitl_request` tool to escalate rather than guessing.",
    "Always populate the `question` field when calling `hitl_request`; describe the decision in one concise sentence."
  ] : []
).join("\n");
function createContentAgent(runtime, onEvent, opts, mode = "app") {
  const tools = runtime.getAgentTools({ allowlist: [...CONTENT_TOOLS], policy: opts == null ? void 0 : opts.policy, requestAllowlist: opts == null ? void 0 : opts.requestAllowlist }, onEvent);
  const instructions = mode === "chat" ? CONTENT_INSTRUCTIONS_CHAT : CONTENT_INSTRUCTIONS_APP;
  return new Agent({ name: "Content Generator", instructions, tools });
}

const HITL_ENABLED = process.env.ENABLE_HITL === "true";
class QualityAssuranceAgent {
  constructor(runtime) {
    this.runtime = runtime;
  }
}
const QA_TOOLS = [
  "qa_evaluate_content",
  HITL_TOOL_NAME
];
const QA_INSTRUCTIONS = [
  "You are the Quality Assurance agent.",
  "Evaluate drafts for readability, clarity, objective fit, brand risk, and compliance.",
  "Return one JSON object only (no markdown/code fences).",
  "Schema (QAReport): { composite?: number(0..1), compliance?: boolean, readability?: number(0..1), clarity?: number(0..1), objectiveFit?: number(0..1), brandRisk?: number(0..1), contentRecommendations?: string[] }",
  'Normalization: If your analysis or tools produce fields named "suggestedChanges" or "Suggestions", map them to a unified field named "contentRecommendations" as an array of short strings.',
  'Mapping guidance: for object suggestions, extract the most helpful text (prefer a "suggestion" field; else use "text"). Keep each recommendation concise.'
].concat(
  HITL_ENABLED ? [
    "If you cannot pass/fail without a human decision (policy conflict, missing approval, unclear legal risk), call the `hitl_request` tool with the specific question and any relevant options so an operator can decide.",
    "When invoking `hitl_request`, explicitly set the `question` field to the human decision you need and supply any options or contextual notes."
  ] : []
).join("\n");
function createQaAgent(runtime, onEvent, opts) {
  const tools = runtime.getAgentTools({ allowlist: [...QA_TOOLS], policy: opts == null ? void 0 : opts.policy, requestAllowlist: opts == null ? void 0 : opts.requestAllowlist }, onEvent);
  return new Agent({ name: "Quality Assurance", instructions: QA_INSTRUCTIONS, tools });
}

function registerIOTools(runtime) {
  const db = getDb();
  runtime.registerTool({
    name: "io_get_brief",
    description: "Fetch a brief by id",
    parameters: z.object({ briefId: z.string().uuid() }),
    handler: async ({ briefId }) => {
      const [row] = await db.select().from(briefs).where(eq(briefs.id, briefId)).limit(1);
      if (!row) throw new Error("Brief not found");
      const [client] = await db.select().from(clients).where(eq(clients.id, row.clientId)).limit(1);
      return { ...row, clientName: client == null ? void 0 : client.name };
    }
  });
  runtime.registerTool({
    name: "io_list_assets",
    description: "List assets for a brief",
    parameters: z.object({ briefId: z.string().uuid() }),
    handler: async ({ briefId }) => {
      const rows = await db.select().from(assets).where(eq(assets.briefId, briefId));
      return rows;
    }
  });
  runtime.registerTool({
    name: "io_get_client_profile",
    description: "Fetch the client profile for a clientId",
    parameters: z.object({ clientId: z.string().uuid() }),
    handler: async ({ clientId }) => {
      const profile = await getClientProfileByClientId(clientId);
      if (!profile) return null;
      return profile;
    }
  });
}

function analyzeAssetsLocal(assets) {
  const images = assets.filter((a) => a.type === "image");
  const documents = assets.filter((a) => a.type === "document");
  const videos = assets.filter((a) => a.type === "video");
  const hasPdf = documents.some((d) => (d.mimeType || "").includes("pdf"));
  const achievable = ["text"];
  if (images.length >= 1) achievable.push("single_image");
  if (images.length >= 3) achievable.push("multi_image");
  if (documents.length >= 1 && hasPdf) achievable.push("document_pdf");
  if (videos.length >= 1) achievable.push("video");
  let recommended = "text";
  if (videos.length >= 1) recommended = "video";
  else if (images.length >= 3) recommended = "multi_image";
  else if (images.length >= 1) recommended = "single_image";
  else if (documents.length >= 1 && hasPdf) recommended = "document_pdf";
  const assetQuality = {
    images: { count: images.length, quality: images.length >= 3 ? "high" : images.length >= 1 ? "medium" : "low" },
    documents: { count: documents.length, hasSlides: hasPdf },
    videos: { count: videos.length, duration: void 0 }
  };
  const formatFeasibility = {
    text: { feasible: true, reason: "Always available", assetRequirements: [] },
    single_image: {
      feasible: images.length >= 1,
      reason: images.length >= 1 ? "Sufficient images" : "Need at least 1 image",
      assetRequirements: images.length >= 1 ? [] : ["At least 1 image"]
    },
    multi_image: {
      feasible: images.length >= 3,
      reason: images.length >= 3 ? "Sufficient images" : "Need at least 3 images",
      assetRequirements: images.length >= 3 ? [] : ["At least 3 images"]
    },
    document_pdf: {
      feasible: documents.length >= 1 && hasPdf,
      reason: hasPdf ? "PDF available" : "PDF required",
      assetRequirements: hasPdf ? [] : ["PDF or presentation document"]
    },
    video: {
      feasible: videos.length >= 1,
      reason: videos.length >= 1 ? "Video available" : "Video required",
      assetRequirements: videos.length >= 1 ? [] : ["Video file"]
    }
  };
  const recommendations = [];
  if (images.length === 0) recommendations.push("Consider adding at least one strong image to increase scannability.");
  if (videos.length === 0 && images.length >= 1) recommendations.push("Short clips or motion can further improve engagement.");
  if (documents.length >= 1 && !hasPdf) recommendations.push("Export documents to PDF for easier sharing.");
  return { achievableFormats: achievable, recommendedFormat: recommended, assetQuality, formatFeasibility, recommendations };
}
const AssetParamSchema = z.object({
  id: z.string().nullable(),
  filename: z.string().nullable(),
  originalName: z.string().nullable(),
  url: z.string().nullable(),
  type: z.enum(["image", "document", "video", "audio", "other"]).nullable(),
  mimeType: z.string().nullable(),
  fileSize: z.number().int().nonnegative().nullable()
}).strict().catchall(z.never());
const FormatTypeEnum = z.enum(["text", "single_image", "multi_image", "document_pdf", "video"]);
const AssetQualityParamSchema = z.object({
  images: z.object({
    count: z.number().int().nonnegative(),
    quality: z.enum(["high", "medium", "low"])
  }).strict(),
  documents: z.object({
    count: z.number().int().nonnegative(),
    hasSlides: z.boolean()
  }).strict(),
  videos: z.object({
    count: z.number().int().nonnegative(),
    duration: z.number().int().nonnegative().nullable()
  }).strict()
}).strict();
const FormatFeasibilityEntrySchema = z.object({
  feasible: z.boolean(),
  reason: z.string(),
  assetRequirements: z.array(z.string())
}).strict();
const FormatFeasibilityParamSchema = z.object({
  text: FormatFeasibilityEntrySchema,
  single_image: FormatFeasibilityEntrySchema,
  multi_image: FormatFeasibilityEntrySchema,
  document_pdf: FormatFeasibilityEntrySchema,
  video: FormatFeasibilityEntrySchema
}).strict();
const AssetAnalysisParamSchema = z.object({
  achievableFormats: z.array(FormatTypeEnum),
  recommendedFormat: FormatTypeEnum,
  assetQuality: AssetQualityParamSchema,
  formatFeasibility: FormatFeasibilityParamSchema,
  recommendations: z.array(z.string())
}).strict();
function registerStrategyTools(runtime) {
  runtime.registerTool({
    name: "strategy_analyze_assets",
    description: "Analyze provided assets to determine feasible formats and a recommendation",
    parameters: z.object({
      // OpenAI structured outputs: all fields required; use nullable for optional semantics.
      // Important: arrays must define item schemas; avoid z.any() for array items.
      assets: z.array(AssetParamSchema).nullable(),
      briefId: z.string().nullable()
    }).strict(),
    handler: async ({ assets: assets$1, briefId }) => {
      let sourceAssets = assets$1;
      if ((!sourceAssets || !Array.isArray(sourceAssets)) && briefId) {
        const db = getDb();
        const rows = await db.select().from(assets).where(eq(assets.briefId, briefId));
        sourceAssets = rows.map((r) => ({
          id: r.id,
          filename: r.filename || "",
          originalName: r.originalName || void 0,
          url: r.url,
          type: r.type || "other",
          mimeType: r.mimeType || void 0,
          fileSize: r.fileSize || void 0,
          metaJson: r.metaJson || void 0
        }));
      }
      if (!sourceAssets || !Array.isArray(sourceAssets)) {
        sourceAssets = [];
      }
      return analyzeAssetsLocal(sourceAssets);
    }
  });
  runtime.registerTool({
    name: "strategy_plan_knobs",
    description: "Plan 4-knob configuration based on objective and asset analysis",
    parameters: z.object({
      objective: z.string(),
      // Add assetAnalysis parameter that the SDK expects
      assetAnalysis: AssetAnalysisParamSchema.nullable(),
      // Narrow client policy shape to satisfy JSON Schema requirements
      clientPolicy: z.object({
        maxHookIntensity: z.number().nullable()
      }).strict().nullable(),
      briefId: z.string().nullable()
    }).strict(),
    handler: async ({ objective, assetAnalysis, clientPolicy, briefId }) => {
      let analysis = assetAnalysis;
      if (!analysis && briefId) {
        const db = getDb();
        const rows = await db.select().from(assets).where(eq(assets.briefId, briefId));
        const mapped = rows.map((r) => ({
          id: r.id,
          filename: r.filename || "",
          originalName: r.originalName || void 0,
          url: r.url,
          type: r.type || "other",
          mimeType: r.mimeType || void 0,
          fileSize: r.fileSize || void 0,
          metaJson: r.metaJson || void 0
        }));
        analysis = analyzeAssetsLocal(mapped);
      }
      const format = (analysis == null ? void 0 : analysis.recommendedFormat) || "text";
      let hookIntensity = /awareness|launch|new/i.test(objective) ? 0.75 : 0.6;
      if ((clientPolicy == null ? void 0 : clientPolicy.maxHookIntensity) != null) {
        const cap = Number(clientPolicy.maxHookIntensity);
        if (Number.isFinite(cap)) hookIntensity = Math.min(hookIntensity, cap);
      }
      const expertiseDepth = /technical|deep|guide|how\-to/i.test(objective) ? 0.7 : 0.5;
      const structure = {
        lengthLevel: format === "text" ? 0.7 : format === "document_pdf" ? 0.9 : 0.4,
        scanDensity: format === "text" ? 0.6 : 0.5
      };
      const rationale = `Chosen format ${format} based on available assets. Hook ${hookIntensity.toFixed(2)} to match objective. Depth ${expertiseDepth.toFixed(2)} for clarity.`;
      return { formatType: format, hookIntensity, expertiseDepth, structure, rationale };
    }
  });
}

const FormatEnum = z.enum(["text", "single_image", "multi_image", "document_pdf", "video"]);
const PlatformEnum$1 = z.enum(["linkedin", "x", "facebook", "instagram", "youtube", "tiktok"]);
const KnobsParamSchema = z.object({
  formatType: FormatEnum.nullable(),
  hookIntensity: z.number().min(0).max(1).nullable(),
  expertiseDepth: z.number().min(0).max(1).nullable(),
  structure: z.object({
    lengthLevel: z.number().min(0).max(1),
    scanDensity: z.number().min(0).max(1)
  }).strict().catchall(z.never()).nullable()
}).strict().catchall(z.never());
function registerContentTools(runtime) {
  runtime.registerTool({
    name: "apply_format_rendering",
    description: "Apply format-specific rendering rules to the content",
    parameters: z.object({
      content: z.string(),
      formatType: FormatEnum
    }),
    handler: ({ content, formatType }) => {
      let post = content;
      switch (formatType) {
        case "document_pdf": {
          const lines = post.split("\n").filter(Boolean);
          const sections = ["\u{1F4CB} Overview", "\u{1F50D} Key Points", "\u{1F4A1} Insights", "\u{1F680} Action Items"];
          post = sections.map((s, i) => lines[i] ? `${s}
${lines[i]}` : "").filter(Boolean).join("\n\n");
          break;
        }
        case "multi_image": {
          const lines = post.split("\n").filter(Boolean);
          const sections = ["\u{1F3AF} Step 1", "\u{1F3AF} Step 2", "\u{1F3AF} Step 3", "\u2705 Result"];
          post = sections.map((s, i) => lines[i] ? `${s}
${lines[i]}` : "").filter(Boolean).join("\n\n");
          break;
        }
        case "single_image": {
          const lines = post.split("\n");
          post = `\u{1F5BC}\uFE0F ${lines[0] || ""}

${lines.slice(1).join("\n")}`.trim();
          break;
        }
        case "video": {
          const lines = post.split("\n");
          post = `\u{1F3AC} Hook: ${lines[0] || ""}

\u25B6\uFE0F Body:
${lines.slice(1).join("\n")}

\u{1F514} CTA: Follow for more`;
          break;
        }
        case "text":
        default: {
          post = post.split("\n").map((ln) => ln.length > 0 ? `\u2022 ${ln}` : ln).join("\n");
          break;
        }
      }
      return { content: post, formatType };
    }
  });
  runtime.registerTool({
    name: "optimize_for_platform",
    description: "Optimize content for a target platform and knob settings",
    parameters: z.object({
      content: z.string(),
      platform: PlatformEnum$1,
      // Strict object with known fields; allow null to indicate no knobs provided
      knobs: KnobsParamSchema.nullable()
    }).strict().catchall(z.never()),
    handler: ({ content, platform, knobs }) => {
      let post = content.trim();
      const maxChars = {
        linkedin: 3e3,
        x: 280,
        facebook: 63206,
        instagram: 2200,
        youtube: 5e3,
        tiktok: 2200
      };
      const limit = maxChars[platform] || 3e3;
      if (post.length > limit) post = post.slice(0, limit - 3) + "...";
      const hook = knobs == null ? void 0 : knobs.hookIntensity;
      if (typeof hook === "number") {
        if (hook > 0.7) post = post.replace(/^•\s*/gm, "\u26A1 ");
        else if (hook < 0.3) post = post.replace(/^•\s*/gm, "\u2014 ");
      }
      return { content: post, platform, length: post.length, knobs };
    }
  });
}

const PlatformEnum = z.enum(["linkedin", "x", "facebook", "instagram", "youtube", "tiktok"]);
function registerQaTools(runtime) {
  runtime.registerTool({
    name: "qa_evaluate_content",
    description: "Evaluate content quality and compliance; return structured scores and suggestions",
    parameters: z.object({
      content: z.string(),
      platform: PlatformEnum,
      // Structured outputs limitation: use nullable instead of optional
      objective: z.string().nullable(),
      // Strict object to satisfy validator; include expected field(s)
      clientPolicy: z.object({
        bannedClaims: z.array(z.string()).nullable()
      }).strict().catchall(z.never()).nullable()
    }).strict().catchall(z.never()),
    handler: ({ content, platform, objective, clientPolicy }) => {
      var _a, _b;
      const text = String(content || "").trim();
      const lower = text.toLowerCase();
      const length = text.length;
      const lines = text.split(/\r?\n/);
      const words = text.match(/[A-Za-z0-9'’\-]+/g) || [];
      const wordCount = Math.max(1, words.length);
      const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
      const sentenceCount = Math.max(1, sentences.length);
      const avgSentenceLen = wordCount / sentenceCount;
      const longWordShare = words.filter((w) => w.length >= 7).length / wordCount;
      const lengthPenalty = length > 1300 ? Math.min(0.3, (length - 1300) / 3e3) : 0;
      const blockinessPenalty = (() => {
        const lb = lines.length - 1;
        const avgPerBlock = length / Math.max(1, lb + 1);
        return Math.max(0, Math.min(0.1, (avgPerBlock - 220) / 2e3));
      })();
      const sentencePenalty = Math.max(0, Math.min(0.4, (avgSentenceLen - 18) / 40));
      const longWordPenalty = Math.max(0, Math.min(0.3, longWordShare * 0.3 * 10));
      const readability = Math.max(0, Math.min(1, 0.92 - (sentencePenalty + longWordPenalty + lengthPenalty + blockinessPenalty)));
      const bulletCount = lines.filter((l) => /^\s*([\-\*•]|\d+\.|\d+\))\s+/.test(l)).length;
      const posSignals = Math.min(0.15, bulletCount * 0.04) + (length > 0 && length / Math.max(1, lines.length) < 140 ? 0.05 : 0);
      const capsWords = words.filter((w) => w.length >= 3 && w === w.toUpperCase()).length / wordCount;
      const capsPenalty = Math.min(0.15, capsWords * 0.4);
      const punctPenalty = Math.min(0.1, (lower.match(/!{2,}|\?{2,}/g) || []).length * 0.05);
      const fillerWords = ["very", "really", "just", "actually", "basically", "obviously", "clearly"];
      const fillerPenalty = Math.min(0.1, fillerWords.reduce((acc, w) => acc + (lower.match(new RegExp(`\\b${w}\\b`, "g")) || []).length, 0) * 0.02);
      const duplicateLinePenalty = (() => {
        const seen = /* @__PURE__ */ new Set();
        for (const l of lines.map((s) => s.trim().toLowerCase()).filter(Boolean)) {
          if (seen.has(l) && l.length > 8) return 0.05;
          seen.add(l);
        }
        return 0;
      })();
      const clarity = Math.max(0, Math.min(1, 0.6 + posSignals - (capsPenalty + punctPenalty + fillerPenalty + duplicateLinePenalty)));
      const stop = /* @__PURE__ */ new Set(["the", "a", "an", "of", "for", "and", "to", "in", "on", "with", "by", "is", "are", "be", "as", "that", "this", "it", "at", "from"]);
      const obj = String(objective || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
      const objTokens = Array.from(new Set(obj.split(/\s+/).filter((t) => t && !stop.has(t))));
      const contentTokens = new Set(lower.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t && !stop.has(t)));
      const overlap = objTokens.filter((t) => contentTokens.has(t)).length;
      const coverage = objTokens.length > 0 ? overlap / objTokens.length : 0;
      const exactPhraseBoost = objTokens.length > 0 && lower.includes(String(objective || "").toLowerCase()) ? 0.05 : 0;
      const objectiveFit = Math.max(0, Math.min(1, 0.55 + 0.4 * coverage + exactPhraseBoost));
      const hasPolicyHit = !!((_b = (_a = clientPolicy == null ? void 0 : clientPolicy.bannedClaims) == null ? void 0 : _a.some) == null ? void 0 : _b.call(_a, (c) => lower.includes(String(c || "").toLowerCase())));
      let brandRisk = hasPolicyHit ? 0.6 : 0.1;
      const riskyPhrases = [
        "100%",
        "guarantee",
        "guaranteed",
        "no risk",
        "get rich",
        "fastest",
        "best",
        "never",
        "always",
        "proven",
        "scientifically proven"
      ];
      const regulatedPhrases = [
        "cure",
        "diagnose",
        "treat",
        "prevent",
        "investment advice",
        "financial advice",
        "returns",
        "profits",
        "insider"
      ];
      const manipulativePhrases = [
        "click here",
        "limited time",
        "act now",
        "don't miss",
        "only today"
      ];
      const pctClaims = (lower.match(/\b\d{2,}%\b/g) || []).length;
      const growthWords = ["increase", "boost", "double", "triple", "explode"];
      const growthMentions = growthWords.reduce((acc, w) => acc + (lower.match(new RegExp(`\\b${w}\\b`, "g")) || []).length, 0);
      const catHits = [
        riskyPhrases.some((p) => lower.includes(p)),
        regulatedPhrases.some((p) => lower.includes(p)),
        manipulativePhrases.some((p) => lower.includes(p)),
        pctClaims > 0 || growthMentions > 0
      ].filter(Boolean).length;
      brandRisk = Math.max(0, Math.min(1, brandRisk + (catHits > 0 ? 0.12 : 0) + Math.max(0, catHits - 1) * 0.06 + Math.min(0.1, (pctClaims + growthMentions) * 0.02) + (hasPolicyHit ? 0.15 : 0)));
      const compliance = brandRisk <= agentThresholds.maxBrandRisk;
      const firstLine = (text.split(/\r?\n/, 1)[0] || "").trim();
      const hookLower = firstLine.toLowerCase();
      let hookStrength = 0.5;
      if (/\d/.test(firstLine)) hookStrength += 0.15;
      if (firstLine.includes("?")) hookStrength += 0.1;
      if (firstLine.includes("!")) hookStrength += 0.05;
      const imperativeStarters = ["imagine", "consider", "stop", "learn", "meet", "introducing", "announce", "announcing", "discover", "try"];
      if (imperativeStarters.some((s) => hookLower.startsWith(s))) hookStrength += 0.1;
      if (firstLine.length < 8 || firstLine.length > 140) hookStrength -= 0.1;
      if (firstLine === firstLine.toUpperCase() && firstLine.replace(/[^A-Za-z]/g, "").length >= 3) hookStrength -= 0.1;
      hookStrength = Math.max(0, Math.min(1, hookStrength));
      const ctaPresence = /(learn more|sign up|follow|comment|share|download|try|register|join us|contact us|get started|read more|dm me|send me a dm)/i.test(text) ? 1 : 0;
      let composite = computeCompositeScore({ readability, clarity, objectiveFit, brandRisk }, { platform });
      if (!compliance) composite = Math.min(composite, 0.4);
      const feedback = [];
      if (length < 80) feedback.push("Content may be too short; add a concrete insight or example.");
      if (length > 1200) feedback.push("Content may be too long; tighten for scannability and focus.");
      if (avgSentenceLen > 22) feedback.push("Shorten long sentences to improve readability.");
      if (capsWords > 0.08) feedback.push("Avoid ALL\u2011CAPS words; use emphasis sparingly.");
      if (bulletCount === 0 && length > 600) feedback.push("Add bullets or short paragraphs to improve clarity.");
      if (!ctaPresence) feedback.push("Add a clear CTA aligned with the objective.");
      if (hasPolicyHit) feedback.push("Remove or rewrite claims that conflict with client policy.");
      if (brandRisk > agentThresholds.maxBrandRisk) feedback.push("Reduce brand risk: avoid absolute promises and regulated claims.");
      const revisionPriority = composite > 0.8 && compliance ? "low" : composite > 0.6 ? "medium" : "high";
      const contentRecommendations = [...feedback];
      return {
        readability,
        clarity,
        objectiveFit,
        brandRisk,
        compliance,
        hookStrength,
        ctaPresence,
        feedback: feedback.join(" "),
        suggestedChanges: feedback,
        contentRecommendations,
        revisionPriority,
        composite
      };
    }
  });
}

let cached = null;
function getAgents() {
  if (cached) return cached;
  const runtime = new AgentRuntime();
  registerIOTools(runtime);
  registerHitlTools(runtime);
  registerStrategyTools(runtime);
  registerContentTools(runtime);
  registerQaTools(runtime);
  cached = {
    runtime,
    strategy: new StrategyManagerAgent(runtime),
    generator: new ContentGeneratorAgent(runtime),
    qa: new QualityAssuranceAgent(runtime)
  };
  return cached;
}
function getCapabilityRegistry() {
  return [
    {
      id: "strategy",
      name: "Strategy Manager",
      description: "Plans rationale and writer brief using client profile and assets.",
      create: createStrategyAgent
    },
    {
      id: "generation",
      name: "Content Generator",
      description: "Generates or revises content drafts from a writer brief.",
      create: createContentAgent
    },
    {
      id: "qa",
      name: "Quality Assurance",
      description: "Evaluates drafts for readability, clarity, fit, and compliance.",
      create: createQaAgent
    }
  ];
}

const agentsContainer = /*#__PURE__*/Object.freeze({
    __proto__: null,
    getAgents: getAgents,
    getCapabilityRegistry: getCapabilityRegistry
});

export { getHitlService as a, getOrchestratorPersistence as b, agentThresholds as c, getAgents as d, agentsContainer as e, getCapabilityRegistry as g, withHitlContext as w };
//# sourceMappingURL=agents-container.mjs.map
