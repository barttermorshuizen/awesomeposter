import OpenAI from 'openai'

export default defineEventHandler(async () => {
  const apiKey = process.env.OPENAI_API_KEY
  const model = (process.env.OPENAI_DEFAULT_MODEL || process.env.OPENAI_MODEL || 'gpt-4o').trim()
  if (!apiKey) {
    return { ok: false, configured: false, error: 'OPENAI_API_KEY not set' }
  }

  const client = new OpenAI({ apiKey })
  const start = Date.now()
  try {
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
  } catch (err: any) {
    const durationMs = Date.now() - start
    return {
      ok: false,
      configured: true,
      model,
      durationMs,
      error: err?.message || 'OpenAI health check failed'
    }
  }
})

