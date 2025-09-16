import { AgentRunRequest, AgentEvent, Plan, PlanPatchSchema, PlanStepStatus, StepResult, RunReport } from '@awesomeposter/shared';
import { AgentRuntime } from './agent-runtime';
import { getCapabilityRegistry } from './agents-container';
import { Runner } from '@openai/agents';
import { createStrategyAgent } from '../agents/strategy-manager';
import { createContentAgent } from '../agents/content-generator';
import { createQaAgent } from '../agents/quality-assurance';

type SpecialistId = 'strategy' | 'generation' | 'qa';

const RESUME_STORE = new Map<string, { plan: Plan; history: any[]; runReport?: RunReport; updatedAt: number }>();

function mapToCapabilityIdOrAction(value: any): { capabilityId?: string; action?: 'finalize' } | undefined {
  const s = String(value || '').toLowerCase().trim();
  if (!s) return undefined;
  if (s === 'final' || s === 'finalize' || /finish|complete/.test(s)) return { action: 'finalize' };
  return { capabilityId: s };
}

function defaultNoteForStep(target?: { capabilityId?: string; action?: 'finalize' }) {
  if (!target) return undefined;
  if (target.action === 'finalize') return 'Final review';
  switch (target.capabilityId) {
    case 'strategy':
      return 'Strategy plan';
    case 'generation':
      return 'Draft content';
    case 'qa':
      return 'QA review';
    default:
      return undefined;
  }
}

