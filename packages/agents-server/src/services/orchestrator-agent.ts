import { AppResultSchema, type AgentRunRequest, type AgentEvent } from '@awesomeposter/shared'
import { getLogger } from './logger'
import { AgentRuntime } from './agent-runtime'
import { getAgents } from './agents-container'
import { getDb, assets as assetsTable, eq } from '@awesomeposter/db'
import { analyzeAssetsLocal } from '../tools/strategy'
import { Agent as AgentClass, Runner } from '@openai/agents'
import { createStrategyAgent } from '../agents/strategy-manager'
import { createContentAgent } from '../agents/content-generator'
import { createQaAgent } from '../agents/quality-assurance'

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
        content: `Context: briefId=${req.briefId}. You may use tools like io_get_brief, io_list_assets, io_get_client_profile if needed.`
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
              toolsAllowlist: req.options?.toolsAllowlist,
              toolPolicy: req.options?.toolPolicy,
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
          if (target === 'strategy') agentInstance = createStrategyAgent(this.runtime, onToolEvent, opts)
          else if (target === 'generator') agentInstance = createContentAgent(this.runtime, onToolEvent, opts)
          else if (target === 'qa') agentInstance = createQaAgent(this.runtime, onToolEvent, opts)
          else agentInstance = undefined

          const systemText = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
          const userText = messages.filter((m) => m.role !== 'system').map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')
          const prompt = [systemText, userText].filter(Boolean).join('\n\n') || 'Proceed.'

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
        const durationMs = Date.now() - start
        onEvent({ type: 'message', message: full, correlationId: cid })
        // Final metrics frame for chat mode (tokens may be unavailable)
        onEvent({ type: 'metrics', durationMs, correlationId: cid })
        onEvent({ type: 'complete', data: { message: full }, durationMs, correlationId: cid })
        log.info('orchestrator_run_complete', { cid, mode: 'chat', durationMs, size: full.length, target })
        return { final: { message: full }, metrics: { durationMs } }
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

      const TRIAGE_INSTRUCTIONS = [
        'You are the Orchestrator. Decide which specialist (Strategy, Content, QA) should handle each step and perform handoffs as needed.',
        'When you are ready to return the final result, output only a single JSON object that matches this schema:',
        '{ "result": <any>, "rationale"?: <string> }',
        'Do not include any additional commentary outside of the JSON.',
        req.options?.schemaName ? `Schema name: ${req.options.schemaName}` : ''
      ].join('\n')

      const triageAgent = AgentClass.create({
        name: 'Triage Agent',
        instructions: TRIAGE_INSTRUCTIONS,
        handoffs: [strategyAgent, contentAgent, qaAgent]
      })

      // Build the prompt/user input
      const systemText = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
      const userText = messages.filter((m) => m.role !== 'system').map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')
      const prompt = [systemText, userText].filter(Boolean).join('\n\n') || 'Proceed.'

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

      try {
        for await (const ev of stream as AsyncIterable<any>) {
          // Raw model deltas
          if (ev?.type === 'raw_model_stream_event') {
            const data = ev.data
            if (data?.type === 'output_text_delta' && typeof data.delta === 'string' && data.delta.length > 0) {
              onEvent({ type: 'delta', message: data.delta, correlationId: cid })
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
              if (text && text.length > 0) onEvent({ type: 'delta', message: text, correlationId: cid })
            } else if (name === 'tool_called') {
              const toolName = raw?.name || item?.agent?.name || 'tool'
              let args: any = undefined
              if (typeof raw?.arguments === 'string') {
                try { args = JSON.parse(raw.arguments) } catch { args = raw.arguments }
              }
              onEvent({ type: 'tool_call', message: toolName, data: { args }, correlationId: cid })
            } else if (name === 'tool_output') {
              const toolName = raw?.name || item?.agent?.name || 'tool'
              const result = (raw?.output && typeof raw.output === 'object') ? raw.output : (item?.output ?? raw?.output ?? null)
              onEvent({ type: 'tool_result', message: toolName, data: { result }, correlationId: cid })
            } else if (name === 'handoff_requested') {
              const from = item?.agent?.name
              onEvent({ type: 'handoff', message: 'requested', data: { from }, correlationId: cid })
            } else if (name === 'handoff_occurred') {
              const from = item?.sourceAgent?.name || item?.agent?.name
              const to = item?.targetAgent?.name
              onEvent({ type: 'handoff', message: 'occurred', data: { from, to }, correlationId: cid })
              const phase = phaseForAgent(to)
              if (phase) onEvent({ type: 'phase', phase, message: `Handed off to ${to}`, correlationId: cid })
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
            if (phase) onEvent({ type: 'phase', phase, message: `Running ${agentName}`, correlationId: cid })
            continue
          }
        }
      } catch (streamErr: any) {
        // fall through to finalize; error will be emitted below
        log.warn('orchestrator_stream_iteration_error', { cid, err: String(streamErr) })
      }

      // Finalization after streaming completes
      await stream.completed

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
      onEvent({ type: 'metrics', tokens: metricsAgg.tokensTotal || undefined, durationMs, correlationId: cid })
      onEvent({ type: 'complete', data: parsed, durationMs, correlationId: cid })
      log.info('orchestrator_run_complete', { cid, mode: 'app', durationMs })
      return { final: parsed, metrics: { durationMs, tokens: metricsAgg.tokensTotal || undefined } }
    } catch (error: any) {
      onEvent({ type: 'error', message: error?.message || 'Unknown error', correlationId: cid })
      log.error('orchestrator_run_error', { cid, err: error?.message })
      // Swallow after emitting error to avoid duplicate error frames at route layer
      return { final: null, metrics: undefined }
    }
  }

  private buildSystemPrompt(req: AgentRunRequest) {
    const base = req.options?.systemPromptOverride ||
      'You are the Orchestrator agent for social content creation. Be concise and reliable.'
    if (req.mode === 'app') {
      return base + '\n' + [
        'When responding, output only a single JSON object that matches this schema:',
        '{ "result": <any>, "rationale"?: <string> }',
        'Do not include any additional commentary outside of the JSON.'
      ].join('\n')
    }
    // chat
    return base + '\nRespond conversationally. Keep answers short when possible.'
  }
}

export function getOrchestrator() {
  const { runtime } = getAgents()
  return new OrchestratorAgent(runtime)
}
