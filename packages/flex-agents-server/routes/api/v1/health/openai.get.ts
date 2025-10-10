import { Agent as OAAgent, Runner } from '@openai/agents'
import { getDefaultModelName } from '../../../../src/utils/model'

export default defineEventHandler(async () => {
  const apiKey = process.env.FLEX_OPENAI_API_KEY || process.env.OPENAI_API_KEY
  const model = getDefaultModelName()
  if (!apiKey) {
    return { ok: false, configured: false, error: 'FLEX_OPENAI_API_KEY not set' }
  }

  if (!process.env.OPENAI_API_KEY) {
    process.env.OPENAI_API_KEY = apiKey
  }

  const start = Date.now()
  try {
    // Primary: use Agents SDK Runner so the probe works across model families
    const agent = new OAAgent({ name: 'Health Probe', instructions: 'Reply with OK.' })
    const runner = new Runner({ model })
    const res: any = await runner.run(agent, 'Health check')
    const reply = typeof res?.finalOutput === 'string' ? res.finalOutput : ''
    const durationMs = Date.now() - start
    return {
      ok: reply.toUpperCase().includes('OK') || Boolean(reply),
      configured: true,
      model,
      durationMs,
      reply
    }
  } catch (primaryErr: any) {
    // Fallback: try legacy Chat Completions in case the SDK call path is unavailable
    try {
      const { default: OpenAI } = await import('openai')
      const client = new OpenAI({ apiKey })
      const res = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: 'You are a health probe. Reply with OK.' },
          { role: 'user', content: 'Health check' }
        ],
        max_tokens: 1,
        temperature: 0
      })
      const content = res.choices?.[0]?.message?.content || ''
      const durationMs = Date.now() - start
      return {
        ok: Boolean(res.id),
        configured: true,
        model,
        durationMs,
        reply: content
      }
    } catch (fallbackErr: any) {
      const durationMs = Date.now() - start
      return {
        ok: false,
        configured: true,
        model,
        durationMs,
        error: fallbackErr?.message || primaryErr?.message || 'OpenAI health check failed'
      }
    }
  }
})