function normalizePlanPatchInput(
  input: any,
  targetPlan: Plan
): {
  stepsAdd?: Array<{ id: string; capabilityId?: string; action?: 'finalize'; label?: string; status: PlanStepStatus; note?: string }>;
  stepsUpdate?: Array<{ id: string; status?: PlanStepStatus; note?: string }>;
  stepsRemove?: string[];
  note?: string;
} | null {
  if (!input) return null;
  const out: any = {};
  // Helper to generate unique ids per base
  const existingIds = new Set(targetPlan.steps.map((s) => s.id));
  const uniqueId = (base: string) => {
    let idx = targetPlan.steps.filter((s) => (s.capabilityId || s.action || '').toString() === base).length + 1;
    let id = `auto_${base.replace(/[^a-z0-9_.-]/gi, '_')}_${idx}`;
    while (existingIds.has(id)) {
      idx += 1;
      id = `auto_${base.replace(/[^a-z0-9_.-]/gi, '_')}_${idx}`;
    }
    existingIds.add(id);
    return id;
  };

  // Accept RFC6902 JSON Patch arrays
  if (Array.isArray(input)) {
    for (const op of input) {
      if (!op || typeof op !== 'object') continue;
      const operation = String((op as any).op || '').toLowerCase();
      const path = String((op as any).path || '');
      if (operation !== 'add' || !path) continue;
      const value = (op as any).value;
      let note = typeof value?.details === 'string' ? value.details : undefined;
      if (path.startsWith('/strategies')) {
        out.stepsAdd ??= [];
        note = note || defaultNoteForStep({ capabilityId: 'strategy' });
        out.stepsAdd.push({ id: uniqueId('strategy'), capabilityId: 'strategy', status: 'pending', note });
      } else if (path.startsWith('/generations')) {
        out.stepsAdd ??= [];
        note = note || defaultNoteForStep({ capabilityId: 'generation' });
        out.stepsAdd.push({ id: uniqueId('generation'), capabilityId: 'generation', status: 'pending', note });
      } else if (path.startsWith('/qas')) {
        out.stepsAdd ??= [];
        note = note || defaultNoteForStep({ capabilityId: 'qa' });
        out.stepsAdd.push({ id: uniqueId('qa'), capabilityId: 'qa', status: 'pending', note });
      } else if (path.startsWith('/finalize')) {
        out.stepsAdd ??= [];
        note = note || defaultNoteForStep({ action: 'finalize' });
        out.stepsAdd.push({ id: uniqueId('finalize'), action: 'finalize', status: 'pending', note });
      }
    }
  }
  if (typeof input !== 'object') {
    return out.stepsAdd || out.stepsUpdate || out.stepsRemove || out.note ? out : null;
  }
  const add = (input as any).stepsAdd ?? (input as any).add ?? (input as any).steps;
  if (Array.isArray(add)) {
    out.stepsAdd = out.stepsAdd ?? [];
    for (const raw of add) {
      if (typeof raw === 'string') {
        const mapped = mapToCapabilityIdOrAction(raw);
        if (!mapped) continue;
        const base = mapped.capabilityId || mapped.action || 'step';
        out.stepsAdd.push({ id: uniqueId(String(base)), ...mapped, status: 'pending' as PlanStepStatus, note: defaultNoteForStep(mapped) });
        continue;
      }
      if (raw && typeof raw === 'object') {
        const m =
          mapToCapabilityIdOrAction((raw as any).capabilityId ?? (raw as any).step ?? (raw as any).kind ?? (raw as any).type ?? (raw as any).name) ||
          (typeof (raw as any).capabilityId === 'string' ? { capabilityId: (raw as any).capabilityId } : undefined);
        if (!m) continue;
        const base = ((m as any).capabilityId ?? (m as any).action ?? 'step') as string;
        const id = typeof (raw as any).id === 'string' ? String((raw as any).id) : uniqueId(String(base));
        let note =
          typeof (raw as any).note === 'string'
            ? (raw as any).note
            : typeof (raw as any).description === 'string'
            ? (raw as any).description
            : undefined;
        let status: PlanStepStatus = 'pending';
        const s = String((raw as any).status || '').toLowerCase();
        if (s === 'in_progress' || s === 'inprogress' || s === 'active') status = 'in_progress';
        else if (s === 'done' || s === 'complete' || s === 'completed') status = 'done';
        else if (s === 'skipped') status = 'skipped';
        const label = typeof (raw as any).label === 'string' ? (raw as any).label : undefined;
        if (!note) note = defaultNoteForStep(m);
        out.stepsAdd.push({ id, ...m, label, status, note });
      }
    }
    if (out.stepsAdd.length === 0) delete out.stepsAdd;
  }

  if (Array.isArray((input as any).stepsUpdate)) {
    out.stepsUpdate = [];
    for (const u of (input as any).stepsUpdate) {
      if (!u || typeof u !== 'object') continue;
      let id = (u as any).id;
      if (!id && (u as any).step) {
        const m = mapToCapabilityIdOrAction((u as any).step);
        const match = m?.capabilityId
          ? targetPlan.steps.find((s) => s.capabilityId === m!.capabilityId)
          : m?.action
          ? targetPlan.steps.find((s) => s.action === m!.action)
          : undefined;
        id = match?.id;
      }
      if (typeof id !== 'string') continue;
      const note = typeof (u as any).note === 'string' ? (u as any).note : undefined;
      let status: PlanStepStatus | undefined = undefined;
      if ((u as any).status) {
        const s = String((u as any).status || '').toLowerCase();
        if (s === 'in_progress' || s === 'inprogress' || s === 'active') status = 'in_progress';
        else if (s === 'done' || s === 'complete' || s === 'completed') status = 'done';
        else if (s === 'skipped') status = 'skipped';
        else if (s === 'pending') status = 'pending';
      }
      out.stepsUpdate.push({ id, status, note });
    }
    if (out.stepsUpdate.length === 0) delete out.stepsUpdate;
  }

  if (Array.isArray((input as any).stepsRemove)) {
    out.stepsRemove = (input as any).stepsRemove.map((x: any) => String(x)).filter(Boolean);
    if (out.stepsRemove.length === 0) delete out.stepsRemove;
  }
  const note = (input as any).note;
  if (typeof note === 'string' && note.trim().length > 0) out.note = note;
  if (
    !out.stepsAdd &&
    !out.stepsUpdate &&
    !out.stepsRemove &&
    typeof out.note !== 'string'
  )
    return null;
  return out;
}

