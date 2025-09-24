import { g as getCapabilityRegistry, a as getHitlService, b as agentThresholds, w as withHitlContext, c as getAgents } from './agents-container.mjs';
import { Runner } from '@openai/agents';
import { genCorrelationId, getLogger } from './logger.mjs';
import { P as PlanPatchSchema } from './agent-run.mjs';
import 'zod';
import './model.mjs';
import 'node:async_hooks';
import './index.mjs';
import '../nitro/nitro.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';
import 'drizzle-orm/node-postgres';
import 'pg';
import 'drizzle-orm/pg-core';
import 'drizzle-orm';
import 'winston';

const RESUME_STORE = /* @__PURE__ */ new Map();
function mapToCapabilityIdOrAction(value) {
  const s = String(value || "").toLowerCase().trim();
  if (!s) return void 0;
  if (s === "final" || s === "finalize" || /finish|complete/.test(s)) return { action: "finalize" };
  return { capabilityId: s };
}
function defaultNoteForStep(target) {
  if (!target) return void 0;
  if (target.action === "finalize") return "Final review";
  switch (target.capabilityId) {
    case "strategy":
      return "Strategy plan";
    case "generation":
      return "Draft content";
    case "qa":
      return "QA review";
    default:
      return void 0;
  }
}
function normalizePlanPatchInput(input, targetPlan) {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m;
  if (!input) return null;
  const out = {};
  const existingIds = new Set(targetPlan.steps.map((s) => s.id));
  const uniqueId = (base) => {
    let idx = targetPlan.steps.filter((s) => (s.capabilityId || s.action || "").toString() === base).length + 1;
    let id = `auto_${base.replace(/[^a-z0-9_.-]/gi, "_")}_${idx}`;
    while (existingIds.has(id)) {
      idx += 1;
      id = `auto_${base.replace(/[^a-z0-9_.-]/gi, "_")}_${idx}`;
    }
    existingIds.add(id);
    return id;
  };
  if (Array.isArray(input)) {
    for (const op of input) {
      if (!op || typeof op !== "object") continue;
      const operation = String(op.op || "").toLowerCase();
      const path = String(op.path || "");
      if (operation !== "add" || !path) continue;
      const value = op.value;
      let note2 = typeof (value == null ? void 0 : value.details) === "string" ? value.details : void 0;
      if (path.startsWith("/strategies")) {
        (_a = out.stepsAdd) != null ? _a : out.stepsAdd = [];
        note2 = note2 || defaultNoteForStep({ capabilityId: "strategy" });
        out.stepsAdd.push({ id: uniqueId("strategy"), capabilityId: "strategy", status: "pending", note: note2 });
      } else if (path.startsWith("/generations")) {
        (_b = out.stepsAdd) != null ? _b : out.stepsAdd = [];
        note2 = note2 || defaultNoteForStep({ capabilityId: "generation" });
        out.stepsAdd.push({ id: uniqueId("generation"), capabilityId: "generation", status: "pending", note: note2 });
      } else if (path.startsWith("/qas")) {
        (_c = out.stepsAdd) != null ? _c : out.stepsAdd = [];
        note2 = note2 || defaultNoteForStep({ capabilityId: "qa" });
        out.stepsAdd.push({ id: uniqueId("qa"), capabilityId: "qa", status: "pending", note: note2 });
      } else if (path.startsWith("/finalize")) {
        (_d = out.stepsAdd) != null ? _d : out.stepsAdd = [];
        note2 = note2 || defaultNoteForStep({ action: "finalize" });
        out.stepsAdd.push({ id: uniqueId("finalize"), action: "finalize", status: "pending", note: note2 });
      }
    }
  }
  if (typeof input !== "object") {
    return out.stepsAdd || out.stepsUpdate || out.stepsRemove || out.note ? out : null;
  }
  const add = (_f = (_e = input.stepsAdd) != null ? _e : input.add) != null ? _f : input.steps;
  if (Array.isArray(add)) {
    out.stepsAdd = (_g = out.stepsAdd) != null ? _g : [];
    for (const raw of add) {
      if (typeof raw === "string") {
        const mapped = mapToCapabilityIdOrAction(raw);
        if (!mapped) continue;
        const base = mapped.capabilityId || mapped.action || "step";
        out.stepsAdd.push({ id: uniqueId(String(base)), ...mapped, status: "pending", note: defaultNoteForStep(mapped) });
        continue;
      }
      if (raw && typeof raw === "object") {
        const m = mapToCapabilityIdOrAction((_k = (_j = (_i = (_h = raw.capabilityId) != null ? _h : raw.step) != null ? _i : raw.kind) != null ? _j : raw.type) != null ? _k : raw.name) || (typeof raw.capabilityId === "string" ? { capabilityId: raw.capabilityId } : void 0);
        if (!m) continue;
        const base = (_m = (_l = m.capabilityId) != null ? _l : m.action) != null ? _m : "step";
        const id = typeof raw.id === "string" ? String(raw.id) : uniqueId(String(base));
        let note2 = typeof raw.note === "string" ? raw.note : typeof raw.description === "string" ? raw.description : void 0;
        let status = "pending";
        const s = String(raw.status || "").toLowerCase();
        if (s === "in_progress" || s === "inprogress" || s === "active") status = "in_progress";
        else if (s === "done" || s === "complete" || s === "completed") status = "done";
        else if (s === "skipped") status = "skipped";
        const label = typeof raw.label === "string" ? raw.label : void 0;
        if (!note2) note2 = defaultNoteForStep(m);
        out.stepsAdd.push({ id, ...m, label, status, note: note2 });
      }
    }
    if (out.stepsAdd.length === 0) delete out.stepsAdd;
  }
  if (Array.isArray(input.stepsUpdate)) {
    out.stepsUpdate = [];
    for (const u of input.stepsUpdate) {
      if (!u || typeof u !== "object") continue;
      let id = u.id;
      if (!id && u.step) {
        const m = mapToCapabilityIdOrAction(u.step);
        const match = (m == null ? void 0 : m.capabilityId) ? targetPlan.steps.find((s) => s.capabilityId === m.capabilityId) : (m == null ? void 0 : m.action) ? targetPlan.steps.find((s) => s.action === m.action) : void 0;
        id = match == null ? void 0 : match.id;
      }
      if (typeof id !== "string") continue;
      const note2 = typeof u.note === "string" ? u.note : void 0;
      let status = void 0;
      if (u.status) {
        const s = String(u.status || "").toLowerCase();
        if (s === "in_progress" || s === "inprogress" || s === "active") status = "in_progress";
        else if (s === "done" || s === "complete" || s === "completed") status = "done";
        else if (s === "skipped") status = "skipped";
        else if (s === "pending") status = "pending";
      }
      out.stepsUpdate.push({ id, status, note: note2 });
    }
    if (out.stepsUpdate.length === 0) delete out.stepsUpdate;
  }
  if (Array.isArray(input.stepsRemove)) {
    out.stepsRemove = input.stepsRemove.map((x) => String(x)).filter(Boolean);
    if (out.stepsRemove.length === 0) delete out.stepsRemove;
  }
  const note = input.note;
  if (typeof note === "string" && note.trim().length > 0) out.note = note;
  if (!out.stepsAdd && !out.stepsUpdate && !out.stepsRemove && typeof out.note !== "string")
    return null;
  return out;
}
function applyPlanPatch(targetPlan, patch) {
  if (!patch || typeof patch !== "object") return;
  if (Array.isArray(patch.stepsAdd)) {
    const existingIds = new Set(targetPlan.steps.map((s) => s.id));
    for (const s of patch.stepsAdd) {
      if (!s || typeof s !== "object" || typeof s.id !== "string") continue;
      if (existingIds.has(s.id)) continue;
      const newStep = { id: String(s.id), status: s.status };
      if (typeof s.capabilityId === "string") newStep.capabilityId = String(s.capabilityId);
      if (typeof s.action === "string") newStep.action = String(s.action);
      if (typeof s.label === "string") newStep.label = String(s.label);
      if (typeof s.note === "string") newStep.note = String(s.note);
      targetPlan.steps.push(newStep);
      existingIds.add(s.id);
    }
  }
  if (Array.isArray(patch.stepsUpdate)) {
    for (const u of patch.stepsUpdate) {
      if (!u || typeof u !== "object" || typeof u.id !== "string") continue;
      const step = targetPlan.steps.find((s) => s.id === u.id);
      if (!step) continue;
      if (u.status) step.status = u.status;
      if (typeof u.note === "string") step.note = u.note;
    }
  }
  if (Array.isArray(patch.stepsRemove)) {
    targetPlan.steps = targetPlan.steps.filter((s) => !patch.stepsRemove.includes(s.id));
  }
}
function extractJsonCandidates(text) {
  const out = [];
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const start = text[i];
    if (start !== "{" && start !== "[") continue;
    const endCh = start === "{" ? "}" : "]";
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < n; j++) {
      const c = text[j];
      if (inStr) {
        if (esc) {
          esc = false;
          continue;
        }
        if (c === "\\") {
          esc = true;
          continue;
        }
        if (c === '"') {
          inStr = false;
          continue;
        }
        continue;
      }
      if (c === '"') {
        inStr = true;
        continue;
      }
      if (c === start) depth++;
      else if (c === endCh) {
        depth--;
        if (depth === 0) {
          out.push(text.slice(i, j + 1));
          i = j;
          break;
        }
      }
    }
  }
  return out;
}
async function runOrchestratorEngine(runtime, req, onEvent, correlationId) {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k;
  const cid = correlationId || `run_${Math.random().toString(36).slice(2)}`;
  onEvent({ type: "start", correlationId: cid, message: "Run started", data: { threadId: req.threadId } });
  const capabilityEntries = getCapabilityRegistry();
  const policy = (_a = req.options) == null ? void 0 : _a.toolPolicy;
  const requestAllowlist = (_b = req.options) == null ? void 0 : _b.toolsAllowlist;
  const toolEventForwarder = (ev) => {
    const name = String((ev == null ? void 0 : ev.name) || "");
    if ((ev == null ? void 0 : ev.type) === "tool_call") onEvent({ type: "tool_call", message: name, data: { args: ev.args }, correlationId: cid });
    if ((ev == null ? void 0 : ev.type) === "tool_result") onEvent({ type: "tool_result", message: name, data: { result: ev.result }, durationMs: ev.durationMs, correlationId: cid });
    if ((ev == null ? void 0 : ev.type) === "metrics") onEvent({ type: "metrics", tokens: ev.tokens, durationMs: ev.durationMs, correlationId: cid });
  };
  const registry = {};
  for (const entry of capabilityEntries) {
    try {
      const instance = entry.create(runtime, toolEventForwarder, { policy, requestAllowlist }, "app");
      registry[entry.id] = { name: entry.name, instance };
    } catch {
    }
  }
  const resumeKey = req.threadId || (req.mode === "app" ? req.briefId || void 0 : void 0);
  const hitlService = getHitlService();
  const runId = resumeKey || cid || genCorrelationId();
  let hitlState = await hitlService.loadRunState(runId);
  const envelope = hitlService.parseEnvelope((_c = req.state) == null ? void 0 : _c.hitl);
  if ((_d = envelope == null ? void 0 : envelope.responses) == null ? void 0 : _d.length) {
    hitlState = await hitlService.applyResponses(runId, envelope.responses);
  }
  const hitlMax = hitlService.getMaxRequestsPerRun();
  let hitlPending = hitlState.pendingRequestId ? hitlState.requests.find((r) => r.id === hitlState.pendingRequestId) || null : null;
  let hitlAcceptedCount = hitlState.requests.filter((r) => r.status !== "denied").length;
  const plan = { version: 0, steps: [] };
  const stepResults = [];
  const artifacts = {};
  let hitlAwaiting = hitlPending;
  const writeResumeSnapshot = (updates) => {
    if (!resumeKey) return;
    const existing = RESUME_STORE.get(resumeKey) || {};
    const next = { ...existing, updatedAt: Date.now() };
    if (updates.plan) next.plan = JSON.parse(JSON.stringify(updates.plan));
    if (updates.history) next.history = JSON.parse(JSON.stringify(updates.history));
    if (updates.runReport) next.runReport = JSON.parse(JSON.stringify(updates.runReport));
    if (updates.hitl) next.hitl = JSON.parse(JSON.stringify(updates.hitl));
    RESUME_STORE.set(resumeKey, next);
  };
  const refreshHitlDerivedState = (state2) => {
    hitlState = state2;
    hitlAcceptedCount = state2.requests.filter((r) => r.status !== "denied").length;
    hitlPending = state2.pendingRequestId ? state2.requests.find((r) => r.id === state2.pendingRequestId) || null : null;
    if (!hitlPending) {
      hitlAwaiting = null;
    }
  };
  const signalHitlRequest = (record, state2) => {
    refreshHitlDerivedState(state2);
    hitlAwaiting = record.status === "pending" ? record : null;
    writeResumeSnapshot({ plan, history: [...stepResults], hitl: hitlState });
    try {
      getLogger().info("hitl_request_pending", {
        requestId: record.id,
        runId,
        originAgent: record.originAgent,
        urgency: record.payload.urgency,
        pendingCount: hitlState.requests.filter((r) => r.status === "pending").length,
        limitMax: hitlMax
      });
    } catch {
    }
    onEvent({ type: "message", message: "hitl_request", data: { requestId: record.id, originAgent: record.originAgent, payload: record.payload }, correlationId: cid });
    onEvent({ type: "metrics", data: { hitlPending: true, hitlTotal: hitlState.requests.length }, correlationId: cid });
  };
  const signalHitlDenied = (reason, state2) => {
    refreshHitlDerivedState(state2);
    writeResumeSnapshot({ plan, history: [...stepResults], hitl: hitlState });
    onEvent({ type: "message", message: "hitl_request_denied", data: { reason, limit: hitlMax }, correlationId: cid });
  };
  refreshHitlDerivedState(hitlState);
  if (hitlPending) {
    signalHitlRequest(hitlPending, hitlState);
  }
  const emitPlanUpdate = (patch) => {
    plan.version += 1;
    onEvent({ type: "plan_update", data: { patch, planVersion: plan.version, plan }, correlationId: cid });
    try {
      writeResumeSnapshot({ plan, history: [...stepResults], runReport: { steps: [...stepResults] }, hitl: hitlState });
    } catch {
    }
  };
  const ensureFinalizeStep = () => {
    let step = plan.steps.find((s) => s.action === "finalize");
    if (!step) {
      const newStep = { id: "auto_finalize_1", action: "finalize", status: "pending", note: "Final review" };
      plan.steps.push(newStep);
      emitPlanUpdate({ stepsAdd: [newStep] });
      step = newStep;
    }
    return step;
  };
  const setStepStatusById = (id, status, note) => {
    const step = plan.steps.find((s) => s.id === id);
    if (!step) return;
    step.status = status;
    emitPlanUpdate({ stepsUpdate: [{ id, status, note }] });
  };
  const attachHitlContext = (payload = {}) => {
    if (hitlState.responses.length > 0) {
      payload.hitlResponses = hitlState.responses.map((r) => ({ ...r }));
    }
    if (hitlPending) {
      payload.pendingHitlRequest = { ...hitlPending };
    }
    return payload;
  };
  const buildPayloadForCapability = (capabilityId) => {
    var _a2, _b2, _c2, _d2, _e2, _f2;
    if (capabilityId === "generation") {
      const payload = { writerBrief: (_a2 = artifacts.strategy) == null ? void 0 : _a2.writerBrief, knobs: (_b2 = artifacts.strategy) == null ? void 0 : _b2.knobs };
      const qaRec = (_d2 = (_c2 = artifacts.qa) == null ? void 0 : _c2.result) == null ? void 0 : _d2.contentRecommendations;
      if (Array.isArray(qaRec) && qaRec.length > 0) payload.contentRecommendations = qaRec;
      if (typeof ((_e2 = artifacts.generation) == null ? void 0 : _e2.draftText) === "string" && artifacts.generation.draftText.trim().length > 0) payload.previousDraft = artifacts.generation.draftText;
      return attachHitlContext(payload);
    }
    if (capabilityId === "qa") {
      return attachHitlContext({ draftText: (_f2 = artifacts.generation) == null ? void 0 : _f2.draftText });
    }
    return attachHitlContext({});
  };
  const executeSpecialistStep = async (stepId, capabilityId, payload) => {
    var _a2, _b2, _c2;
    const sid = capabilityId;
    const agentInstance = (_a2 = registry[sid]) == null ? void 0 : _a2.instance;
    if (!agentInstance) return;
    onEvent({ type: "handoff", message: "occurred", data: { from: "orchestrator", to: registry[sid].name }, correlationId: cid });
    const runner = new Runner({ model: runtime.getModel() });
    const payloadText = (() => {
      try {
        return JSON.stringify(payload != null ? payload : {}, null, 2);
      } catch {
        return String(payload != null ? payload : "");
      }
    })();
    const prompt = [`Objective:
${req.objective}`, `Payload:
${payloadText}`, `Follow your role instructions and use tools as needed.`].join("\n\n");
    const TIMEOUT_MS = sid === "strategy" ? 9e4 : 3e4;
    const MAX_RETRIES = sid === "strategy" ? 0 : 1;
    let text = "";
    let attempt = 0;
    let durationMs = 0;
    const withTimeout = async (p, ms) => {
      return await Promise.race([
        p,
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error("STEP_TIMEOUT")), ms))
      ]);
    };
    const runOnce = async () => {
      var _a3, _b3;
      const start = Date.now();
      try {
        if (sid === "generation" || sid === "qa") {
          const stream = await withTimeout(runner.run(agentInstance, prompt, { stream: true }), TIMEOUT_MS);
          let collected = "";
          if (stream && typeof stream.toTextStream === "function") {
            const textStream = stream.toTextStream({ compatibleWithNodeStreams: false });
            const deadline = Date.now() + TIMEOUT_MS;
            for await (const chunk of textStream) {
              const d = (_b3 = (_a3 = chunk == null ? void 0 : chunk.toString) == null ? void 0 : _a3.call(chunk)) != null ? _b3 : String(chunk != null ? chunk : "");
              if (d) {
                collected += d;
                onEvent({ type: "delta", message: d, correlationId: cid });
              }
              if (Date.now() > deadline) throw new Error("STEP_TIMEOUT");
            }
          } else if (stream && typeof stream[Symbol.asyncIterator] === "function") {
            const deadline = Date.now() + TIMEOUT_MS;
            for await (const _ev of stream) {
              if (Date.now() > deadline) throw new Error("STEP_TIMEOUT");
            }
          }
          await withTimeout(stream == null ? void 0 : stream.completed, TIMEOUT_MS).catch(() => {
          });
          const fr = await withTimeout(stream == null ? void 0 : stream.finalResult, TIMEOUT_MS).catch(() => void 0);
          const finalOut = typeof (fr == null ? void 0 : fr.finalOutput) === "string" ? fr.finalOutput : "";
          return finalOut || collected;
        } else {
          const res = await withTimeout(runner.run(agentInstance, prompt, { stream: false }), TIMEOUT_MS);
          return typeof (res == null ? void 0 : res.finalOutput) === "string" ? res.finalOutput : "";
        }
      } finally {
        durationMs = Date.now() - start;
      }
    };
    while (true) {
      try {
        attempt += 1;
        text = await runOnce();
        break;
      } catch (err) {
        const isTimeout = err && String(err.message || "").includes("STEP_TIMEOUT");
        if (attempt <= MAX_RETRIES) {
          onEvent({ type: "warning", message: `Step ${sid} failed${isTimeout ? " (timeout)" : ""}; retrying`, data: { attempt }, correlationId: cid });
          continue;
        }
        onEvent({ type: "warning", message: `Step ${sid} failed; proceeding best-effort`, data: { error: String((err == null ? void 0 : err.message) || err) }, correlationId: cid });
        text = "";
        break;
      }
    }
    if (sid === "strategy") {
      artifacts.strategy = { rawText: text };
      try {
        const parsed = JSON.parse(text);
        artifacts.strategy = { rawText: text, rationale: parsed.rationale, writerBrief: parsed.writerBrief, knobs: (_c2 = parsed.knobs) != null ? _c2 : (_b2 = parsed.writerBrief) == null ? void 0 : _b2.knobs };
      } catch {
      }
    } else if (sid === "generation") {
      artifacts.generation = { rawText: text, draftText: text };
    } else if (sid === "qa") {
      artifacts.qa = { rawText: text };
      try {
        const parsed = JSON.parse(text);
        artifacts.qa = { rawText: text, result: normalizeQaReport(parsed) };
      } catch {
      }
    }
    try {
      const last = plan.steps.find((s) => s.id === stepId) || plan.steps.find((s) => s.status === "in_progress");
      const id = stepId || (last == null ? void 0 : last.id) || `step_${sid}_${plan.version}`;
      const parsed = (() => {
        try {
          return JSON.parse(text);
        } catch {
          return void 0;
        }
      })();
      const hasError = !text;
      stepResults.push({ stepId: id, output: parsed != null ? parsed : text, error: hasError ? "step_failed_or_timeout" : void 0, metrics: { durationMs, attempt, capabilityId: sid } });
      onEvent({ type: "metrics", durationMs, correlationId: cid });
    } catch {
    }
  };
  const plannerSystem = [
    "You are the Orchestrator. Output a single JSON object matching PlanPatch: { stepsAdd: PlanStep[], stepsUpdate: PlanStepUpdate[], stepsRemove: string[], note?: string }.",
    'Use capabilityId values "strategy", "generation", "qa". Always include a finalize step.',
    "Initial planning: create a minimal plan [strategy -> generation -> qa -> finalize].",
    "Replanning: only extend the plan if QA indicates revision is required (pass=false or score below threshold). In that case, add [generation, qa] steps to revise and re-check.",
    "Do not re-add steps that are already present; avoid duplicates.",
    "Every step must include a note with a short task description (maximum 5 words). Use elements from the brief to create meaningful task descriptions."
  ].join("\n");
  const planWithLLM = async () => {
    var _a2, _b2, _c2, _d2, _e2, _f2, _g2, _h2, _i2, _j2;
    const activePlan = { version: plan.version, steps: plan.steps.map((s) => ({ id: s.id, capabilityId: s.capabilityId, action: s.action, status: s.status, note: s.note })) };
    const qaObj = ((_a2 = artifacts.qa) == null ? void 0 : _a2.result) || null;
    const genHasDraft = typeof ((_b2 = artifacts.generation) == null ? void 0 : _b2.draftText) === "string" && artifacts.generation.draftText.trim().length > 0;
    const constraints = {
      maxRevisionCycles: (_d2 = (_c2 = req.options) == null ? void 0 : _c2.maxRevisionCycles) != null ? _d2 : 1,
      qualityThreshold: (_f2 = (_e2 = req.options) == null ? void 0 : _e2.qualityThreshold) != null ? _f2 : agentThresholds.minCompositeScore
    };
    const context = [
      `Objective:
${req.objective}`,
      `CurrentPlan:
${JSON.stringify(activePlan)}`,
      `ArtifactsSummary:
${JSON.stringify({ hasDraft: genHasDraft, qa: qaObj ? { compliance: qaObj.compliance, composite: qaObj.composite, issues: (_g2 = qaObj.contentRecommendations || qaObj.suggestedChanges || []) == null ? void 0 : _g2.length } : null })}`,
      `Constraints:
${JSON.stringify(constraints)}`,
      `HumanInput:
${JSON.stringify({ pendingRequestId: (_h2 = hitlPending == null ? void 0 : hitlPending.id) != null ? _h2 : null, pendingQuestion: (_i2 = hitlPending == null ? void 0 : hitlPending.payload) == null ? void 0 : _i2.question, responses: hitlState.responses.slice(-5).map((r) => ({ requestId: r.requestId, responseType: r.responseType, selectedOptionId: r.selectedOptionId, approved: r.approved })) })}`,
      "Rules:\n- Only create an initial plan once.\n- On replanning, only add [generation, qa] if QA indicates revision is needed and cycles remain.\n- Never duplicate existing steps."
    ].join("\n\n");
    const messages = [
      { role: "system", content: plannerSystem },
      { role: "user", content: context }
    ];
    const res = await runtime.runChat(messages, void 0, { toolPolicy: "off" });
    const text = res.content || "";
    try {
      onEvent({ type: "message", message: "planner_text", data: { preview: String(text).slice(0, 400) }, correlationId: cid });
    } catch {
    }
    let patch = null;
    const candidates = extractJsonCandidates(text);
    try {
      onEvent({ type: "message", message: "planner_candidates", data: { count: candidates.length }, correlationId: cid });
    } catch {
    }
    for (const cand of candidates) {
      try {
        const obj = JSON.parse(cand);
        const candidate = (_j2 = obj.planPatch) != null ? _j2 : obj;
        const parsed = PlanPatchSchema.safeParse(candidate);
        if (parsed.success) patch = parsed.data;
        else patch = normalizePlanPatchInput(candidate, plan);
        if (patch) break;
      } catch {
      }
    }
    if (patch) {
      applyPlanPatch(plan, patch);
      emitPlanUpdate(patch);
    } else {
      try {
        onEvent({ type: "warning", message: "planner_parse_failed", data: { length: text.length }, correlationId: cid });
      } catch {
      }
      if (plan.steps.length === 0) {
        const fallback = {
          stepsAdd: [
            { id: "strategy_1", capabilityId: "strategy", status: "pending", note: "Initial strategy" },
            { id: "generation_1", capabilityId: "generation", status: "pending", note: "Initial draft" },
            { id: "qa_1", capabilityId: "qa", status: "pending", note: "Initial QA" }
          ]
        };
        applyPlanPatch(plan, fallback);
        emitPlanUpdate(fallback);
      }
    }
    ensureFinalizeStep();
  };
  const addRevisionIfNeeded = () => {
    var _a2, _b2, _c2, _d2, _e2;
    const maxCycles = (_b2 = (_a2 = req.options) == null ? void 0 : _a2.maxRevisionCycles) != null ? _b2 : 1;
    const qa2 = (_c2 = artifacts.qa) == null ? void 0 : _c2.result;
    const score = typeof (qa2 == null ? void 0 : qa2.composite) === "number" ? qa2.composite : void 0;
    const pass = typeof (qa2 == null ? void 0 : qa2.compliance) === "boolean" ? qa2.compliance : void 0;
    const threshold = (_e2 = (_d2 = req.options) == null ? void 0 : _d2.qualityThreshold) != null ? _e2 : agentThresholds.minCompositeScore;
    const genDone = plan.steps.filter((s) => s.capabilityId === "generation" && s.status === "done").length;
    const revisionCycles = Math.max(0, genDone - 1);
    const needsRevision = !!qa2 && pass === false || typeof score === "number" && score < threshold;
    if (needsRevision && revisionCycles < maxCycles) {
      const patch = {
        stepsAdd: [
          { id: `rev_generation_${revisionCycles + 1}`, capabilityId: "generation", status: "pending", note: "Revise content" },
          { id: `rev_qa_${revisionCycles + 1}`, capabilityId: "qa", status: "pending", note: "QA recheck" }
        ]
      };
      applyPlanPatch(plan, patch);
      emitPlanUpdate(patch);
      const finals = plan.steps.filter((s) => s.action === "finalize" && s.status !== "done");
      const lastIsFinal = plan.steps.length > 0 && plan.steps[plan.steps.length - 1].action === "finalize";
      if (finals.length > 0 && !lastIsFinal) {
        const removeIds = finals.map((s) => s.id);
        const newFinal = { id: `auto_finalize_${plan.version + 1}`, action: "finalize", status: "pending", note: "Final review" };
        const rePatch = { stepsRemove: removeIds, stepsAdd: [newFinal] };
        applyPlanPatch(plan, rePatch);
        emitPlanUpdate(rePatch);
      }
    }
    ensureFinalizeStep();
  };
  if (resumeKey && RESUME_STORE.has(resumeKey)) {
    try {
      const snap = RESUME_STORE.get(resumeKey);
      if (snap == null ? void 0 : snap.plan) {
        plan.version = snap.plan.version || 0;
        plan.steps = Array.isArray(snap.plan.steps) ? [...snap.plan.steps] : [];
      }
      if (Array.isArray((_e = snap == null ? void 0 : snap.runReport) == null ? void 0 : _e.steps)) stepResults.push(...snap.runReport.steps);
      else if (Array.isArray(snap == null ? void 0 : snap.history)) stepResults.push(...snap.history);
      onEvent({ type: "message", message: "Resuming existing thread state", correlationId: cid });
    } catch {
    }
  } else {
    try {
      await planWithLLM();
    } catch (err) {
      try {
        onEvent({ type: "warning", message: "Planning failed; finalizing best-effort", data: { error: String((err == null ? void 0 : err.message) || err) }, correlationId: cid });
      } catch {
      }
      ensureFinalizeStep();
    }
  }
  let state = "plan";
  let finalizeStepId = void 0;
  let finished = false;
  const getNextPendingStep = () => {
    const nonFinalize = plan.steps.find((s) => s.status === "pending" && !s.action);
    return nonFinalize || plan.steps.find((s) => s.status === "pending");
  };
  for (; ; ) {
    if (finished) break;
    if (state === "plan") {
      const next = getNextPendingStep();
      if (!next) {
        try {
          if (plan.steps.length === 0) await planWithLLM();
          else ensureFinalizeStep();
        } catch (err) {
          try {
            onEvent({ type: "warning", message: "Planning failed; switching to finalize", data: { error: String((err == null ? void 0 : err.message) || err) }, correlationId: cid });
          } catch {
          }
          ensureFinalizeStep();
        }
        continue;
      }
      state = "step";
    } else if (state === "step") {
      const next = getNextPendingStep();
      if (next.action === "finalize") {
        setStepStatusById(next.id, "in_progress");
        finalizeStepId = next.id;
        onEvent({ type: "phase", phase: "finalization", message: "Finalizing", correlationId: cid });
        state = "final";
        finished = true;
        break;
      }
      setStepStatusById(next.id, "in_progress");
      if (next.capabilityId === "strategy") onEvent({ type: "phase", phase: "analysis", message: "Strategy Manager", correlationId: cid });
      else if (next.capabilityId === "generation") onEvent({ type: "phase", phase: "generation", message: "Content Generator", correlationId: cid });
      else if (next.capabilityId === "qa") onEvent({ type: "phase", phase: "qa", message: "Quality Assurance", correlationId: cid });
      await withHitlContext(
        {
          runId,
          threadId: resumeKey,
          stepId: next.id,
          capabilityId: next.capabilityId,
          hitlService,
          limit: { current: hitlAcceptedCount, max: hitlMax },
          onRequest: signalHitlRequest,
          onDenied: signalHitlDenied,
          snapshot: hitlState
        },
        async () => {
          await executeSpecialistStep(next.id, next.capabilityId, buildPayloadForCapability(next.capabilityId));
        }
      );
      refreshHitlDerivedState(hitlState);
      setStepStatusById(next.id, "done");
      if (hitlAwaiting) {
        onEvent({ type: "phase", phase: "idle", message: "Awaiting human input", correlationId: cid });
        finished = true;
        break;
      }
      state = "replan";
    } else if (state === "replan") {
      addRevisionIfNeeded();
      state = "plan";
    }
  }
  if (hitlAwaiting) {
    const pendingSummary = {
      status: "pending_hitl",
      pendingRequestId: hitlAwaiting.id,
      originAgent: hitlAwaiting.originAgent,
      question: hitlAwaiting.payload.question
    };
    try {
      getLogger().info("hitl_run_pending", {
        runId,
        requestId: hitlAwaiting.id,
        pendingCount: hitlState.requests.filter((r) => r.status === "pending").length
      });
    } catch {
    }
    writeResumeSnapshot({ plan, history: [...stepResults], hitl: hitlState });
    onEvent({ type: "complete", data: pendingSummary, correlationId: cid });
    return { final: pendingSummary, metrics: { hitlPending: true } };
  }
  const hasContent = typeof ((_f = artifacts.generation) == null ? void 0 : _f.draftText) === "string" && artifacts.generation.draftText.trim().length > 0;
  const resultObj = {
    platform: ((_h = (_g = artifacts.strategy) == null ? void 0 : _g.writerBrief) == null ? void 0 : _h.platform) || "generic",
    content: hasContent ? artifacts.generation.draftText : ""
  };
  if (((_i = artifacts.strategy) == null ? void 0 : _i.rationale) != null) resultObj.rationale = artifacts.strategy.rationale;
  if (((_j = artifacts.strategy) == null ? void 0 : _j.knobs) != null) resultObj.knobSettings = artifacts.strategy.knobs;
  const qa = (_k = artifacts.qa) == null ? void 0 : _k.result;
  const hasQa = !!qa && typeof qa === "object";
  const quality = hasQa ? {
    score: typeof qa.composite === "number" ? qa.composite : void 0,
    issues: Array.isArray(qa.contentRecommendations) ? qa.contentRecommendations : Array.isArray(qa.suggestedChanges) ? qa.suggestedChanges : void 0,
    pass: typeof qa.compliance === "boolean" ? qa.compliance : void 0,
    metrics: {
      readability: typeof qa.readability === "number" ? qa.readability : void 0,
      clarity: typeof qa.clarity === "number" ? qa.clarity : void 0,
      objectiveFit: typeof qa.objectiveFit === "number" ? qa.objectiveFit : void 0,
      brandRisk: typeof qa.brandRisk === "number" ? qa.brandRisk : void 0
    }
  } : { score: void 0, issues: void 0, pass: void 0, metrics: void 0 };
  const criteria = [];
  if (!hasContent) {
    onEvent({ type: "warning", message: "No content generated; finalizing with explanation", data: { reason: "missing_generation" }, correlationId: cid });
    criteria.push({ criterion: "content_generated", passed: false, details: "No generation specialist output available." });
  } else {
    criteria.push({ criterion: "content_generated", passed: true });
  }
  if (!hasQa) {
    onEvent({ type: "warning", message: "QA not performed; quality unknown", data: { reason: "missing_qa" }, correlationId: cid });
    criteria.push({ criterion: "qa_performed", passed: false, details: "No QA specialist output available." });
  } else {
    criteria.push({ criterion: "qa_performed", passed: true });
  }
  const overall = criteria.every((c) => c.passed);
  const acceptanceReport = { overall, criteria };
  const finalBundle = { result: resultObj, quality, ["acceptance-report"]: acceptanceReport };
  if (hasQa) finalBundle["quality-report"] = qa;
  if (finalizeStepId) {
    try {
      setStepStatusById(finalizeStepId, "done");
    } catch {
    }
  }
  const runReport = {
    steps: [...stepResults],
    summary: {
      steps: stepResults.length,
      failures: stepResults.filter((s) => !!s.error).length,
      durationMs: stepResults.reduce((acc, s) => {
        var _a2;
        return acc + (Number((_a2 = s.metrics) == null ? void 0 : _a2.durationMs) || 0);
      }, 0)
    }
  };
  writeResumeSnapshot({ plan, history: [...stepResults], runReport, hitl: hitlState });
  onEvent({ type: "metrics", data: runReport.summary, correlationId: cid });
  onEvent({ type: "message", message: "run_report", data: runReport, correlationId: cid });
  onEvent({ type: "complete", data: finalBundle, correlationId: cid });
  return { final: finalBundle, metrics: runReport.summary };
}
function normalizeQaReport(input) {
  const out = typeof input === "object" && input ? { ...input } : {};
  if (!Array.isArray(out.contentRecommendations)) {
    if (Array.isArray(out.suggestedChanges)) out.contentRecommendations = out.suggestedChanges;
    else if (Array.isArray(out.Suggestions)) out.contentRecommendations = out.Suggestions;
  }
  const clamp01 = (n) => {
    const v = Number(n);
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : void 0;
  };
  if ("readability" in out) out.readability = clamp01(out.readability);
  if ("clarity" in out) out.clarity = clamp01(out.clarity);
  if ("objectiveFit" in out) out.objectiveFit = clamp01(out.objectiveFit);
  if ("brandRisk" in out) out.brandRisk = clamp01(out.brandRisk);
  if ("composite" in out) out.composite = clamp01(out.composite);
  return out;
}

class OrchestratorAgent {
  constructor(runtime) {
    this.runtime = runtime;
  }
  async run(req, onEvent, correlationId) {
    return runOrchestratorEngine(this.runtime, req, onEvent, correlationId);
  }
}
function getOrchestrator() {
  const { runtime } = getAgents();
  return new OrchestratorAgent(runtime);
}

export { OrchestratorAgent, getOrchestrator };
//# sourceMappingURL=orchestrator-agent.mjs.map
