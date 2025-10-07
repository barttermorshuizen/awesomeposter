import { eq, and, isNotNull } from 'drizzle-orm';
import { g as getDb, p as orchestratorRuns } from './client.mjs';

var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
const DEFAULT_PLAN = { version: 0, steps: [] };
const DEFAULT_HITL_STATE = { requests: [], responses: [], pendingRequestId: null, deniedCount: 0 };
function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}
class OrchestratorPersistence {
  constructor(dbInstance = getDb()) {
    __publicField(this, "db");
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
        plan: clone(DEFAULT_PLAN),
        history: [],
        runReport: null,
        hitlState: clone(DEFAULT_HITL_STATE),
        pendingRequestId: null,
        status: "pending",
        executionContext: {},
        runnerMetadata: {}
      };
    }
    const plan = (_a = row.planSnapshotJson) != null ? _a : clone(DEFAULT_PLAN);
    const history = Array.isArray(row.stepHistoryJson) ? row.stepHistoryJson : [];
    const hitl = (_b = row.hitlStateJson) != null ? _b : clone(DEFAULT_HITL_STATE);
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
    if (updates.plan) set.planSnapshotJson = clone(updates.plan);
    if (updates.history) set.stepHistoryJson = clone(updates.history);
    if (updates.runReport !== void 0) set.runReportJson = updates.runReport ? clone(updates.runReport) : null;
    if (updates.hitlState) set.hitlStateJson = clone(updates.hitlState);
    if (updates.pendingRequestId !== void 0) set.pendingRequestId = updates.pendingRequestId;
    if (updates.status) set.status = updates.status;
    if (updates.threadId !== void 0) set.threadId = updates.threadId;
    if (updates.briefId !== void 0) set.briefId = updates.briefId;
    if (updates.executionContext) set.executionContextJson = clone(updates.executionContext);
    if (updates.runnerMetadata) set.runnerMetadataJson = clone(updates.runnerMetadata);
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
    __publicField(this, "runs", /* @__PURE__ */ new Map());
  }
  ensureSnapshot(runId) {
    if (!this.runs.has(runId)) {
      this.runs.set(runId, {
        runId,
        plan: clone(DEFAULT_PLAN),
        history: [],
        runReport: null,
        hitlState: clone(DEFAULT_HITL_STATE),
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
    const snap = clone(this.ensureSnapshot(runId));
    return snap;
  }
  async save(runId, updates) {
    var _a;
    const current = this.ensureSnapshot(runId);
    const next = {
      ...current,
      plan: updates.plan ? clone(updates.plan) : current.plan,
      history: updates.history ? clone(updates.history) : current.history,
      runReport: updates.runReport === void 0 ? current.runReport : updates.runReport ? clone(updates.runReport) : null,
      hitlState: updates.hitlState ? clone(updates.hitlState) : current.hitlState,
      pendingRequestId: updates.pendingRequestId !== void 0 ? updates.pendingRequestId : current.pendingRequestId,
      status: (_a = updates.status) != null ? _a : current.status,
      threadId: updates.threadId !== void 0 ? updates.threadId : current.threadId,
      briefId: updates.briefId !== void 0 ? updates.briefId : current.briefId,
      executionContext: updates.executionContext ? clone(updates.executionContext) : current.executionContext,
      runnerMetadata: updates.runnerMetadata ? clone(updates.runnerMetadata) : current.runnerMetadata,
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
let singleton = null;
function getOrchestratorPersistence() {
  if (!singleton) {
    if (process.env.ORCHESTRATOR_PERSISTENCE === "memory" || false) {
      singleton = new InMemoryOrchestratorPersistence();
    } else {
      singleton = new OrchestratorPersistence();
    }
  }
  return singleton;
}

export { getOrchestratorPersistence as g };
//# sourceMappingURL=orchestrator-persistence.mjs.map