function applyPlanPatch(targetPlan: Plan, patch: any) {
  if (!patch || typeof patch !== 'object') return;
  if (Array.isArray(patch.stepsAdd)) {
    const existingIds = new Set(targetPlan.steps.map((s) => s.id));
    for (const s of patch.stepsAdd) {
      if (!s || typeof s !== 'object' || typeof s.id !== 'string') continue;
      if (existingIds.has(s.id)) continue;
      const newStep: any = { id: String(s.id), status: (s as any).status };
      if (typeof (s as any).capabilityId === 'string') newStep.capabilityId = String((s as any).capabilityId);
      if (typeof (s as any).action === 'string') newStep.action = String((s as any).action);
      if (typeof (s as any).label === 'string') newStep.label = String((s as any).label);
      if (typeof (s as any).note === 'string') newStep.note = String((s as any).note);
      targetPlan.steps.push(newStep);
      existingIds.add(s.id);
    }
  }
  if (Array.isArray(patch.stepsUpdate)) {
    for (const u of patch.stepsUpdate) {
      if (!u || typeof u !== 'object' || typeof u.id !== 'string') continue;
      const step = targetPlan.steps.find((s) => s.id === u.id);
      if (!step) continue;
      if (u.status) step.status = u.status as any;
      if (typeof u.note === 'string') step.note = u.note;
    }
  }
  if (Array.isArray(patch.stepsRemove)) {
    targetPlan.steps = targetPlan.steps.filter((s) => !patch.stepsRemove!.includes(s.id));
  }
}

function extractJsonCandidates(text: string): string[] {
  // Extract balanced JSON-like segments starting at '{' or '['.
  // Handles nested structures and quotes to avoid premature termination.
  const out: string[] = []
  const n = text.length
  for (let i = 0; i < n; i++) {
    const start = text[i]
    if (start !== '{' && start !== '[') continue
    const endCh = start === '{' ? '}' : ']'
    let depth = 0
    let inStr = false
    let esc = false
    for (let j = i; j < n; j++) {
      const c = text[j]
      if (inStr) {
        if (esc) { esc = false; continue }
        if (c === '\\') { esc = true; continue }
        if (c === '"') { inStr = false; continue }
        continue
      }
      if (c === '"') { inStr = true; continue }
      if (c === start) depth++
      else if (c === endCh) {
        depth--
        if (depth === 0) {
          out.push(text.slice(i, j + 1))
          i = j
          break
        }
      }
    }
  }
  return out
}

