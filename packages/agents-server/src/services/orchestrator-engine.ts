import { AgentRunRequest, AgentEvent, Plan, PlanPatchSchema, PlanStepStatus } from '@awesomeposter/shared';
import { AgentRuntime } from './agent-runtime';
import { Runner } from '@openai/agents';
import { createStrategyAgent } from '../agents/strategy-manager';
import { createContentAgent } from '../agents/content-generator';
import { createQaAgent } from '../agents/quality-assurance';

type SpecialistId = 'strategy' | 'generation' | 'qa';

const RESUME_STORE = new Map<string, { plan: Plan; history: any[]; updatedAt: number }>();

function mapToCapabilityIdOrAction(value: any): { capabilityId?: string; action?: 'finalize' } | undefined {
  const s = String(value || '').toLowerCase().trim();
  if (!s) return undefined;
  if (s === 'final' || s === 'finalize' || /finish|complete/.test(s)) return { action: 'finalize' };
  return { capabilityId: s };
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
  if (!input || typeof input !== 'object') return null;
  const out: any = {};
  const add = (input as any).stepsAdd ?? (input as any).add ?? (input as any).steps;
  if (Array.isArray(add)) {
    out.stepsAdd = [];
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
    for (const raw of add) {
      if (typeof raw === 'string') {
        const mapped = mapToCapabilityIdOrAction(raw);
        if (!mapped) continue;
        const base = mapped.capabilityId || mapped.action || 'step';
        out.stepsAdd.push({ id: uniqueId(String(base)), ...mapped, status: 'pending' as PlanStepStatus });
        continue;
      }
      if (raw && typeof raw === 'object') {
        const m =
          mapToCapabilityIdOrAction((raw as any).capabilityId ?? (raw as any).step ?? (raw as any).kind ?? (raw as any).type ?? (raw as any).name) ||
          (typeof (raw as any).capabilityId === 'string' ? { capabilityId: (raw as any).capabilityId } : undefined);
        if (!m) continue;
        const base = ((m as any).capabilityId ?? (m as any).action ?? 'step') as string;
        const id = typeof (raw as any).id === 'string' ? String((raw as any).id) : uniqueId(String(base));
        const note =
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
  const matches = text.match(/\{[\s\S]*\}/g);
  return matches ? matches : [];
}

export async function runOrchestratorEngine(
  runtime: AgentRuntime,
  req: AgentRunRequest,
  onEvent: (e: AgentEvent) => void,
  correlationId?: string
): Promise<{ final: any; metrics?: any }> {
  const cid = correlationId || `run_${Math.random().toString(36).slice(2)}`;
  onEvent({ type: 'start', correlationId: cid, message: 'Run started' });

  const registry: Record<SpecialistId, { name: string; instance?: any }> = {
    strategy: { name: 'Strategy Manager' },
    generation: { name: 'Content Generator' },
    qa: { name: 'Quality Assurance' },
  };

  const strategyAgent = createStrategyAgent(runtime, undefined);
  const contentAgent = createContentAgent(runtime, undefined);
  const qaAgent = createQaAgent(runtime, undefined);

  registry.strategy.instance = strategyAgent as any;
  registry.generation.instance = contentAgent as any;
  registry.qa.instance = qaAgent as any;

  const plan: Plan = { version: 0, steps: [] };

  const artifacts: {
    strategy?: { rationale?: string; writerBrief?: any; knobs?: any; rawText?: string };
    generation?: { draftText?: string; rawText?: string };
    qa?: { result?: any; rawText?: string };
  } = {};

  const resumeKey = req.mode === 'app' ? (req.briefId || undefined) : undefined;

  const emitPlanUpdate = (patch: any) => {
    plan.version += 1;
    onEvent({ type: 'plan_update' as any, data: { patch, planVersion: plan.version, plan }, correlationId: cid });
    if (resumeKey) {
      try {
        const snapshot = {
          plan: JSON.parse(JSON.stringify(plan)),
          history: [],
          updatedAt: Date.now(),
        };
        RESUME_STORE.set(resumeKey, snapshot as any);
      } catch {}
    }
  };

  const ensureFinalizeStep = () => {
    let step = plan.steps.find((s) => s.action === 'finalize');
    if (!step) {
      const newStep = { id: 'auto_finalize_1', action: 'finalize' as const, status: 'pending' as PlanStepStatus };
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
      return { writerBrief: artifacts.strategy?.writerBrief, knobs: artifacts.strategy?.knobs };
    }
    if (capabilityId === 'qa') {
      return { draftText: artifacts.generation?.draftText };
    }
    return {};
  };

  const executeSpecialistStep = async (capabilityId?: string, payload?: any) => {
    const sid = capabilityId as SpecialistId;
    const agentInstance = registry[sid]?.instance;
    if (!agentInstance) return;
    onEvent({ type: 'handoff', message: 'occurred', data: { from: 'orchestrator', to: registry[sid]!.name }, correlationId: cid });
    const runner = new Runner({ model: runtime.getModel() });
    const payloadText = (() => {
      try { return JSON.stringify(payload ?? {}, null, 2); } catch { return String(payload ?? ''); }
    })();
    const prompt = [`Objective:\n${req.objective}`, `Payload:\n${payloadText}`, `Follow your role instructions and use tools as needed.`].join('\n\n');
    const res: any = await runner.run(agentInstance as any, prompt, { stream: false });
    const text = typeof res?.finalOutput === 'string' ? res.finalOutput : '';
    if (sid === 'strategy') {
      artifacts.strategy = { rawText: text };
      try { const parsed = JSON.parse(text); artifacts.strategy = { rawText: text, rationale: parsed.rationale, writerBrief: parsed.writerBrief, knobs: parsed.knobs ?? parsed.writerBrief?.knobs }; } catch {}
    } else if (sid === 'generation') {
      artifacts.generation = { rawText: text, draftText: text };
    } else if (sid === 'qa') {
      artifacts.qa = { rawText: text };
      try { artifacts.qa = { rawText: text, result: JSON.parse(text) }; } catch {}
    }
  };

  const plannerSystem = [
    'You are the Orchestrator. Propose plan updates as JSON patches.',
    'Use capabilityId values "strategy", "generation", "qa".',
    'Always include a finalize step.'
  ].join('\n');

  const planWithLLM = async () => {
    const messages = [
      { role: 'system' as const, content: plannerSystem },
      { role: 'user' as const, content: req.objective }
    ];
    const res = await runtime.runChat(messages, undefined, { toolPolicy: 'off' });
    const text = res.content || '';
    let patch: any = null;
    for (const cand of extractJsonCandidates(text)) {
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
    }
    ensureFinalizeStep();
  };

  await planWithLLM();

  let state: 'plan' | 'step' | 'replan' | 'final' = 'plan';
  while (state !== 'final') {
    if (state === 'plan') {
      const next = plan.steps.find((s) => s.status === 'pending');
      if (!next) {
        await planWithLLM();
        continue;
      }
      state = 'step';
    } else if (state === 'step') {
      const next = plan.steps.find((s) => s.status === 'pending')!;
      if (next.action === 'finalize') {
        state = 'final';
        break;
      }
      setStepStatusById(next.id, 'in_progress');
      await executeSpecialistStep(next.capabilityId as string, buildPayloadForCapability(next.capabilityId));
      setStepStatusById(next.id, 'done');
      state = 'replan';
    } else if (state === 'replan') {
      await planWithLLM();
      state = 'plan';
    }
  }

  const appOut = {
    result: {
      platform: (artifacts.strategy?.writerBrief as any)?.platform || 'generic',
      content: artifacts.generation?.draftText || ''
    },
    rationale: artifacts.strategy?.rationale ?? null,
    knobSettings: artifacts.strategy?.knobs,
    ['quality-report']: artifacts.qa?.result
  };

  onEvent({ type: 'complete', data: appOut, correlationId: cid });
  return { final: appOut, metrics: undefined };
}

export { RESUME_STORE };
