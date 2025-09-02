import OpenAI from 'openai'
import { z } from 'zod'

type ToolHandler = (args: any) => Promise<any> | any

export type RegisteredTool = {
  name: string
  description: string
  parameters: Record<string, any>
  handler: ToolHandler
}

export class AgentRuntime {
  private client: OpenAI
  private model = process.env.OPENAI_MODEL || 'gpt-4o'
  private tools: RegisteredTool[] = []

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      // Allow constructing in dev; API calls will fail if used
      // eslint-disable-next-line no-console
      console.warn('[AgentRuntime] OPENAI_API_KEY not set; API calls will fail')
    }
    this.client = new OpenAI({ apiKey: apiKey || 'unset' })
  }

  registerTool(tool: RegisteredTool) {
    this.tools.push(tool)
  }

  async runStructured<T>(schema: z.ZodSchema<T>, messages: Array<{ role: 'user' | 'system' | 'assistant'; content: string }>): Promise<T> {
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages,
      response_format: { type: 'json_object' }
    })
    const raw = completion.choices[0]?.message?.content
    if (!raw) throw new Error('No content from model')
    return schema.parse(JSON.parse(raw))
  }

  async runWithTools(messages: Array<{ role: 'user' | 'system' | 'assistant'; content: string }>) {
    const toolSpecs = this.tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }))

    const convo: any[] = [...messages]

    while (true) {
      const res = await this.client.chat.completions.create({
        model: this.model,
        messages: convo as any,
        tools: toolSpecs,
        tool_choice: 'auto'
      })

      const msg = res.choices[0]?.message
      if (!msg) throw new Error('No message from model')

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        return msg
      }

      for (const call of msg.tool_calls) {
        const tool = this.tools.find((t) => t.name === call.function.name)
        if (!tool) continue
        const args = JSON.parse(call.function.arguments || '{}')
        const result = await tool.handler(args)
        convo.push({
          role: 'tool',
          tool_call_id: call.id,
          content: typeof result === 'string' ? result : JSON.stringify(result)
        } as any)
      }

      convo.push({ role: 'assistant', tool_calls: msg.tool_calls, content: msg.content || null } as any)
    }
  }

  async runChatStream(
    messages: Array<{ role: 'user' | 'system' | 'assistant'; content: string }>,
    onDelta: (delta: string) => void
  ): Promise<string> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages,
      stream: true
    })
    let full = ''
    for await (const chunk of stream as any) {
      const d = chunk?.choices?.[0]?.delta?.content || ''
      if (d) {
        full += d
        onDelta(d)
      }
    }
    return full
  }
}
