import { AppResultSchema, type AgentRunRequest, type AgentEvent } from '@awesomeposter/shared'
import { z } from 'zod'
import { getLogger } from './logger'
import { AgentRuntime } from './agent-runtime'
import { getAgents } from './agents-container'
import { getDb, assets as assetsTable, eq } from '@awesomeposter/db'
import { analyzeAssetsLocal } from '../tools/strategy'
import { Agent as AgentClass, Runner, handoff } from '@openai/agents'
/* Using local fallback for filterHistory since '@openai/agents/extensions' is unavailable in this environment */
import { createStrategyAgent } from '../agents/strategy-manager'
import { createContentAgent } from '../agents/content-generator'
import { createQaAgent } from '../agents/quality-assurance'
import { ORCH_SYS_START, ORCH_SYS_END, stripSentinelSections, dropOrchestrationArtifacts } from '../utils/prompt-filters.js'

/* Local fallback equivalent of Agents SDK filterHistory */
const filterHistory = (opts: { maxMessages?: number; filterSystemMessages?: boolean }) => {
  const { maxMessages = 6, filterSystemMessages = true } = opts || {}
  return (history: any[]) => {
    const arr = Array.isArray(history) ? history : []
    const filtered = filterSystemMessages
      ? arr.filter((m) => String((m as any)?.role || '').toLowerCase() !== 'system')
      : arr
    return maxMessages && maxMessages > 0 ? filtered.slice(-maxMessages) : filtered
  }
}

/**
 * Synchronous composeInputFilter used for handoff input filtering.
 * Mirrors composeInputFilter but without async to satisfy HandoffInputFilter type.
 */
function composeInputFilterSync(baseFilter?: (history: any[]) => any[]) {
  return (history: any[]) => {
    const base = baseFilter ? baseFilter(history) : history
    const mapped = base.map((msg: any) => {
      const c = (msg as any).content
      if (typeof c === 'string') {
        const text = stripSentinelSections(c)
        return { ...msg, content: text }
      }
      if (Array.isArray(c)) {
        const newParts = c
          .map((p: any) => {
            const nextText = typeof p?.text === 'string' ? stripSentinelSections(p.text) : p?.text
            return { ...p, text: nextText }
          })
          // prune empty textual parts
          .filter((p: any) => (typeof p?.text === 'string' ? p.text.trim().length > 0 : true))
        return { ...msg, content: newParts }
      }
      return msg
    })

    const filtered = mapped.filter((m: any) => dropOrchestrationArtifacts(m))

    // Remove messages whose content ended up empty arrays after pruning
    const finalHistory = filtered.filter((m: any) => {
      const c = (m as any).content
      if (typeof c === 'string') return c.trim().length > 0
      if (Array.isArray(c)) return c.length > 0
      return true
    })

    return finalHistory
  }
}

/**
 * Adapter: wrap a history-only filter to a HandoffInputFilter signature.
 * Preserves preHandoffItems and newItems unchanged.
 */
function toHandoffInputFilter(historyFilter: (h: any[]) => any[]) {
  // Backward/interop support: allow being called either with an array (history-only)
  // or with a handoff data object that has { inputHistory }.
  return (data: any) => {
    // If invoked with an array, behave like a plain history filter
    if (Array.isArray(data)) {
      return historyFilter(data)
    }
    const arr = Array.isArray(data?.inputHistory)
      ? data.inputHistory
      : (data?.inputHistory ? [data.inputHistory] : [])
    const filtered = historyFilter(arr)
    return { ...data, inputHistory: filtered }
  }
}

// Local plan types for in-run planning (capability-driven; avoid hardcoded step names)
type PlanStepStatus = 'pending' | 'in_progress' | 'done' | 'skipped'
type PlanStep = {
  id: string
  capabilityId?: string
  action?: 'finalize'
  label?: string
  status: PlanStepStatus
  note?: string
}
type Plan = { version: number; steps: PlanStep[] }

type SpecialistId = 'strategy' | 'generation' | 'qa'
const RESUME_STORE = new Map<string, { plan: Plan; history: any[]; updatedAt: number }>()

// Local PlanPatch schema (capability-driven; no hardcoded step kinds)
const PlanActionEnum = z.enum(['finalize'])
const PlanStepStatusEnum = z.enum(['pending', 'in_progress', 'done', 'skipped'])
const PlanStepSchemaLocal = z.object({
  id: z.string(),
  capabilityId: z.string().min(1).optional(),
  action: PlanActionEnum.optional(),
  label: z.string().optional(),
  status: PlanStepStatusEnum,
  note: z.string().optional()
})
const PlanStepUpdateSchemaLocal = z.object({
  id: z.string(),
  status: PlanStepStatusEnum.optional(),
  note: z.string().optional()
})
const PlanPatchSchema = z.object({
  stepsAdd: z.array(PlanStepSchemaLocal).optional(),
  stepsUpdate: z.array(PlanStepUpdateSchemaLocal).optional(),
  stepsRemove: z.array(z.string()).optional(),
  note: z.string().optional()
})

// Helper mappers: normalize LLM-authored plan patches into capability-driven internal schema
function mapToCapabilityIdOrAction(value: any): { capabilityId?: string; action?: 'finalize' } | undefined {
  const s = String(value || '').toLowerCase().trim()
  if (!s) return undefined
  if (s === 'final' || s === 'finalize' || /finish|complete/.test(s)) return { action: 'finalize' }
  // Fallback: treat as a capability label/id if provided
  return { capabilityId: s }
}

