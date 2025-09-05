import { z, ZodObject } from 'zod'
import { Agent as OAAgent, Runner, tool as agentTool } from '@openai/agents'
import { getDefaultModelName } from '../utils/model'

type ToolHandler = (args: any) => Promise<any> | any

export type RegisteredTool = {
  name: string
  description: string
  // Prefer Zod schemas; fallback to JSON schema objects during migration
  parameters: z.ZodTypeAny | Record<string, any>
  handler: ToolHandler
}

function messagesToResponsesInput(messages: Array<{ role: 'user' | 'system' | 'assistant'; content: string }>) {
  return messages.map((m) => ({
    role: m.role,
    content: [{ type: 'input_text', text: m.content }]
  })) as any[]
}

function extractResponseText(res: any): string {
  try {
    const outputs = (res as any).output || (res as any).outputs || []
    for (const o of outputs) {
      const content = o?.content || []
      for (const part of content) {
        if ((part.type === 'output_text' || part.type === 'text') && typeof part.text === 'string') {
          return part.text
        }
      }
    }
  } catch {}
  return (res as any)?.output_text || ''
}

export class AgentRuntime {
  private model = getDefaultModelName()
  private tools: RegisteredTool[] = []

  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      // eslint-disable-next-line no-console
      console.warn('[AgentRuntime] OPENAI_API_KEY not set; SDK calls will fail')
    }
  }

  registerTool(tool: RegisteredTool) {
    this.tools.push(tool)
  }

  getModel() {
    return this.model
  }

  // Return wrapped agent tools, optionally filtered by allowlist
  getAgentTools(
    allowlist?: string[],
    onEvent?: (e: { type: 'tool_call' | 'tool_result' | 'metrics'; name?: string; args?: any; result?: any; tokens?: number; durationMs?: number }) => void
  ) {
    const selected = allowlist && allowlist.length > 0
      ? this.tools.filter((t) => allowlist.includes(t.name))
      : this.tools
    return selected.map((t) => {
      const paramsSchema = t.parameters instanceof ZodObject ? (t.parameters as z.ZodObject<any>) : z.object({})
      return agentTool({
        name: t.name,
        description: t.description,
        parameters: paramsSchema,
        execute: async (input: any) => {
          const start = Date.now()
          onEvent?.({ type: 'tool_call', name: t.name, args: input })
          try {
            const res = await t.handler(input)
            onEvent?.({ type: 'tool_result', name: t.name, result: res, durationMs: Date.now() - start })
            return res
          } catch (err: any) {
            const res = { error: true, code: 'TOOL_HANDLER_ERROR', message: err?.message || 'Tool handler error' }
            onEvent?.({ type: 'tool_result', name: t.name, result: res, durationMs: Date.now() - start })
            return res
          }
        }
      })
    })
  }

  async runStructured<T>(schema: z.ZodSchema<T>, messages: Array<{ role: 'user' | 'system' | 'assistant'; content: string }>): Promise<T> {
    const { agent, prompt } = this.buildAgentAndPrompt(messages)
    const runner = new Runner({ model: this.model })
    const result: any = await runner.run(agent, prompt)
    const out = result?.finalOutput
    const text = typeof out === 'string' ? out : JSON.stringify(out ?? '')
    if (!text) throw new Error('No content from model')
    return schema.parse(JSON.parse(text))
  }

  async runWithTools(
    messages: Array<{ role: 'user' | 'system' | 'assistant'; content: string }>,
    onEvent?: (e: { type: 'tool_call' | 'tool_result' | 'metrics'; name?: string; args?: any; result?: any; tokens?: number; durationMs?: number }) => void
  ) {
    const { agent, prompt } = this.buildAgentAndPrompt(messages, onEvent)
    const runner = new Runner({ model: this.model })
    const started = Date.now()
    // Stream full events so we can extend later; for now, we focus on final output
    const stream: any = await runner.run(agent, prompt, { stream: true })

    // If only text is needed we could do: stream.toTextStream(). But we prefer finalOutput for structured parsing upstream
    await stream.completed
    const result: any = await stream.finalResult
    const durationMs = Date.now() - started
    // Try to surface token usage if provided by the SDK
    const tokens = (result?.usage?.inputTokens || 0) + (result?.usage?.outputTokens || 0)
    onEvent?.({ type: 'metrics', durationMs, tokens: Number.isFinite(tokens) && tokens > 0 ? tokens : undefined })
    // Return a shape comparable to previous implementation
    return { content: typeof result?.finalOutput === 'string' ? result.finalOutput : JSON.stringify(result?.finalOutput ?? '') }
  }

  async runChatStream(
    messages: Array<{ role: 'user' | 'system' | 'assistant'; content: string }>,
    onDelta: (delta: string) => void
  ): Promise<string> {
    const { agent, prompt } = this.buildAgentAndPrompt(messages)
    const runner = new Runner({ model: this.model })
    const stream: any = await runner.run(agent, prompt, { stream: true })
    let full = ''
    // Prefer the text stream transformation for deltas
    const textStream: any = stream.toTextStream({ compatibleWithNodeStreams: false })
    for await (const chunk of textStream) {
      const d = chunk?.toString?.() ?? String(chunk)
      if (d) {
        full += d
        onDelta(d)
      }
    }
    await stream.completed
    const result: any = await stream.finalResult
    if (typeof result?.finalOutput === 'string') full += result.finalOutput
    return full
  }

  private buildAgentAndPrompt(
    messages: Array<{ role: 'user' | 'system' | 'assistant'; content: string }>,
    onEvent?: (e: { type: 'tool_call' | 'tool_result' | 'metrics'; name?: string; args?: any; result?: any; tokens?: number; durationMs?: number }) => void
  ) {
    const systemText = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n') || 'You are a helpful assistant.'
    const userText = messages.filter((m) => m.role !== 'system').map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')

    const wrappedTools = this.tools.map((t) => {
      // Prefer ZodObject; fallback to an empty object schema for permissive tools
      const paramsSchema = t.parameters instanceof ZodObject ? (t.parameters as z.ZodObject<any>) : z.object({})
      return agentTool({
        name: t.name,
        description: t.description,
        parameters: paramsSchema,
        execute: async (input: any) => {
          const start = Date.now()
          onEvent?.({ type: 'tool_call', name: t.name, args: input })
          try {
            const res = await t.handler(input)
            onEvent?.({ type: 'tool_result', name: t.name, result: res, durationMs: Date.now() - start })
            return res
          } catch (err: any) {
            const res = {
              error: true,
              code: 'TOOL_HANDLER_ERROR',
              message: err?.message || 'Tool handler error'
            }
            onEvent?.({ type: 'tool_result', name: t.name, result: res, durationMs: Date.now() - start })
            return res
          }
        }
      })
    })

    const agent = new OAAgent({
      name: 'Orchestrator',
      instructions: systemText,
      tools: wrappedTools
    })
    return { agent, prompt: userText || 'Proceed.' }
  }
}
