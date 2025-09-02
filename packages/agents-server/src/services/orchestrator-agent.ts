import { AppResultSchema, type AgentRunRequest, type AgentEvent } from '@awesomeposter/shared'
import { getLogger } from './logger'
import { AgentRuntime } from './agent-runtime'
import { getAgents } from './agents-container'

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

      // Applicative mode (structured via tools loop)
      onEvent({ type: 'phase', phase: 'planning', message: 'Structured run started', correlationId: cid })
      const finalMsg: any = await this.runtime.runWithTools(messages, (e) => {
        if (e.type === 'tool_call') {
          onEvent({ type: 'tool_call', message: e.name, data: { args: e.args }, correlationId: cid })
        } else if (e.type === 'tool_result') {
          onEvent({ type: 'tool_result', message: e.name, data: { result: e.result }, correlationId: cid })
        } else if (e.type === 'metrics') {
          onEvent({ type: 'metrics', tokens: e.tokens, durationMs: e.durationMs, correlationId: cid })
        }
      })
      // Try to parse JSON result per AppResultSchema; fallback to wrapping text
      let parsed: any
      try {
        parsed = AppResultSchema.parse(JSON.parse(finalMsg?.content || '{}'))
      } catch {
        parsed = { result: finalMsg?.content || '' }
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