function normalizePlanPatchInput(
  input: any,
  targetPlan: Plan
): {
  stepsAdd?: Array<{ id: string; capabilityId?: string; action?: 'finalize'; label?: string; status: PlanStepStatus; note?: string }>
  stepsUpdate?: Array<{ id: string; status?: PlanStepStatus; note?: string }>
  stepsRemove?: string[]
  note?: string
} | null {
  if (!input || typeof input !== 'object') return null
  const out: any = {}

  // Normalize stepsAdd (accepts stepsAdd | add | steps)
  const add = (input as any).stepsAdd ?? (input as any).add ?? (input as any).steps
  if (Array.isArray(add)) {
    out.stepsAdd = []
    const existingIds = new Set(targetPlan.steps.map(s => s.id))
    const uniqueId = (base: string) => {
      let idx = targetPlan.steps.filter(s => (s.capabilityId || s.action || '').toString() === base).length + 1
      let id = `auto_${base.replace(/[^a-z0-9_.-]/gi, '_')}_${idx}`
      while (existingIds.has(id)) {
        idx += 1
        id = `auto_${base.replace(/[^a-z0-9_.-]/gi, '_')}_${idx}`
      }
      existingIds.add(id)
      return id
    }

    for (const raw of add) {
      if (typeof raw === 'string') {
        const mapped = mapToCapabilityIdOrAction(raw)
        if (!mapped) continue
        const base = mapped.capabilityId || mapped.action || 'step'
        out.stepsAdd.push({ id: uniqueId(String(base)), ...mapped, status: 'pending' as PlanStepStatus })
        continue
      }
      if (raw && typeof raw === 'object') {
        const m =
          mapToCapabilityIdOrAction((raw as any).capabilityId ?? (raw as any).step ?? (raw as any).kind ?? (raw as any).type ?? (raw as any).name) ||
          (typeof (raw as any).capabilityId === 'string' ? { capabilityId: (raw as any).capabilityId } : undefined)
        if (!m) continue
        const base = ((m as any).capabilityId ?? (m as any).action ?? 'step') as string
        const id = typeof (raw as any).id === 'string' ? String((raw as any).id) : uniqueId(String(base))
        const note =
          typeof (raw as any).note === 'string'
            ? (raw as any).note
            : typeof (raw as any).description === 'string'
              ? (raw as any).description
              : undefined
        let status: PlanStepStatus = 'pending'
        const s = String((raw as any).status || '').toLowerCase()
        if (s === 'in_progress' || s === 'inprogress' || s === 'active') status = 'in_progress'
        else if (s === 'done' || s === 'complete' || s === 'completed') status = 'done'
        else if (s === 'skipped') status = 'skipped'
        const label = typeof (raw as any).label === 'string' ? (raw as any).label : undefined
        out.stepsAdd.push({ id, ...m, label, status, note })
      }
    }
    if (out.stepsAdd.length === 0) delete out.stepsAdd
  }

  // Normalize stepsUpdate; allow { step: "...", status: "done" } by resolving an id for the first matching capabilityId/action
  if (Array.isArray((input as any).stepsUpdate)) {
    out.stepsUpdate = []
    for (const u of (input as any).stepsUpdate) {
      if (!u || typeof u !== 'object') continue
      let id = (u as any).id
      if (!id && (u as any).step) {
        const m = mapToCapabilityIdOrAction((u as any).step)
        const match = m?.capabilityId
          ? targetPlan.steps.find(s => s.capabilityId === m!.capabilityId)
          : (m?.action ? targetPlan.steps.find(s => s.action === m!.action) : undefined)
        id = match?.id
      }
      if (typeof id !== 'string') continue
      const note = typeof (u as any).note === 'string' ? (u as any).note : undefined
      let status: PlanStepStatus | undefined = undefined
      if ((u as any).status) {
        const s = String((u as any).status || '').toLowerCase()
        if (s === 'in_progress' || s === 'inprogress' || s === 'active') status = 'in_progress'
        else if (s === 'done' || s === 'complete' || s === 'completed') status = 'done'
        else if (s === 'skipped') status = 'skipped'
        else if (s === 'pending') status = 'pending'
      }
      out.stepsUpdate.push({ id, status, note })
    }
    if (out.stepsUpdate.length === 0) delete out.stepsUpdate
  }

  // stepsRemove passthrough
  if (Array.isArray((input as any).stepsRemove)) {
    out.stepsRemove = (input as any).stepsRemove.map((x: any) => String(x)).filter(Boolean)
    if (out.stepsRemove.length === 0) delete out.stepsRemove
  }

  // note
  if (typeof (input as any).note === 'string') out.note = (input as any).note

  // If we recognized nothing, return null
  if (!out.stepsAdd && !out.stepsUpdate && !out.stepsRemove && !out.note) return null
  return out
}

export class OrchestratorAgent {
  constructor(private runtime: AgentRuntime) {}

