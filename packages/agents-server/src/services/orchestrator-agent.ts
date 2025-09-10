import { AppResultSchema, agentThresholds, type AgentRunRequest, type AgentEvent } from '@awesomeposter/shared'
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
  return (data: any) => {
    const arr = Array.isArray(data?.inputHistory)
      ? data.inputHistory
      : (data?.inputHistory ? [data.inputHistory] : [])
    const filtered = historyFilter(arr)
    return { ...data, inputHistory: filtered }
  }
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

    const system = this.buildSystemPrompt(req)
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: system },
      { role: 'user', content: req.objective }
    ]
    if (req.briefId) {
      messages.push({
        role: 'user',
        content: `Context: briefId=${req.briefId}. Specialist agents may use tools like io_get_brief, io_list_assets, io_get_client_profile when they receive a handoff. The Orchestrator must not call tools directly.`
      })
    }

    try {
      if (req.mode === 'chat') {
        const target = (req.options as any)?.targetAgentId || 'orchestrator'
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

      // Provide named factory functions for handoffs to satisfy SDK default tool-name derivation

      const TRIAGE_INSTRUCTIONS = (() => {
        const minScore = agentThresholds.minCompositeScore
        const maxRisk = agentThresholds.maxBrandRisk
        const mrc = (req as any)?.options?.maxRevisionCycles
        const maxCycles = typeof mrc === 'number' ? mrc : agentThresholds.maxRevisionCycles
        const lines = [
          'You are the Orchestrator. Coordinate the Strategy Manager, Content Generator, and Quality Assurance specialists to deliver high‑quality social posts.',
          'Objectives: return exactly one valid JSON object { "result": <object>, "rationale": <string|null> }. No extra text, no markdown, no code fences.',
          'Way of Working: Strategize → Generate → QA → Finalize.',
          'Strategize (Strategy Manager): use tools (io_get_brief, io_get_client_profile, io_list_assets, strategy_analyze_assets). Choose an achievable formatType based on assets; if the brief requests an unachievable format, pick the best achievable alternative and explain the tradeoff in rationale. Produce a concise writer brief including goal, audience insight, angle, 2–3 hooks, CTA, and 4‑knob settings.',
          'Generate (Content Generator): by default produce 3 variants unless the objective specifies otherwise. Structure each draft as: first line hook, blank line, then body. Use tools (apply_format_rendering, optimize_for_platform). Write only in the client\'s primaryCommunicationLanguage; honor tone/voice, emoji policy, bannedClaims. You MUST delegate draft generation to Content; do not write drafts yourself.',
          `QA (Quality Assurance): score drafts on 0–1 for readability, clarity, objectiveFit, brandRisk, compliance. If composite < ${minScore} or brandRisk > ${maxRisk} or compliance=false, produce succinct revision instructions and hand back to Content. Iterate until pass or max ${maxCycles} cycles.`,
          'Constraints: never invent assets or client data; specialist agents use tools to fetch context. The Orchestrator must not call tools. Keep handoffs minimal and purposeful. Honor any tool allowlist and policy. Stop when thresholds are met or max cycles reached. Do not finalize after Strategy alone.',
          'Final delivery spec: result MUST include { drafts: [ { platform, variantId, post, altText } x3 ], knobs: { ... } } and MAY include schedule and a short qaSummary. Do not emit partial plans as final.',
          'Output: return a single JSON object only. Do not wrap in code fences. ' + (req.options?.schemaName ? `Conform to schema: ${req.options.schemaName}.` : ''),
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
      let forcedContent = false
      let forcedQa = false
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
              if (text && text.length > 0 && (currentPhase === 'generation' || currentPhase === 'qa')) {
                onEvent({ type: 'delta', message: text, correlationId: cid })
              }
            } else if (name === 'tool_called') {
              const toolName = raw?.name || item?.agent?.name || 'tool'
              let args: any = undefined
              if (typeof raw?.arguments === 'string') {
                try { args = JSON.parse(raw.arguments) } catch { args = raw.arguments }
              }
              onEvent({ type: 'tool_call', message: toolName, data: { args }, correlationId: cid })
              if (/apply_format_rendering|optimize_for_platform/i.test(String(toolName))) sawContentInvolvement = true
              if (/qa_evaluate_content/i.test(String(toolName))) sawQaInvolvement = true
            } else if (name === 'tool_output') {
              const toolName = raw?.name || item?.agent?.name || 'tool'
              const result = (raw?.output && typeof raw.output === 'object') ? raw.output : (item?.output ?? raw?.output ?? null)
              onEvent({ type: 'tool_result', message: toolName, data: { result }, correlationId: cid })
              if (/apply_format_rendering|optimize_for_platform/i.test(String(toolName))) sawContentInvolvement = true
              if (/qa_evaluate_content/i.test(String(toolName))) sawQaInvolvement = true
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

      // Try to parse final output
      let parsed: any
      try {
        // StreamedRunResult has finalOutput getter when completed
        const finalOutput: any = (stream as any).finalOutput
        const contentStr = typeof finalOutput === 'string' ? finalOutput : JSON.stringify(finalOutput ?? '')
        parsed = AppResultSchema.parse(JSON.parse(contentStr || '{}'))
      } catch {
        // If parsing failed, attempt to synthesize from last outputs
        const outputs = (stream?.state?._modelResponses?.[stream?.state?._modelResponses?.length - 1]?.output) || []
        const text = outputs.map((o: any) => (o?.content || []).filter((p: any) => p?.type === 'output_text').map((p: any) => p.text).join('')).join('')
        parsed = text ? { result: text } : { result: null }
      }

      // Fallback synthesis if result is empty
      if (!parsed?.result || (typeof parsed.result === 'string' && parsed.result.trim() === '')) {
        try {
          if (req.briefId) {
            const db = getDb()
            const rows = await db.select().from(assetsTable).where(eq(assetsTable.briefId, req.briefId))
            const mapped = rows.map((r: any) => ({
              id: r.id,
              filename: r.filename || '',
              originalName: r.originalName || undefined,
              url: r.url,
              type: (r.type || 'other') as any,
              mimeType: r.mimeType || undefined,
              fileSize: r.fileSize || undefined,
              metaJson: r.metaJson || undefined
            }))
            const analysis = analyzeAssetsLocal(mapped as any)
            const format: any = analysis?.recommendedFormat || 'text'
            let hookIntensity = /awareness|launch|new/i.test(req.objective) ? 0.75 : 0.6
            const expertiseDepth = /technical|deep|guide|how\-to/i.test(req.objective) ? 0.7 : 0.5
            const structure = { lengthLevel: format === 'document_pdf' ? 0.9 : format === 'text' ? 0.7 : 0.4, scanDensity: format === 'text' ? 0.6 : 0.5 }
            const knobs = { formatType: format, hookIntensity, expertiseDepth, structure }
            parsed = { result: { analysis, knobs }, rationale: 'Heuristic fallback used due to empty model output.' }
          } else {
            parsed = { result: { message: 'No content generated' }, rationale: 'Fallback due to empty model output.' }
          }
        } catch {}
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
        const hasDrafts = parsed && parsed.result && Array.isArray((parsed.result as any).drafts) && ((parsed.result as any).drafts as any[]).length > 0
        if (hasDrafts && !sawContentInvolvement && !forcedContent) {
          onEvent({ type: 'warning', message: 'No Content handoff observed; drafts may have been produced without Content agent involvement.', correlationId: cid })
        }
        if (hasDrafts && !sawQaInvolvement && !forcedQa) {
          onEvent({ type: 'warning', message: 'No QA involvement observed; consider increasing guidance or enabling QA step.', correlationId: cid })
        }
      } catch {}

      onEvent({ type: 'metrics', tokens: metricsAgg.tokensTotal || undefined, durationMs, correlationId: cid })
      onEvent({ type: 'complete', data: parsed, durationMs, correlationId: cid })
      log.info('orchestrator_run_complete', { cid, mode: 'app', durationMs })
      return { final: parsed, metrics: { durationMs, tokens: metricsAgg.tokensTotal || undefined } }
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
      'You are the Orchestrator agent for social content creation. Be concise and reliable.'
    if (req.mode === 'app') {
      const minScore = agentThresholds.minCompositeScore
      const maxRisk = agentThresholds.maxBrandRisk
      const mrc = (req as any)?.options?.maxRevisionCycles
      const maxCycles = typeof mrc === 'number' ? mrc : agentThresholds.maxRevisionCycles
      const guidance = [
        base,
        'Follow this flow: Strategize → Generate → QA → Finalize. Do not call tools yourself; route work via handoffs to specialist agents who will use tools as needed. Never invent assets or client data.',
        `Quality thresholds: composite ≥ ${minScore}, brandRisk ≤ ${maxRisk}, compliance=true; iterate up to ${maxCycles} revision cycles if needed.`,
        'Default to 3 drafts. Do not finalize after Strategy alone.',
        'Final delivery spec: { "result": { "drafts": [ { "platform": "...", "variantId": "1", "post": "...", "altText": "..." } x3 ], "knobs": { ... }, "schedule"?: { ... }, "qaSummary"?: { ... } }, "rationale"?: <string> }',
        'When responding, output only a single JSON object that matches this schema:',
        '{ "result": <any>, "rationale"?: <string> }',
        'Do not include markdown, code fences, or any commentary outside of the JSON.'
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