export async function runOrchestratorEngine(
  runtime: AgentRuntime,
  req: AgentRunRequest,
  onEvent: (e: AgentEvent) => void,
  correlationId?: string
): Promise<{ final: any; metrics?: any }> {
  const cid = correlationId || `run_${Math.random().toString(36).slice(2)}`;
  onEvent({ type: 'start', correlationId: cid, message: 'Run started', data: { threadId: (req as any).threadId } });

  // Build capability-driven registry using app-level registry entries
  const capabilityEntries = getCapabilityRegistry();
  const policy = (req.options as any)?.toolPolicy as 'auto' | 'required' | 'off' | undefined;
  const requestAllowlist = (req.options as any)?.toolsAllowlist as string[] | undefined;

  const toolEventForwarder = (ev: any) => {
    const name = String(ev?.name || '');
    if (ev?.type === 'tool_call') onEvent({ type: 'tool_call', message: name, data: { args: ev.args }, correlationId: cid });
    if (ev?.type === 'tool_result') onEvent({ type: 'tool_result', message: name, data: { result: ev.result }, durationMs: ev.durationMs, correlationId: cid });
    if (ev?.type === 'metrics') onEvent({ type: 'metrics', tokens: ev.tokens, durationMs: ev.durationMs, correlationId: cid });
  };

  const registry: Record<SpecialistId, { name: string; instance?: any }> = {} as any;
  for (const entry of capabilityEntries) {
    try {
      const instance = (entry.create as any)(runtime, toolEventForwarder, { policy, requestAllowlist }, 'app');
      (registry as any)[entry.id] = { name: entry.name, instance };
    } catch {
      // If creation fails, keep registry slot absent; planner may replan/finalize
    }
  }

  const plan: Plan = { version: 0, steps: [] };

  // Aggregate step results for consolidation (RunReport)
  const stepResults: StepResult[] = [];

  const artifacts: {
    strategy?: { rationale?: string; writerBrief?: any; knobs?: any; rawText?: string };
    generation?: { draftText?: string; rawText?: string };
    qa?: { result?: any; rawText?: string };
  } = {};

  // Future: threadId should be preferred over briefId for resumability; briefId kept only as legacy fallback when present.
  const resumeKey = (req as any).threadId || (req.mode === 'app' ? (req.briefId || undefined) : undefined);

  const emitPlanUpdate = (patch: any) => {
    plan.version += 1;
    onEvent({ type: 'plan_update' as any, data: { patch, planVersion: plan.version, plan }, correlationId: cid });
    if (resumeKey) {
      try {
        const snapshot = {
          plan: JSON.parse(JSON.stringify(plan)),
          history: [...stepResults],
          runReport: { steps: [...stepResults] } as RunReport,
          updatedAt: Date.now(),
        };
        RESUME_STORE.set(resumeKey, snapshot as any);
      } catch {}
    }
  };

  const ensureFinalizeStep = () => {
    let step = plan.steps.find((s) => s.action === 'finalize');
    if (!step) {
      const newStep = { id: 'auto_finalize_1', action: 'finalize' as const, status: 'pending' as PlanStepStatus, note: 'Final review' };
      plan.steps.push(newStep as any);
      emitPlanUpdate({ stepsAdd: [newStep] });
      step = newStep as any;
    }
    return step;
  };

  const setStepStatusById = (id: string, status: PlanStepStatus, note?: string) => {
    const step = plan.steps.find((s) => s.id === id);
    if (!step) return;
    step.status = status;
    if (note) step.note = note;
    emitPlanUpdate({ stepsUpdate: [{ id, status, note }] });
  };

  const buildPayloadForCapability = (capabilityId?: string) => {
    if (capabilityId === 'generation') {
      const payload: any = { writerBrief: artifacts.strategy?.writerBrief, knobs: artifacts.strategy?.knobs };
      // If we have QA feedback and a previous draft, treat as a revision task
      const qaRec = (artifacts.qa?.result as any)?.contentRecommendations;
      if (Array.isArray(qaRec) && qaRec.length > 0) payload.contentRecommendations = qaRec;
      if (typeof artifacts.generation?.draftText === 'string' && artifacts.generation!.draftText!.trim().length > 0) payload.previousDraft = artifacts.generation!.draftText;
      return payload;
    }
    if (capabilityId === 'qa') {
      return { draftText: artifacts.generation?.draftText };
    }
    return {};
  };

  const executeSpecialistStep = async (stepId: string, capabilityId?: string, payload?: any) => {
    const sid = capabilityId as SpecialistId;
    const agentInstance = registry[sid]?.instance;
    if (!agentInstance) return;
    onEvent({ type: 'handoff', message: 'occurred', data: { from: 'orchestrator', to: registry[sid]!.name }, correlationId: cid });
    const runner = new Runner({ model: runtime.getModel() });
    const payloadText = (() => {
      try { return JSON.stringify(payload ?? {}, null, 2); } catch { return String(payload ?? ''); }
    })();
    const prompt = [`Objective:\n${req.objective}`, `Payload:\n${payloadText}`, `Follow your role instructions and use tools as needed.`].join('\n\n');
    const startedAt = Date.now();

    // Per-step reliability: timeout + limited retries (strategy tends to take longer)
    const TIMEOUT_MS = sid === 'strategy' ? 90000 : 30000;
    const MAX_RETRIES = sid === 'strategy' ? 0 : 1;
    let text = '';
    let attempt = 0;
    let durationMs = 0;
    const withTimeout = async <T>(p: Promise<T>, ms: number) => {
      return await Promise.race([
        p,
        new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error('STEP_TIMEOUT')), ms))
      ])
    };
    const runOnce = async (): Promise<string> => {
      const start = Date.now();
      try {
        if (sid === 'generation' || sid === 'qa') {
          const stream: any = await withTimeout(runner.run(agentInstance as any, prompt, { stream: true }), TIMEOUT_MS);
          let collected = '';
          if (stream && typeof stream.toTextStream === 'function') {
            const textStream: any = stream.toTextStream({ compatibleWithNodeStreams: false });
            const deadline = Date.now() + TIMEOUT_MS;
            for await (const chunk of textStream) {
              const d = chunk?.toString?.() ?? String(chunk ?? '');
              if (d) {
                collected += d;
                onEvent({ type: 'delta', message: d, correlationId: cid });
              }
              if (Date.now() > deadline) throw new Error('STEP_TIMEOUT');
            }
          } else if (stream && typeof stream[Symbol.asyncIterator] === 'function') {
            const deadline = Date.now() + TIMEOUT_MS;
            for await (const _ev of stream as any) {
              if (Date.now() > deadline) throw new Error('STEP_TIMEOUT');
            }
          }
          await withTimeout((stream as any)?.completed, TIMEOUT_MS).catch(() => {});
          const fr: any = await withTimeout((stream as any)?.finalResult, TIMEOUT_MS).catch(() => undefined);
          const finalOut = typeof fr?.finalOutput === 'string' ? fr.finalOutput : '';
          return finalOut || collected;
        } else {
          const res: any = await withTimeout(runner.run(agentInstance as any, prompt, { stream: false }), TIMEOUT_MS);
          return typeof res?.finalOutput === 'string' ? res.finalOutput : '';
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
      } catch (err: any) {
        const isTimeout = err && String(err.message || '').includes('STEP_TIMEOUT');
        if (attempt <= MAX_RETRIES) {
          onEvent({ type: 'warning', message: `Step ${sid} failed${isTimeout ? ' (timeout)' : ''}; retrying`, data: { attempt }, correlationId: cid });
          continue;
        }
        onEvent({ type: 'warning', message: `Step ${sid} failed; proceeding best-effort`, data: { error: String(err?.message || err) }, correlationId: cid });
        text = '';
        break;
      }
    }
    if (sid === 'strategy') {
      artifacts.strategy = { rawText: text };
      try { const parsed = JSON.parse(text); artifacts.strategy = { rawText: text, rationale: parsed.rationale, writerBrief: parsed.writerBrief, knobs: parsed.knobs ?? parsed.writerBrief?.knobs }; } catch {}
    } else if (sid === 'generation') {
      artifacts.generation = { rawText: text, draftText: text };
    } else if (sid === 'qa') {
      artifacts.qa = { rawText: text };
      try {
        const parsed: any = JSON.parse(text);
        artifacts.qa = { rawText: text, result: normalizeQaReport(parsed) };
      } catch {}
    }

    // Record step result best-effort
    try {
      const last = plan.steps.find((s) => s.id === stepId) || plan.steps.find((s) => s.status === 'in_progress');
      const id = stepId || last?.id || `step_${sid}_${plan.version}`;
      const parsed = (() => { try { return JSON.parse(text); } catch { return undefined; } })();
      const hasError = !text;
      stepResults.push({ stepId: id, output: parsed ?? text, error: hasError ? 'step_failed_or_timeout' : undefined, metrics: { durationMs, attempt, capabilityId: sid } });
      onEvent({ type: 'metrics', durationMs, correlationId: cid });
    } catch {}
  };

  const plannerSystem = [
    'You are the Orchestrator. Output a single JSON object matching PlanPatch: { stepsAdd: PlanStep[], stepsUpdate: PlanStepUpdate[], stepsRemove: string[], note?: string }.',
    'Use capabilityId values "strategy", "generation", "qa". Always include a finalize step.',
    'Initial planning: create a minimal plan [strategy -> generation -> qa -> finalize].',
    'Replanning: only extend the plan if QA indicates revision is required (pass=false or score below threshold). In that case, add [generation, qa] steps to revise and re-check.',
    'Do not re-add steps that are already present; avoid duplicates.',
    'Every step must include a note with a short task description (maximum 5 words).'
  ].join('\n');

  const planWithLLM = async () => {
    const activePlan = { version: plan.version, steps: plan.steps.map(s => ({ id: s.id, capabilityId: s.capabilityId, action: s.action, status: s.status, note: s.note })) } as any;
    const qaObj: any = artifacts.qa?.result || null;
    const genHasDraft = typeof artifacts.generation?.draftText === 'string' && artifacts.generation!.draftText!.trim().length > 0;
    const constraints = {
      maxRevisionCycles: (req.options as any)?.maxRevisionCycles ?? 1,
      qualityThreshold: (req.options as any)?.qualityThreshold ?? 0.7
    };
    const context = [
      `Objective:\n${req.objective}`,
      `CurrentPlan:\n${JSON.stringify(activePlan)}`,
      `ArtifactsSummary:\n${JSON.stringify({ hasDraft: genHasDraft, qa: qaObj ? { compliance: qaObj.compliance, composite: qaObj.composite, issues: (qaObj.contentRecommendations || qaObj.suggestedChanges || [])?.length } : null })}`,
      `Constraints:\n${JSON.stringify(constraints)}`,
      'Rules:\n- Only create an initial plan once.\n- On replanning, only add [generation, qa] if QA indicates revision is needed and cycles remain.\n- Never duplicate existing steps.'
    ].join('\n\n');
    const messages = [
      { role: 'system' as const, content: plannerSystem },
      { role: 'user' as const, content: context }
    ];
    const res = await runtime.runChat(messages, undefined, { toolPolicy: 'off' });
    const text = res.content || '';
    try { onEvent({ type: 'message', message: 'planner_text', data: { preview: String(text).slice(0, 400) }, correlationId: cid }); } catch {}
    let patch: any = null;
    const candidates = extractJsonCandidates(text);
    try { onEvent({ type: 'message', message: 'planner_candidates', data: { count: candidates.length }, correlationId: cid }); } catch {}
    for (const cand of candidates) {
      try {
        const obj = JSON.parse(cand);
        const candidate = (obj as any).planPatch ?? obj;
        const parsed = PlanPatchSchema.safeParse(candidate);
        if (parsed.success) patch = parsed.data;
        else patch = normalizePlanPatchInput(candidate, plan);
        if (patch) break;
      } catch {}
    }
    if (patch) {
      applyPlanPatch(plan, patch);
      emitPlanUpdate(patch);
    } else {
      try { onEvent({ type: 'warning', message: 'planner_parse_failed', data: { length: text.length }, correlationId: cid }); } catch {}
      if (plan.steps.length === 0) {
        const fallback = {
          stepsAdd: [
            { id: 'strategy_1', capabilityId: 'strategy', status: 'pending' as PlanStepStatus, note: 'Initial strategy' },
            { id: 'generation_1', capabilityId: 'generation', status: 'pending' as PlanStepStatus, note: 'Initial draft' },
            { id: 'qa_1', capabilityId: 'qa', status: 'pending' as PlanStepStatus, note: 'Initial QA' }
          ]
        };
        applyPlanPatch(plan, fallback);
        emitPlanUpdate(fallback);
      }
    }
    ensureFinalizeStep();
  };

  const addRevisionIfNeeded = () => {
    const maxCycles = (req.options as any)?.maxRevisionCycles ?? 1;
    const qa = artifacts.qa?.result as any | undefined;
    const score = typeof qa?.composite === 'number' ? qa.composite : undefined;
    const pass = typeof qa?.compliance === 'boolean' ? qa.compliance : undefined;
    const threshold = (req.options as any)?.qualityThreshold ?? 0.7;
    const genDone = plan.steps.filter(s => s.capabilityId === 'generation' && s.status === 'done').length;
    const revisionCycles = Math.max(0, genDone - 1);
    const needsRevision = (!!qa && pass === false) || (typeof score === 'number' && score < threshold);
    if (needsRevision && revisionCycles < maxCycles) {
      const patch = {
        stepsAdd: [
          { id: `rev_generation_${revisionCycles + 1}`, capabilityId: 'generation', status: 'pending' as PlanStepStatus, note: 'Revise content' },
          { id: `rev_qa_${revisionCycles + 1}`, capabilityId: 'qa', status: 'pending' as PlanStepStatus, note: 'QA recheck' }
        ]
      };
      applyPlanPatch(plan, patch);
      emitPlanUpdate(patch);

      // Reposition finalize to end: remove existing pending finalize step(s) and add a new one at the tail
      const finals = plan.steps.filter(s => s.action === 'finalize' && s.status !== 'done');
      const lastIsFinal = plan.steps.length > 0 && plan.steps[plan.steps.length - 1].action === 'finalize';
      if (finals.length > 0 && !lastIsFinal) {
        const removeIds = finals.map(s => s.id);
        const newFinal = { id: `auto_finalize_${plan.version + 1}`, action: 'finalize' as const, status: 'pending' as PlanStepStatus, note: 'Final review' };
        const rePatch = { stepsRemove: removeIds, stepsAdd: [newFinal] };
        applyPlanPatch(plan, rePatch);
        emitPlanUpdate(rePatch);
      }
    }
    ensureFinalizeStep();
  };

  // Resume previous plan/history if available
  if (resumeKey && RESUME_STORE.has(resumeKey)) {
    try {
      const snap = RESUME_STORE.get(resumeKey)!;
      if (snap?.plan) {
        plan.version = snap.plan.version || 0;
        plan.steps = Array.isArray(snap.plan.steps) ? [...snap.plan.steps] : [];
      }
      if (Array.isArray(snap?.runReport?.steps)) stepResults.push(...(snap!.runReport!.steps as StepResult[]));
      else if (Array.isArray(snap?.history)) stepResults.push(...(snap!.history as any[]));
      onEvent({ type: 'message', message: 'Resuming existing thread state', correlationId: cid });
    } catch {}
  } else {
    try {
      await planWithLLM();
    } catch (err: any) {
      try {
        onEvent({ type: 'warning', message: 'Planning failed; finalizing best-effort', data: { error: String(err?.message || err) }, correlationId: cid })
      } catch {}
      ensureFinalizeStep();
    }
  }

  let state: 'plan' | 'step' | 'replan' | 'final' = 'plan';
  let finalizeStepId: string | undefined = undefined;
  let finished = false;
  const getNextPendingStep = () => {
    const nonFinalize = plan.steps.find((s) => s.status === 'pending' && !s.action);
    return nonFinalize || plan.steps.find((s) => s.status === 'pending');
  };
  // Use an infinite loop + explicit break to avoid TS literal-union narrowing warnings
  for (;;) {
    if (finished) break;
    if (state === 'plan') {
      const next = getNextPendingStep();
      if (!next) {
        try {
          // Only ask LLM to plan if we have no steps at all (initial planning)
          if (plan.steps.length === 0) await planWithLLM();
          else ensureFinalizeStep();
        } catch (err: any) {
          try { onEvent({ type: 'warning', message: 'Planning failed; switching to finalize', data: { error: String(err?.message || err) }, correlationId: cid }) } catch {}
          ensureFinalizeStep();
        }
        continue;
      }
      state = 'step';
    } else if (state === 'step') {
      const next = getNextPendingStep()!;
      if (next.action === 'finalize') {
        // Enter finalization phase
        setStepStatusById(next.id, 'in_progress');
        finalizeStepId = next.id;
        onEvent({ type: 'phase', phase: 'finalization' as any, message: 'Finalizing', correlationId: cid });
        state = 'final';
        finished = true;
        break;
      }
      setStepStatusById(next.id, 'in_progress');
      // Emit phase by capability
      if (next.capabilityId === 'strategy') onEvent({ type: 'phase', phase: 'analysis' as any, message: 'Strategy Manager', correlationId: cid });
      else if (next.capabilityId === 'generation') onEvent({ type: 'phase', phase: 'generation' as any, message: 'Content Generator', correlationId: cid });
      else if (next.capabilityId === 'qa') onEvent({ type: 'phase', phase: 'qa' as any, message: 'Quality Assurance', correlationId: cid });
      await executeSpecialistStep(next.id, next.capabilityId as string, buildPayloadForCapability(next.capabilityId));
      setStepStatusById(next.id, 'done');
      state = 'replan';
    } else if (state === 'replan') {
      // On replan, only extend the plan for revisions if QA indicates
      addRevisionIfNeeded();
      state = 'plan';
    }
  }

  // Build FinalBundle: { result, quality, acceptance-report }
  const hasContent = typeof artifacts.generation?.draftText === 'string' && artifacts.generation!.draftText!.trim().length > 0;
  const resultObj: any = {
    platform: (artifacts.strategy?.writerBrief as any)?.platform || 'generic',
    content: hasContent ? artifacts.generation!.draftText! : ''
  };
  if (artifacts.strategy?.rationale != null) resultObj.rationale = artifacts.strategy.rationale;
  if (artifacts.strategy?.knobs != null) resultObj.knobSettings = artifacts.strategy.knobs;

  const qa = artifacts.qa?.result as any | undefined;
  const hasQa = !!qa && typeof qa === 'object';
  const quality = hasQa
    ? {
        score: typeof qa.composite === 'number' ? qa.composite : undefined,
        issues: Array.isArray(qa.contentRecommendations)
          ? qa.contentRecommendations
          : Array.isArray(qa.suggestedChanges)
          ? qa.suggestedChanges
          : undefined,
        pass: typeof qa.compliance === 'boolean' ? qa.compliance : undefined,
        metrics: {
          readability: typeof qa.readability === 'number' ? qa.readability : undefined,
          clarity: typeof qa.clarity === 'number' ? qa.clarity : undefined,
          objectiveFit: typeof qa.objectiveFit === 'number' ? qa.objectiveFit : undefined,
          brandRisk: typeof qa.brandRisk === 'number' ? qa.brandRisk : undefined
        }
      }
    : { score: undefined, issues: undefined, pass: undefined, metrics: undefined };

  // Emit warnings and construct acceptance-report with explicit criteria
  const criteria: Array<{ criterion: string; passed: boolean; details?: string }> = [];
  if (!hasContent) {
    onEvent({ type: 'warning', message: 'No content generated; finalizing with explanation', data: { reason: 'missing_generation' }, correlationId: cid });
    criteria.push({ criterion: 'content_generated', passed: false, details: 'No generation specialist output available.' });
  } else {
    criteria.push({ criterion: 'content_generated', passed: true });
  }
  if (!hasQa) {
    onEvent({ type: 'warning', message: 'QA not performed; quality unknown', data: { reason: 'missing_qa' }, correlationId: cid });
    criteria.push({ criterion: 'qa_performed', passed: false, details: 'No QA specialist output available.' });
  } else {
    criteria.push({ criterion: 'qa_performed', passed: true });
  }
  const overall = criteria.every((c) => c.passed);
  const acceptanceReport = { overall, criteria };

  const finalBundle: any = { result: resultObj, quality, ['acceptance-report']: acceptanceReport };
  // Optional pass-through for UIs that expect the raw QA report under 'quality-report'
  if (hasQa) (finalBundle as any)['quality-report'] = qa;

  // Mark finalize step done, if present
  if (finalizeStepId) {
    try { setStepStatusById(finalizeStepId, 'done'); } catch {}
  }

  // Persist final runReport snapshot and emit summary metrics
  const runReport: RunReport = {
    steps: [...stepResults],
    summary: {
      steps: stepResults.length,
      failures: stepResults.filter((s) => !!s.error).length,
      durationMs: stepResults.reduce((acc, s) => acc + (Number((s.metrics as any)?.durationMs) || 0), 0)
    }
  };
  if (resumeKey) {
    try {
      const existing = RESUME_STORE.get(resumeKey) || ({} as any);
      RESUME_STORE.set(resumeKey, { ...existing, plan: JSON.parse(JSON.stringify(plan)), history: [...stepResults], runReport, updatedAt: Date.now() } as any);
    } catch {}
  }
  onEvent({ type: 'metrics', data: runReport.summary, correlationId: cid });
  // Emit full run report for UI/clients (message type with structured data)
  onEvent({ type: 'message', message: 'run_report', data: runReport as any, correlationId: cid });
  onEvent({ type: 'complete', data: finalBundle as any, correlationId: cid });
  return { final: finalBundle, metrics: runReport.summary };
}

export { RESUME_STORE };
// Local normalization to avoid cross-package type dependency issues at dev time.
// Accepts any object and returns a sanitized QA report-like object.
function normalizeQaReport(input: any): any {
  const out: any = typeof input === 'object' && input ? { ...input } : {};
  // Map aliases to canonical field
  if (!Array.isArray(out.contentRecommendations)) {
    if (Array.isArray(out.suggestedChanges)) out.contentRecommendations = out.suggestedChanges;
    else if (Array.isArray(out.Suggestions)) out.contentRecommendations = out.Suggestions;
  }
  // Clamp numeric metrics to 0..1 when present
  const clamp01 = (n: any) => {
    const v = Number(n);
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : undefined;
  };
  if ('readability' in out) out.readability = clamp01(out.readability);
  if ('clarity' in out) out.clarity = clamp01(out.clarity);
  if ('objectiveFit' in out) out.objectiveFit = clamp01(out.objectiveFit);
  if ('brandRisk' in out) out.brandRisk = clamp01(out.brandRisk);
  if ('composite' in out) out.composite = clamp01(out.composite);
  return out;
}