  async run(
    req: AgentRunRequest,
    onEvent: (e: AgentEvent) => void,
    correlationId?: string
  ): Promise<{ final: any; metrics?: any }> {
    const cid = correlationId || `run_${Math.random().toString(36).slice(2)}`
    const log = getLogger()
    const start = Date.now()
    // Aggregate minimal metrics for P0
    const metricsAgg = { tokensTotal: 0 }
    onEvent({ type: 'start', correlationId: cid, message: 'Run started' })
    log.info('orchestrator_run_start', { cid, mode: req.mode, hasState: Boolean(req.state), briefId: req.briefId })

    // Use briefId as the lightweight resume key for app runs
    const resumeKey = req.mode === 'app' ? (req.briefId || undefined) : undefined

    // Minimal in-run Registry and Plan (domain-agnostic)
    const registry: Record<SpecialistId, { name: string; instance?: any }> = {
      strategy: { name: 'Strategy Manager' },
      generation: { name: 'Content Generator' },
      qa: { name: 'Quality Assurance' },
    }

    const plan: Plan = {
      version: 0,
      steps: []
    }

    // Lightweight cross-step artifact stash to propagate outputs between specialists
    const artifacts: {
      strategy?: { rationale?: string; writerBrief?: any; knobs?: any; rawText?: string }
      generation?: { draftText?: string; rawText?: string }
      qa?: { result?: any; rawText?: string }
    } = {}

    const emitPlanUpdate = (patch: any) => {
      plan.version += 1
      onEvent({ type: 'plan_update' as any, data: { patch, planVersion: plan.version, plan }, correlationId: cid })
      // Persist snapshot for resume
      if (resumeKey) {
        try {
          const snapshot = {
            plan: JSON.parse(JSON.stringify(plan)),
            history: Array.isArray(messages) ? JSON.parse(JSON.stringify(messages)) : [],
            updatedAt: Date.now()
          }
          RESUME_STORE.set(resumeKey, snapshot as any)
        } catch {}
      }
    }

    // Capability-driven planning helpers (no hardcoded step names)
    const setStepStatusById = (id: string, status: PlanStepStatus, note?: string) => {
      const step = plan.steps.find((s) => s.id === id)
      if (!step) return
      if (step.status === status && !note) return
      step.status = status
      if (note) step.note = note
      emitPlanUpdate({ stepsUpdate: [{ id, status, note }] })
    }

    const setStepStatusByCapability = (capabilityId: string, status: PlanStepStatus, note?: string) => {
      const step = plan.steps.find((s) => s.capabilityId === capabilityId)
      if (!step) return
      setStepStatusById(step.id, status, note)
    }

    const ensureStepForCapability = (capabilityId: string, label?: string) => {
      let step = plan.steps.find((s) => s.capabilityId === capabilityId && (s.status === 'pending' || s.status === 'in_progress'))
      if (!step) {
        const safe = capabilityId.replace(/[^a-z0-9_.-]/gi, '_')
        const count = plan.steps.filter((s) => s.capabilityId === capabilityId).length + 1
        const newStep = { id: `auto_${safe}_${count}`, capabilityId, label, status: 'pending' as PlanStepStatus }
        plan.steps.push(newStep as any)
        emitPlanUpdate({ stepsAdd: [newStep] })
        step = newStep as any
      }
      return step
    }

    const ensureFinalizeStep = () => {
      let step = plan.steps.find((s) => s.action === 'finalize')
      if (!step) {
        const newStep = { id: 'auto_finalize_1', action: 'finalize' as const, status: 'pending' as PlanStepStatus }
        plan.steps.push(newStep as any)
        emitPlanUpdate({ stepsAdd: [newStep] })
        step = newStep as any
      }
      return step
    }

    // Apply a PlanPatch to the in-memory plan and bump version via emitPlanUpdate()
    const applyPlanPatch = (targetPlan: Plan, patch: any) => {
      if (!patch || typeof patch !== 'object') return
      // stepsAdd
      if (Array.isArray(patch.stepsAdd)) {
        const existingIds = new Set(targetPlan.steps.map(s => s.id))
        for (const s of patch.stepsAdd) {
          if (!s || typeof s !== 'object' || typeof s.id !== 'string') continue
          if (existingIds.has(s.id)) continue
          const newStep: any = { id: String(s.id), status: (s as any).status }
          if (typeof (s as any).capabilityId === 'string') newStep.capabilityId = String((s as any).capabilityId)
          if (typeof (s as any).action === 'string') newStep.action = String((s as any).action)
          if (typeof (s as any).label === 'string') newStep.label = String((s as any).label)
          if (typeof (s as any).note === 'string') newStep.note = String((s as any).note)
          targetPlan.steps.push(newStep)
          existingIds.add(s.id)
        }
      }
      // stepsUpdate
      if (Array.isArray(patch.stepsUpdate)) {
        for (const u of patch.stepsUpdate) {
          if (!u || typeof u !== 'object' || typeof u.id !== 'string') continue
          const step = targetPlan.steps.find(s => s.id === u.id)
          if (!step) continue
          if (u.status) step.status = u.status as any
          if (typeof u.note === 'string') step.note = u.note
        }
      }
      // stepsRemove
      if (Array.isArray(patch.stepsRemove) && patch.stepsRemove.length > 0) {
        const removeSet = new Set(patch.stepsRemove.map((id: any) => String(id)))
        const next = targetPlan.steps.filter(s => !removeSet.has(String(s.id)))
        targetPlan.steps.splice(0, targetPlan.steps.length, ...next)
      }
    }

    // Extract JSON candidates from model text (handles code fences)
    const extractJsonCandidates = (text: string): string[] => {
      const out: string[] = []
      const t = String(text || '')
      // 1) Whole string
      out.push(t.trim())
      // 2) Code fences
      const fenceRe = /```[\w-]*\n([\s\S]*?)```/g
      let m: RegExpExecArray | null
      while ((m = fenceRe.exec(t))) {
        const inner = (m[1] || '').trim()
        if (inner) out.push(inner)
      }
      return out
    }


    // Emit initial plan snapshot or resume prior plan if available
    if (resumeKey && RESUME_STORE.has(resumeKey)) {
      const saved = RESUME_STORE.get(resumeKey)!
      if (saved?.plan) {
        // Adopt saved plan
        plan.version = saved.plan.version
        plan.steps = saved.plan.steps.map((s: any) => ({ ...s }))
        emitPlanUpdate({ op: 'resume', steps: plan.steps.map(({ id, capabilityId, action, label, status }) => ({ id, capabilityId, action, label, status })) })
      } else {
        emitPlanUpdate({ op: 'init', steps: plan.steps.map(({ id, capabilityId, action, label, status }) => ({ id, capabilityId, action, label, status })) })
      }
    } else {
      emitPlanUpdate({ op: 'init', steps: plan.steps.map(({ id, capabilityId, action, label, status }) => ({ id, capabilityId, action, label, status })) })
    }

    const system = this.buildSystemPrompt(req)
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: system },
      { role: 'user', content: req.objective }
    ]

    try {
      if (req.mode === 'chat') {
        const target = (req.options as any)?.targetAgentId || 'orchestrator'
        try { log.info('orch_chat_target', { cid, target }) } catch {}
        onEvent({ type: 'phase', phase: 'analysis', message: `Entering chat mode (${target})`, correlationId: cid })
        let full = ''
        if (target === 'orchestrator') {
          await this.runtime.runChatStream(
            messages,
            (delta) => {
              full += delta
              onEvent({ type: 'delta', message: delta, correlationId: cid })
            },
            {
              toolsAllowlist: [],
              toolPolicy: 'off',
              temperature: req.options?.temperature,
              schemaName: req.options?.schemaName,
              trace: req.options?.trace
            }
          )
        } else {
          const onToolEvent = (e: any) => {
            if (e.type === 'tool_call') onEvent({ type: 'tool_call', message: e.name, data: { args: e.args }, correlationId: cid })
            if (e.type === 'tool_result') onEvent({ type: 'tool_result', message: e.name, data: { result: e.result }, correlationId: cid })
            if (e.type === 'metrics') onEvent({ type: 'metrics', tokens: e.tokens, durationMs: e.durationMs, correlationId: cid })
          }
          const opts = { policy: req.options?.toolPolicy, requestAllowlist: req.options?.toolsAllowlist }
          let agentInstance: any
          if (target === 'strategy') agentInstance = createStrategyAgent(this.runtime, onToolEvent, opts, 'chat')
          else if (target === 'generator') agentInstance = createContentAgent(this.runtime, onToolEvent, opts, 'chat')
          else if (target === 'qa') agentInstance = createQaAgent(this.runtime, onToolEvent, opts)
          else agentInstance = undefined

          const userText = messages
            .filter((m) => m.role !== 'system')
            .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
            .join('\n\n')
          const prompt = userText || 'Proceed.'

          const runner = new Runner({ model: this.runtime.getModel() })
          const stream: any = await runner.run(agentInstance as any, prompt, { stream: true })
          const textStream: any = stream.toTextStream({ compatibleWithNodeStreams: false })
          for await (const chunk of textStream) {
            const d = (chunk as any)?.toString?.() ?? String(chunk)
            if (d) {
              full += d
              onEvent({ type: 'delta', message: d, correlationId: cid })
            }
          }
          await (stream as any).completed
          const result: any = await (stream as any).finalResult
          if (typeof result?.finalOutput === 'string') full += result.finalOutput
        }
        // Normalize chat output: if the agent returned a JSON object (e.g., { "content": "..." })
        // or wrapped the answer in code fences, extract the plain text content for chat.
        const normalizeChatOutput = (input: string) => {
          let text = (input || '').trim()
          // Strip code fences if present
          if (text.startsWith('```')) {
            const last = text.lastIndexOf('```')
            if (last > 3) {
              const firstNl = text.indexOf('\n')
              const inner = firstNl !== -1 ? text.slice(firstNl + 1, last) : text
              text = inner.trim()
            }
          }
          // Try parsing JSON to extract a content field
          try {
            const j = JSON.parse(text)
            if (j && typeof j === 'object' && typeof (j as any).content === 'string') {
              return String((j as any).content)
            }
          } catch {}
          return text
        }
        const finalText = normalizeChatOutput(full)
        const durationMs = Date.now() - start
        onEvent({ type: 'message', message: finalText, correlationId: cid })
        // Final metrics frame for chat mode (tokens may be unavailable)
        onEvent({ type: 'metrics', durationMs, correlationId: cid })
        onEvent({ type: 'complete', data: { message: finalText }, durationMs, correlationId: cid })
        log.info('orchestrator_run_complete', { cid, mode: 'chat', durationMs, size: finalText.length, target })
        return { final: { message: finalText }, metrics: { durationMs } }
      }

      // Applicative mode (structured via handoffs among specialist agents) with streaming
      const appTarget = (req.options as any)?.targetAgentId || 'orchestrator'
      try { log.info('orch_app_target', { cid, target: appTarget }) } catch {}
      onEvent({ type: 'phase', phase: 'planning', message: 'Structured run started', correlationId: cid })

      // Build specialist agents (knowledge lives inside their modules)
      const strategyAgent = createStrategyAgent(this.runtime, (e) => {
        if (e.type === 'metrics' && typeof e.tokens === 'number') metricsAgg.tokensTotal += e.tokens
        if (e.type === 'tool_call') onEvent({ type: 'tool_call', message: e.name, data: { args: e.args }, correlationId: cid })
        if (e.type === 'tool_result') onEvent({ type: 'tool_result', message: e.name, data: { result: e.result }, correlationId: cid })
        if (e.type === 'metrics') onEvent({ type: 'metrics', tokens: e.tokens, durationMs: e.durationMs, correlationId: cid })
      }, { policy: req.options?.toolPolicy, requestAllowlist: req.options?.toolsAllowlist })
      const contentAgent = createContentAgent(this.runtime, (e) => {
        if (e.type === 'metrics' && typeof e.tokens === 'number') metricsAgg.tokensTotal += e.tokens
        if (e.type === 'tool_call') onEvent({ type: 'tool_call', message: e.name, data: { args: e.args }, correlationId: cid })
        if (e.type === 'tool_result') onEvent({ type: 'tool_result', message: e.name, data: { result: e.result }, correlationId: cid })
        if (e.type === 'metrics') onEvent({ type: 'metrics', tokens: e.tokens, durationMs: e.durationMs, correlationId: cid })
      }, { policy: req.options?.toolPolicy, requestAllowlist: req.options?.toolsAllowlist })
      const qaAgent = createQaAgent(this.runtime, (e) => {
        if (e.type === 'metrics' && typeof e.tokens === 'number') metricsAgg.tokensTotal += e.tokens
        if (e.type === 'tool_call') onEvent({ type: 'tool_call', message: e.name, data: { args: e.args }, correlationId: cid })
        if (e.type === 'tool_result') onEvent({ type: 'tool_result', message: e.name, data: { result: e.result }, correlationId: cid })
        if (e.type === 'metrics') onEvent({ type: 'metrics', tokens: e.tokens, durationMs: e.durationMs, correlationId: cid })
      }, { policy: req.options?.toolPolicy, requestAllowlist: req.options?.toolsAllowlist })

      // Record instances in the in-run registry
      registry.strategy.instance = strategyAgent as any
      registry.generation.instance = contentAgent as any
      registry.qa.instance = qaAgent as any

      // Provide named factory functions for handoffs to satisfy SDK default tool-name derivation

      const TRIAGE_INSTRUCTIONS = (() => {
        // Build a dynamic Capabilities Registry section from the in-run registry
        // Avoid hardcoding; derive capabilityIds from available specialists.
        const orderPref: SpecialistId[] = ['strategy', 'generation', 'qa']
        const ids = (Object.keys(registry) as SpecialistId[])
          .filter((k) => registry[k])
          .sort((a, b) => orderPref.indexOf(a) - orderPref.indexOf(b))

        // Canonical capabilityIds are the specialist keys themselves (e.g., "strategy", "generation", "qa").
        const capabilitiesLines: string[] = ['Capabilities Registry (use these capabilityId values in your plan steps; do NOT use tool names):']
        for (const id of ids) {
          const agentName = registry[id]?.name || id
          const hint = id === 'strategy'
            ? 'Plan strategy and knob configuration; pick feasible format.'
            : id === 'generation'
              ? 'Create content drafts from the writer brief and knobs.'
              : id === 'qa'
                ? 'Evaluate drafts for clarity, fit, risk, and compliance.'
                : 'Specialist capability.'
          capabilitiesLines.push(`- capabilityId: "${id}" — handled by ${agentName}. ${hint}`)
        }

        // Example initial plan (dynamic from ids) to anchor the model output
        const exampleSteps: Array<{ capabilityId: string } | { action: 'finalize' }> = ids.map((id) => ({ capabilityId: id }))
        exampleSteps.push({ action: 'finalize' })
        const examplePlan = {
          action: 'plan_update',
          planPatch: { stepsAdd: exampleSteps }
        }

        const lines = [
          'You are the Orchestrator. Coordinate specialist agents (Strategy, Generation, and Quality Assurance) to achieve the user objective.',
          'Responsibilities: route work via handoffs only; the Orchestrator must not call tools and must not author domain artifacts.',
          'Planning: Propose and evolve a minimal execution plan using Registry capabilities and constraints.',
          'Emit plan updates by outputting a single JSON object when the plan changes: { "action": "plan_update", "planPatch": { "stepsAdd"?: [...], "stepsUpdate"?: [...], "stepsRemove"?: [...], "note"?: <string> } }.',
          'At the start, propose an initial plan via a plan_update with stepsAdd using capabilityId fields from the Registry (e.g., { "capabilityId": "<capability>", "label": "<freeform>" } or { "action": "finalize" }). As you progress, emit plan_update patches with stepsUpdate/status changes or notes.',
          'To delegate work, use handoffs only; never use tool names as capabilityId values. The transfer_to_* names are tools, not capabilityIds.',
          '',
          ...capabilitiesLines,
          '',
          'Example initial plan (patch JSON):',
          JSON.stringify(examplePlan, null, 2),
          '',
          'Quality: evaluate against configured criteria. Iterate via handoffs until acceptable or max cycles reached.',
          'Revision policy: After a QA step, inspect the QA specialist\'s final JSON reply (not just tool outputs). If it contains a non-empty array field named "contentRecommendations" OR a suggestions array under "suggestedChanges" or "Suggestions" (case-insensitive), you MUST extend the plan with a targeted revision loop:',
          ' - Add a "generation" step (label suggestion: "Revise content with QA recommendations").',
          ' - Immediately follow it with a "qa" step to re-evaluate the revised draft.',
          'The revision generation step should rely on the orchestrator-provided payload which includes the original writer brief and the QA contentRecommendations. Do not duplicate the entire plan; emit only a minimal plan_update patch to add these steps.',
          'Constraints: never invent context; specialists may use project-defined tools when handed control. Honor any tool allowlist and policy.',
          'Finalization: When you finalize, output one JSON object that aggregates artifacts produced by specialists in the AppResult shape:',
          '  {',
          '    "result": { "content": "<final post text>", "platform": "<e.g., linkedin|x>" },',
          '    "rationale": "<strategy manager rationale>",',
          '    "knobSettings"?: { "formatType"?: "<string>", "hookIntensity"?: "<number|low|med|high>", "expertiseDepth"?: "<number|low|med|high>", "structure"?: "<string|object>" },',
          '    "quality-report"?: <qa agent JSON>',
          '  }',
          'Rules for result aggregation:',
          ' - Use the Strategy specialist output for "rationale" and "knobSettings" (do NOT invent).',
          ' - "result.content" must be the latest Content specialist post text (plain text, no JSON/fences).',
          ' - "result.platform" should reflect the Strategy brief/platform (or the platform optimized for).',
          ' - "quality-report" must reflect the QA specialist evaluation of the latest draft.',
          'Important: Never output a plan_update or handoff object as the final result. The final response must be exactly one JSON object with { "result", "rationale"[, "knobSettings"[, "quality-report"]] }.',
          'Output: return a single JSON object only. Do not wrap in code fences.' + (req.options?.schemaName ? ` Conform to schema: ${req.options.schemaName}.` : ''),
        ]
        return lines.join('\n')
      })()


      const triageAgent = AgentClass.create({
        name: 'Triage Agent',
        instructions: TRIAGE_INSTRUCTIONS,
        // Define handoffs explicitly; use inputFilter adapter and stable tool names
        handoffs: [
          handoff(strategyAgent as any, {
            inputFilter: toHandoffInputFilter(
              composeInputFilterSync(filterHistory({ maxMessages: 6, filterSystemMessages: true }))
            ),
            toolNameOverride: 'transfer_to_strategy_manager',
          }),
          handoff(contentAgent as any, {
            inputFilter: toHandoffInputFilter(
              composeInputFilterSync(filterHistory({ maxMessages: 6, filterSystemMessages: true }))
            ),
            toolNameOverride: 'transfer_to_content_generator',
          }),
          handoff(qaAgent as any, {
            inputFilter: toHandoffInputFilter(
              composeInputFilterSync(filterHistory({ maxMessages: 6, filterSystemMessages: true }))
            ),
            toolNameOverride: 'transfer_to_quality_assurance',
          }),
        ],
      })

      // Map capabilityId strings to internal specialist ids
      const resolveSpecialistByCapability = (capabilityId?: string): SpecialistId | undefined => {
        const s = String(capabilityId || '').toLowerCase()
        if (!s) return undefined
        if (/strategy|plan|analysis/.test(s)) return 'strategy'
        if (/content|create|write|generation|draft/.test(s)) return 'generation'
        if (/qa|quality|review|assess|evaluate/.test(s)) return 'qa'
        return undefined
      }

      // Build a default payload for a target capability using stored artifacts
      const buildPayloadForCapability = (capabilityId?: string): any => {
        const sid = resolveSpecialistByCapability(capabilityId)
        if (!sid) return {}
        if (sid === 'generation') {
          // Prefer structured fields if available
          const br = artifacts.strategy?.writerBrief
          const knobs = artifacts.strategy?.knobs
          const rationale = artifacts.strategy?.rationale
          const qaRecs = (() => {
            try {
              const r = artifacts.qa?.result as any
              const pickStrings = (arr: any[]): string[] => {
                const out: string[] = []
                for (const it of arr) {
                  if (typeof it === 'string') out.push(it)
                  else if (it && typeof it === 'object') {
                    const s = typeof (it as any).suggestion === 'string' && (it as any).suggestion.trim().length > 0
                      ? (it as any).suggestion
                      : (typeof (it as any).text === 'string' ? (it as any).text : undefined)
                    if (typeof s === 'string' && s.trim().length > 0) out.push(s.trim())
                  }
                }
                return out
              }
              // Accept contentRecommendations
              if (Array.isArray(r?.contentRecommendations) && r.contentRecommendations.length > 0) {
                return pickStrings(r.contentRecommendations)
              }
              // Accept suggestedChanges
              if (Array.isArray(r?.suggestedChanges) && r.suggestedChanges.length > 0) {
                const arr = pickStrings(r.suggestedChanges)
                if (arr.length > 0) return arr
              }
              // Accept Suggestions (capitalized)
              if (Array.isArray((r as any)?.Suggestions) && (r as any).Suggestions.length > 0) {
                const arr = pickStrings((r as any).Suggestions)
                if (arr.length > 0) return arr
              }
              return undefined
            } catch { return undefined }
          })()
          const prevDraft = artifacts.generation?.draftText || artifacts.generation?.rawText
          const payload: any = {}
          if (br) payload.writerBrief = br
          if (knobs) payload.knobs = knobs
          if (rationale) payload.rationale = rationale
          if (qaRecs) payload.contentRecommendations = qaRecs
          if (prevDraft) payload.previousDraft = prevDraft
          return payload
        }
        if (sid === 'qa') {
          const draftText = artifacts.generation?.draftText || artifacts.generation?.rawText
          const br = artifacts.strategy?.writerBrief
          const payload: any = {}
          if (draftText) payload.draft = draftText
          if (br) payload.brief = br
          return payload
        }
        return {}
      }

      // Execute a single specialist step based on capabilityId + payload
      const executeSpecialistStep = async (capabilityId?: string, payload?: any) => {
        const sid = resolveSpecialistByCapability(capabilityId)
        if (!sid) {
          onEvent({ type: 'warning', message: `Unknown capability; cannot execute step`, data: { capabilityId }, correlationId: cid })
          return
        }
        const agentName = sid === 'strategy' ? registry.strategy.name : sid === 'generation' ? registry.generation.name : registry.qa.name
        const agentInstance =
          sid === 'strategy' ? registry.strategy.instance :
          sid === 'generation' ? registry.generation.instance :
          registry.qa.instance

        if (!agentInstance) {
          onEvent({ type: 'warning', message: `Specialist agent not available`, data: { capabilityId: sid }, correlationId: cid })
          return
        }

        // Emit handoff events
        onEvent({ type: 'handoff', message: 'requested', data: { from: 'Triage Agent', to: agentName }, correlationId: cid })
        const phase = sid === 'strategy' ? 'analysis' : sid === 'generation' ? 'generation' : 'qa'
        onEvent({ type: 'handoff', message: 'occurred', data: { from: 'Triage Agent', to: agentName }, correlationId: cid })
        onEvent({ type: 'phase', phase, message: `Handed off to ${agentName}`, correlationId: cid })
        if (sid === 'generation') sawContentInvolvement = true
        if (sid === 'qa') sawQaInvolvement = true

        // Run the specialist with a simple payload prompt
        const runner2 = new Runner({ model: this.runtime.getModel() })
        // Fallback to auto-built payload if none was provided
        const effectivePayload = (payload === undefined || payload === null || (typeof payload === 'object' && Object.keys(payload).length === 0))
          ? buildPayloadForCapability(capabilityId)
          : payload
        const payloadText = (() => { try { return JSON.stringify(effectivePayload ?? {}, null, 2) } catch { return String(effectivePayload ?? '') } })()
        const prompt2 = [
          `Objective:\n${req.objective}`,
          `Payload:\n${payloadText}`,
          `Follow your role instructions and use tools as needed.`
        ].join('\n\n')

        const stream2: any = await runner2.run(agentInstance as any, prompt2, { stream: true })
        const textStream2: any = stream2.toTextStream({ compatibleWithNodeStreams: false })
        let outputBuffer = ''
        for await (const chunk2 of textStream2) {
          const d2 = (chunk2 as any)?.toString?.() ?? String(chunk2)
          if (d2) outputBuffer += d2
          if (d2 && (phase === 'generation' || phase === 'qa')) {
            onEvent({ type: 'delta', message: d2, correlationId: cid })
          }
        }
        await (stream2 as any).completed
        // Try to capture final output from the specialist for artifact propagation
        let finalText2: string | undefined
        try {
          const res2: any = await (stream2 as any).finalResult
          const rawOut = (res2 && typeof res2.finalOutput === 'string') ? res2.finalOutput : undefined
          finalText2 = (rawOut && rawOut.trim().length > 0) ? rawOut : undefined
        } catch {}
        if (!finalText2) {
          const t = (outputBuffer || '').trim()
          if (t) finalText2 = t
        }

        // Store artifacts for downstream steps
        if (finalText2) {
          if (sid === 'strategy') {
            // Strategy returns JSON; parse best‑effort
            let parsed: any | undefined
            try {
              for (const cand of extractJsonCandidates(finalText2)) {
                try { parsed = JSON.parse(cand); break } catch {}
              }
            } catch {}
            artifacts.strategy = {
              rawText: finalText2,
              rationale: typeof parsed?.rationale === 'string' ? parsed.rationale : undefined,
              writerBrief: parsed?.writerBrief,
              knobs: parsed?.knobs || parsed?.writerBrief?.knobs
            }
          } else if (sid === 'generation') {
            // Content returns plain text draft
            artifacts.generation = { rawText: finalText2, draftText: finalText2 }
          } else if (sid === 'qa') {
            // QA returns JSON
            let parsedQa: any | undefined
            try {
              for (const cand of extractJsonCandidates(finalText2)) {
                try { parsedQa = JSON.parse(cand); break } catch {}
              }
            } catch {}
            artifacts.qa = { rawText: finalText2, result: parsedQa ?? finalText2 }
          }
        }
        // Mark step done
        if (typeof capabilityId === 'string' && capabilityId.length > 0) {
          setStepStatusByCapability(capabilityId, 'done')
          // Chain: execute next pending capability step if present
          try {
            const next = plan.steps.find(s => s && s.status === 'pending' && typeof (s as any).capabilityId === 'string')
            if (next && (next as any).capabilityId) {
              setStepStatusById((next as any).id, 'in_progress')
              // Build payload automatically for the next capability if none was specified by the model
              await executeSpecialistStep((next as any).capabilityId as string, buildPayloadForCapability((next as any).capabilityId as string))
            }
          } catch (ex) {
            onEvent({ type: 'error', message: 'plan-driven step chaining failed', data: { error: String(ex) }, correlationId: cid })
          }
        }
      }

     // (removed duplicate helper definitions)

     // Build the prompt/user input
      const userText = messages
        .filter((m) => m.role !== 'system')
        .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join('\n\n')
      const prompt = userText || 'Proceed.'

      const runner = new Runner({ model: this.runtime.getModel() })
      const stream: any = await runner.run(triageAgent as any, prompt, { stream: true })

      // Map SDK stream events to AgentEvent frames
      const phaseForAgent = (name?: string) => {
        if (!name) return undefined
        if (/strategy/i.test(name)) return 'analysis' as const
        if (/content/i.test(name)) return 'generation' as const
        if (/quality|qa/i.test(name)) return 'qa' as const
        return undefined
      }

      // Track specialist involvement + whether we forced a step ourselves
      let sawContentInvolvement = false
      let sawQaInvolvement = false
      // Track current phase to gate raw deltas
      let currentPhase: 'analysis' | 'planning' | 'generation' | 'qa' | 'finalization' | 'idle' | undefined = 'planning'
      const forcedContent = false
      const forcedQa = false
      try {
        for await (const ev of stream as AsyncIterable<any>) {
          // Raw model deltas
          if (ev?.type === 'raw_model_stream_event') {
            const data = ev.data
            if (data?.type === 'output_text_delta' && typeof data.delta === 'string' && data.delta.length > 0) {
              if (currentPhase === 'generation' || currentPhase === 'qa') {
                onEvent({ type: 'delta', message: data.delta, correlationId: cid })
              }
            }
            continue
          }

          // Itemized events (messages, tools, handoffs)
          if (ev?.type === 'run_item_stream_event') {
            const name = ev.name as string
            const item = ev.item as any
            const raw = item?.rawItem as any

            if (name === 'message_output_created') {
              const text = typeof item?.content === 'string' ? item.content : undefined
              if (text && text.length > 0) {
                // Emit deltas only during generation/qa phases
                if (currentPhase === 'generation' || currentPhase === 'qa') {
                  onEvent({ type: 'delta', message: text, correlationId: cid })
                }
                // Opportunistically capture specialist artifacts from messages within the triage-run
                try {
                  if (currentPhase === 'generation') {
                    // Content messages are plain text drafts
                    artifacts.generation = { rawText: text, draftText: text }
                    sawContentInvolvement = true
                  } else if (currentPhase === 'qa') {
                    // QA messages are expected to be JSON; parse best-effort
                    let parsedQa: any | undefined
                    try {
                      for (const cand of extractJsonCandidates(text)) {
                        try { parsedQa = JSON.parse(cand); break } catch {}
                      }
                    } catch {}
                    if (parsedQa || text) {
                      artifacts.qa = { rawText: text, result: parsedQa ?? text }
                      sawQaInvolvement = true
                    }
                  }
                } catch {}
                // Attempt to ingest plan updates from LLM-authored JSON
                try {
                  const candidates = extractJsonCandidates(text)
                  for (const cand of candidates) {
                    try {
                      const obj = JSON.parse(cand)
                      if (obj && typeof obj === 'object' && obj.action === 'plan_update') {
                        const candidate = (obj as any).planPatch ?? (obj as any).plan_patch ?? (obj as any).patch
                        if (candidate) {
                          const parsed = PlanPatchSchema.safeParse(candidate)
                          if (parsed.success) {
                            applyPlanPatch(plan, parsed.data as any)
                            emitPlanUpdate(parsed.data)
                            // Plan-driven execution: if the model did not call a handoff tool,
                            // execute the next pending capability step in the plan.
                            try {
                              const next = plan.steps.find(s => s && s.status === 'pending' && typeof (s as any).capabilityId === 'string')
                              if (next && (next as any).capabilityId) {
                                setStepStatusById(next.id, 'in_progress')
                                await executeSpecialistStep((next as any).capabilityId as string, buildPayloadForCapability((next as any).capabilityId as string))
                              }
                            } catch (ex) {
                              onEvent({ type: 'error', message: 'plan-driven step execution failed', data: { error: String(ex) }, correlationId: cid })
                            }
                          } else {
                            const normalized = normalizePlanPatchInput(candidate, plan)
                            if (normalized) {
                              applyPlanPatch(plan, normalized as any)
                              emitPlanUpdate(normalized)
                              // Plan-driven execution for normalized patches as well
                              try {
                                const next = plan.steps.find(s => s && s.status === 'pending' && typeof (s as any).capabilityId === 'string')
                                if (next && (next as any).capabilityId) {
                                  setStepStatusById(next.id, 'in_progress')
                                  await executeSpecialistStep((next as any).capabilityId as string, buildPayloadForCapability((next as any).capabilityId as string))
                                }
                              } catch (ex) {
                                onEvent({ type: 'error', message: 'plan-driven step execution failed', data: { error: String(ex) }, correlationId: cid })
                              }
                            }
                          }
                        }
                      } else if (obj && typeof obj === 'object' && obj.action === 'handoff') {
                        const capabilityId = (obj as any).capabilityId ?? (obj as any).to ?? (obj as any).step ?? (obj as any).kind
                        const payload = (obj as any).payload
                        try {
                          const cap = typeof capabilityId === 'string' ? capabilityId : String(capabilityId || '')
                          const effectivePayload = (payload === undefined || payload === null)
                            ? buildPayloadForCapability(cap)
                            : payload
                          await executeSpecialistStep(cap, effectivePayload)
                        } catch (ex) {
                          onEvent({ type: 'error', message: `Specialist execution failed`, data: { capabilityId, error: String(ex) }, correlationId: cid })
                        }
                      }
                    } catch {}
                  }
                } catch {}
              }
            } else if (name === 'tool_called') {
              const toolName = raw?.name || item?.agent?.name || 'tool'
              let args: any = undefined
              if (typeof raw?.arguments === 'string') {
                try { args = JSON.parse(raw.arguments) } catch { args = raw.arguments }
              }
              onEvent({ type: 'tool_call', message: toolName, data: { args }, correlationId: cid })
              // domain-agnostic: do not infer involvement from tool names
            } else if (name === 'tool_output') {
              const toolName = raw?.name || item?.agent?.name || 'tool'
              const result = (raw?.output && typeof raw.output === 'object') ? raw.output : (item?.output ?? raw?.output ?? null)
              onEvent({ type: 'tool_result', message: toolName, data: { result }, correlationId: cid })
              // domain-agnostic: do not infer involvement from tool names
            } else if (name === 'handoff_requested') {
              const from = item?.agent?.name
              onEvent({ type: 'handoff', message: 'requested', data: { from }, correlationId: cid })
            } else if (name === 'handoff_occurred') {
              const from = item?.sourceAgent?.name || item?.agent?.name
              const to = item?.targetAgent?.name
              onEvent({ type: 'handoff', message: 'occurred', data: { from, to }, correlationId: cid })
              const phase = phaseForAgent(to)
              if (phase) {
                currentPhase = phase
                onEvent({ type: 'phase', phase, message: `Handed off to ${to}`, correlationId: cid })
              }
              // Capability-driven orchestration: do not auto-progress steps by static names.
              // The LLM should emit plan_update patches (stepsUpdate) to drive plan progression.
              if (/content/i.test(String(to || ''))) sawContentInvolvement = true
              if (/(quality|qa)/i.test(String(to || ''))) sawQaInvolvement = true
            } else if (typeof name === 'string' && /handoff/i.test(name)) {
              // Catch-all for possible SDK variations of handoff event names
              const from = item?.sourceAgent?.name || item?.agent?.name
              const to = item?.targetAgent?.name || raw?.targetAgent?.name
              onEvent({ type: 'handoff', message: name, data: { from, to }, correlationId: cid })
              const phase = phaseForAgent(to)
              if (phase) {
                currentPhase = phase
                onEvent({ type: 'phase', phase, message: `Handed off to ${to}`, correlationId: cid })
              }
              if (/content/i.test(String(to || ''))) sawContentInvolvement = true
              if (/(quality|qa)/i.test(String(to || ''))) sawQaInvolvement = true
            } else if (name === 'reasoning_item_created') {
              const text = raw?.rawContent?.[0]?.text || raw?.content?.[0]?.text || ''
              if (text) onEvent({ type: 'message', message: text, correlationId: cid })
            } else if (name === 'tool_approval_requested') {
              onEvent({ type: 'warning', message: 'Tool approval requested', data: { item }, correlationId: cid })
            }
            continue
          }

          // Agent context updates - signal phase if recognizable
          if (ev?.type === 'agent_updated_stream_event') {
            const agentName = ev?.agent?.name as string | undefined
            const phase = phaseForAgent(agentName)
            if (phase) {
              currentPhase = phase
              onEvent({ type: 'phase', phase, message: `Running ${agentName}`, correlationId: cid })
            }
            if (/content/i.test(String(agentName || ''))) sawContentInvolvement = true
            if (/(quality|qa)/i.test(String(agentName || ''))) sawQaInvolvement = true
            continue
          }

          // Generic agent-notification catch-all (SDK may emit other names)
          if (ev && (ev as any).agent && typeof (ev as any).agent.name === 'string') {
            const agentName = String((ev as any).agent.name)
            if (/content/i.test(agentName)) sawContentInvolvement = true
            if (/(quality|qa)/i.test(agentName)) sawQaInvolvement = true
            const phase = phaseForAgent(agentName)
            if (phase) {
              currentPhase = phase
              onEvent({ type: 'phase', phase, message: `Running ${agentName}`, correlationId: cid })
            }
            continue
          }
        }
      } catch (streamErr: any) {
        // fall through to finalize; error will be emitted below
        log.warn('orchestrator_stream_iteration_error', { cid, err: String(streamErr) })
      }

      // Finalization after streaming completes
      await stream.completed
      // Make the control transfer explicit in the UI
      onEvent({ type: 'phase', phase: 'finalization', message: 'Orchestrator finalizing', correlationId: cid })
      // Capability-driven: finalization should be reflected by plan_update patches (e.g., action:"finalize")
      // No hardcoded progression here.
      
      // Try to parse final output into aligned AppResult shape; fallback to legacy forms
      let appOut: any
      const pickPlatformAndContent = (v: any): { platform: string; content: string } => {
        try {
          if (!v) return { platform: 'generic', content: '' }
          if (typeof v === 'string') return { platform: 'generic', content: v.trim() }
          if (Array.isArray(v?.drafts) && v.drafts.length > 0) {
            const d = v.drafts[0]
            const post = typeof d?.post === 'string' ? d.post : (typeof d?.content === 'string' ? d.content : '')
            const platform = typeof d?.platform === 'string' ? d.platform : (typeof d?.channel === 'string' ? d.channel : 'generic')
            return { platform, content: String(post || '').trim() }
          }
          if (Array.isArray(v?.posts) && v.posts.length > 0) {
            const p0 = v.posts[0]
            if (typeof p0 === 'string') return { platform: 'generic', content: p0.trim() }
            if (p0 && typeof p0 === 'object') {
              const post = typeof (p0 as any).post === 'string' ? (p0 as any).post : (typeof (p0 as any).content === 'string' ? (p0 as any).content : '')
              const platform = typeof (p0 as any).platform === 'string' ? (p0 as any).platform : (typeof (p0 as any).channel === 'string' ? (p0 as any).channel : 'generic')
              return { platform, content: String(post || '').trim() }
            }
          }
          if (v && typeof v === 'object') {
            const post = typeof v.post === 'string' ? v.post : (typeof v.content === 'string' ? v.content : (typeof v.text === 'string' ? v.text : ''))
            const platform = typeof v.platform === 'string' ? v.platform : (typeof (v as any).channel === 'string' ? (v as any).channel : 'generic')
            if (post) return { platform, content: String(post || '').trim() }
          }
        } catch {}
        return { platform: 'generic', content: '' }
      }
      try {
        // StreamedRunResult has finalOutput getter when completed
        const finalOutput: any = (stream as any).finalOutput
        let obj: any = undefined
        if (typeof finalOutput === 'string') {
          try { obj = JSON.parse(finalOutput) } catch {}
        } else if (finalOutput && typeof finalOutput === 'object') {
          obj = finalOutput
        }
        if (obj && typeof obj === 'object') {
          // Preferred: new AppResult shape
          if ('result' in obj && typeof (obj as any).result === 'object' && typeof (obj as any).result?.content === 'string') {
            try {
              const parsed = AppResultSchema.parse(obj)
              appOut = parsed
            } catch {
              // best-effort coercion
              const r = (obj as any).rationale ?? artifacts.strategy?.rationale ?? null
              const ks = (obj as any).knobSettings ?? artifacts.strategy?.knobs
              const qr = (obj as any)['quality-report'] ?? artifacts.qa?.result
              appOut = { result: (obj as any).result, rationale: r, knobSettings: ks, ['quality-report']: qr }
            }
          } else {
            // Legacy: bundle or legacy AppResult; coerce to new format
            const legacy = obj as any
            const legacyResult = 'result' in legacy ? legacy.result : legacy
            const { platform, content } = pickPlatformAndContent(legacyResult)
            const rationale = (legacy?.rationale ?? artifacts.strategy?.rationale) ?? null
            const knobSettings = (artifacts.strategy?.knobs ?? legacyResult?.knobs) || undefined
            const qualityReport = legacy['quality-report'] ?? legacy.quality ?? legacy['acceptance-report'] ?? artifacts.qa?.result
            appOut = { result: { platform, content }, rationale, knobSettings, ['quality-report']: qualityReport }
          }
        }
      } catch {
        // ignore, fallback below
      }

      // Fallback 1: if specialists produced artifacts (e.g., Content draft), synthesize AppResult from them
      if (!appOut && (artifacts.generation?.draftText || artifacts.generation?.rawText)) {
        const contentText = (artifacts.generation?.draftText || artifacts.generation?.rawText || '').trim()
        appOut = {
          result: { platform: (artifacts.strategy?.writerBrief as any)?.platform || 'generic', content: contentText },
          rationale: artifacts.strategy?.rationale ?? null,
          knobSettings: artifacts.strategy?.knobs,
          ['quality-report']: artifacts.qa?.result
        }
      }

      if (!appOut) {
        // Best-effort extraction of last text output to shape an AppResult (no synthesis)
        const outputs = (stream?.state?._modelResponses?.[stream?.state?._modelResponses?.length - 1]?.output) || []
        const text = outputs
          .map((o: any) => (o?.content || []).filter((p: any) => p?.type === 'output_text').map((p: any) => p.text).join(''))
          .join('')
        appOut = text
          ? { result: { platform: (artifacts.strategy?.writerBrief as any)?.platform || 'generic', content: text.trim() }, rationale: artifacts.strategy?.rationale ?? null, knobSettings: artifacts.strategy?.knobs, ['quality-report']: artifacts.qa?.result }
          : { result: { platform: 'generic', content: '' }, rationale: 'Final output missing or invalid; no orchestrator synthesis applied.', knobSettings: artifacts.strategy?.knobs }
      }

      // If empty/invalid final output, attempt to fill from generation artifact; else warn and finalize with empty content
      if (!appOut?.result || typeof appOut.result?.content !== 'string' || appOut.result.content.trim() === '') {
        const genText = (artifacts.generation?.draftText || artifacts.generation?.rawText || '').trim()
        if (genText) {
          const platform = appOut?.result?.platform || (artifacts.strategy?.writerBrief as any)?.platform || 'generic'
          appOut = {
            result: { platform, content: genText },
            rationale: appOut?.rationale ?? artifacts.strategy?.rationale ?? null,
            knobSettings: appOut?.knobSettings ?? artifacts.strategy?.knobs,
            ['quality-report']: appOut?.['quality-report'] ?? artifacts.qa?.result
          }
        } else {
          onEvent({ type: 'warning', message: 'Empty or invalid final output; finishing without synthesis', correlationId: cid })
          appOut = {
            result: { platform: (artifacts.strategy?.writerBrief as any)?.platform || 'generic', content: '' },
            rationale: 'Final output missing or invalid; no orchestrator synthesis applied.',
            knobSettings: artifacts.strategy?.knobs,
            ['quality-report']: artifacts.qa?.result
          }
        }
      }

      // Emit metrics and complete
      const durationMs = Date.now() - start
      // Try aggregate token usage from underlying model responses
      try {
        const responses = (stream?.state?._modelResponses || []) as any[]
        const tokens = responses.reduce((acc, r) => acc + (r?.usage?.inputTokens || 0) + (r?.usage?.outputTokens || 0), 0)
        if (tokens > 0) metricsAgg.tokensTotal += tokens
      } catch {}
      // Emit warnings only if we neither observed nor enforced the relevant specialist involvement
      try {
        const hasContent = appOut && appOut.result && typeof (appOut.result as any).content === 'string' && (appOut.result as any).content.trim().length > 0
        if (hasContent && !sawContentInvolvement && !forcedContent) {
          onEvent({ type: 'warning', message: 'No Content handoff observed; drafts may have been produced without Content agent involvement.', correlationId: cid })
        }
        if (hasContent && !sawQaInvolvement && !forcedQa) {
          onEvent({ type: 'warning', message: 'No QA involvement observed; consider increasing guidance or enabling QA step.', correlationId: cid })
        }
      } catch {}

      onEvent({ type: 'metrics', tokens: metricsAgg.tokensTotal || undefined, durationMs, correlationId: cid })
      // Capability-driven: step status changes should be LLM-driven via plan_update patches
      onEvent({ type: 'complete', data: appOut, durationMs, correlationId: cid })
      log.info('orchestrator_run_complete', { cid, mode: 'app', durationMs })
      return { final: appOut, metrics: { durationMs, tokens: metricsAgg.tokensTotal || undefined } }
    } catch (error: any) {
      const errMsg = error?.message || String(error) || 'Unknown error'
      const errStack = (error && typeof error === 'object' && 'stack' in error) ? (error as any).stack : undefined
      onEvent({ type: 'error', message: errMsg, data: { stack: errStack }, correlationId: cid })
      log.error('orchestrator_run_error', { cid, err: errMsg, stack: errStack })
      // Swallow after emitting error to avoid duplicate error frames at route layer
      return { final: null, metrics: undefined }
    }
  }

  private buildSystemPrompt(req: AgentRunRequest) {
    const base = req.options?.systemPromptOverride ||
      'You are the Orchestrator agent coordinating specialist agents. Be concise and reliable.'
    if (req.mode === 'app') {
      // Quality thresholds and max cycles are configured elsewhere; do not bake domain specifics into the orchestrator prompt.
      const guidance = [
        base,
        'You never call tools yourself; you only produce plan_update patches, handoffs, or final results. Never invent context.',
        'Planning: Propose an initial minimal plan from Registry capabilities and constraints. Emit: { "action": "plan_update", "planPatch": { "stepsAdd": [...] } } to initialize the plan.',
        'Evolve the plan by emitting plan_update patches with stepsUpdate/status changes and concise notes. Do not restate the full plan; send only patches.',
        'Delegate work via transfer_to_* handoff tools only; specialists author artifacts.',
        'Quality: enforce configured criteria/thresholds; if insufficient and depth allows, iterate via targeted handoffs.',
        'Finalize only when constraints are satisfied or execution depth is reached; do not finalize after planning alone.',
        'Final app output spec (AppResult):',
        '{',
        '  "result": { "content": "<final post text>", "platform": "<e.g., linkedin|x>" },',
        '  "rationale": "<strategy manager rationale>",',
        '  "knobSettings"?: { "formatType"?: "<string>", "hookIntensity"?: "<number|low|med|high>", "expertiseDepth"?: "<number|low|med|high>", "structure"?: "<string|object>" },',
        '  "quality-report"?: <qa agent JSON>',
        '}',
        'When finalizing, return one JSON object matching AppResult. Do not include markdown or code fences.'
      ].join('\n')
      return [ORCH_SYS_START, guidance, ORCH_SYS_END].join('\n')
    }
    // chat
    const chatGuidance = [base, 'Respond conversationally. Keep answers short. Do not use tools; if action is needed, recommend a handoff to the appropriate specialist agent.'].join('\n')
    return [ORCH_SYS_START, chatGuidance, ORCH_SYS_END].join('\n')
  }
}

export function getOrchestrator() {
  const { runtime } = getAgents()
  return new OrchestratorAgent(runtime)
}
