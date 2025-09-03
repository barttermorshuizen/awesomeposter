import { AppResultSchema, type AgentRunRequest, type AgentEvent } from '@awesomeposter/shared'
import { getLogger } from './logger'
import { AgentRuntime } from './agent-runtime'
import { getAgents } from './agents-container'
import { getDb, assets as assetsTable, eq } from '@awesomeposter/db'
import { analyzeAssetsLocal } from '../tools/strategy'
import { Agent as OAAgent, Agent as AgentClass, Runner } from '@openai/agents'

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
        onEvent({ type: 'phase', phase: 'analysis', message: 'Entering chat mode', correlationId: cid })
        let full = ''
        await this.runtime.runChatStream(messages, (delta) => {
          full += delta
          onEvent({ type: 'delta', message: delta, correlationId: cid })
        })
        const durationMs = Date.now() - start
        onEvent({ type: 'message', message: full, correlationId: cid })
        onEvent({ type: 'complete', data: { message: full }, durationMs, correlationId: cid })
        log.info('orchestrator_run_complete', { cid, mode: 'chat', durationMs, size: full.length })
        return { final: { message: full }, metrics: { durationMs } }
      }

      // Applicative mode (structured via handoffs among specialist agents)
      onEvent({ type: 'phase', phase: 'planning', message: 'Structured run started', correlationId: cid })

      // Build specialist agents and triage agent with handoffs
      const toolsStrategy = this.runtime.getAgentTools(
        ['io_get_brief', 'io_list_assets', 'io_get_client_profile', 'strategy_analyze_assets', 'strategy_plan_knobs'],
        (e) => {
          if (e.type === 'tool_call') onEvent({ type: 'tool_call', message: e.name, data: { args: e.args }, correlationId: cid })
          if (e.type === 'tool_result') onEvent({ type: 'tool_result', message: e.name, data: { result: e.result }, correlationId: cid })
          if (e.type === 'metrics') onEvent({ type: 'metrics', tokens: e.tokens, durationMs: e.durationMs, correlationId: cid })
        }
      ) as any
      const toolsContent = this.runtime.getAgentTools(
        ['apply_format_rendering', 'optimize_for_platform'],
        (e) => {
          if (e.type === 'tool_call') onEvent({ type: 'tool_call', message: e.name, data: { args: e.args }, correlationId: cid })
          if (e.type === 'tool_result') onEvent({ type: 'tool_result', message: e.name, data: { result: e.result }, correlationId: cid })
          if (e.type === 'metrics') onEvent({ type: 'metrics', tokens: e.tokens, durationMs: e.durationMs, correlationId: cid })
        }
      ) as any
      const toolsQa = this.runtime.getAgentTools(
        ['qa_evaluate_content'],
        (e) => {
          if (e.type === 'tool_call') onEvent({ type: 'tool_call', message: e.name, data: { args: e.args }, correlationId: cid })
          if (e.type === 'tool_result') onEvent({ type: 'tool_result', message: e.name, data: { result: e.result }, correlationId: cid })
          if (e.type === 'metrics') onEvent({ type: 'metrics', tokens: e.tokens, durationMs: e.durationMs, correlationId: cid })
        }
      ) as any

      const STRATEGY_INSTRUCTIONS = [
        'You are the Strategy Manager agent. Plan social content strategy using a 4‑knob system (formatType, hookIntensity, expertiseDepth, structure).',
        'Use available tools to analyze assets and plan knobs. Respect client policy and never invent assets.',
        'When returning a final answer yourself, output only JSON. Otherwise, perform handoffs as needed.'
      ].join('\n')
      const CONTENT_INSTRUCTIONS = [
        'You are the Content Generator agent. Generate platform‑optimized posts based on the 4‑knob configuration and client language.',
        'Use tools to apply format rendering and optimize for platforms. Follow platform rules and client policy.',
        'When returning a final answer yourself, output only JSON.'
      ].join('\n')
      const QA_INSTRUCTIONS = [
        'You are the Quality Assurance agent. Evaluate drafts for readability, clarity, objective fit, brand risk, and compliance.',
        'Return structured scores and prioritized suggestions as JSON.'
      ].join('\n')

      const strategyAgent = new OAAgent({ name: 'Strategy Manager', instructions: STRATEGY_INSTRUCTIONS, tools: toolsStrategy })
      const contentAgent = new OAAgent({ name: 'Content Generator', instructions: CONTENT_INSTRUCTIONS, tools: toolsContent })
      const qaAgent = new OAAgent({ name: 'Quality Assurance', instructions: QA_INSTRUCTIONS, tools: toolsQa })

      const TRIAGE_INSTRUCTIONS = [
        'You are the Orchestrator. Decide which specialist (Strategy, Content, QA) should handle each step and perform handoffs as needed.',
        'When you are ready to return the final result, output only a single JSON object that matches this schema:',
        '{ "result": <any>, "rationale"?: <string> }',
        'Do not include any additional commentary outside of the JSON.'
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
      const runResult: any = await runner.run(triageAgent as any, prompt)
      let parsed: any
      let contentStr = typeof runResult?.finalOutput === 'string' ? runResult.finalOutput : JSON.stringify(runResult?.finalOutput ?? '')
      try {
        parsed = AppResultSchema.parse(JSON.parse(contentStr || '{}'))
      } catch {
        parsed = { result: contentStr }
      }

      // If model returned nothing useful, synthesize a minimal result using tools/DB
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
            parsed = { result: { message: contentStr || 'No content generated' }, rationale: 'Fallback due to empty model output.' }
          }
        } catch {
          // keep parsed as is if synthesis fails
        }
      }
      const durationMs = Date.now() - start
      onEvent({ type: 'complete', data: parsed, durationMs, correlationId: cid })
      log.info('orchestrator_run_complete', { cid, mode: 'app', durationMs })
      return { final: parsed, metrics: { durationMs } }
    } catch (error: any) {
      onEvent({ type: 'error', message: error?.message || 'Unknown error', correlationId: cid })
      log.error('orchestrator_run_error', { cid, err: error?.message })
      throw error
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
