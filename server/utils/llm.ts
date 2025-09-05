import OpenAI from 'openai'
import { getEnv } from './env'

let client: OpenAI | null = null

export function getOpenAI() {
  if (client) return client
  const env = getEnv()
  client = new OpenAI({ apiKey: env.OPENAI_API_KEY })
  return client
}

/**
 * Unified default chat model selection.
 * Precedence:
 *  1) OPENAI_DEFAULT_MODEL (preferred; aligns with @openai/agents-core)
 *  2) OPENAI_MODEL (legacy alias)
 *  3) 'gpt-4o' fallback
 */
export function getDefaultChatModelName(): string {
  const m = process.env.OPENAI_DEFAULT_MODEL || process.env.OPENAI_MODEL || 'gpt-4o'
  return (m || 'gpt-4o').toString().trim()
}

export async function embed(texts: string[]) {
  const openai = getOpenAI()
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-large',
    input: texts
  })
  return res.data.map((d) => d.embedding)
}



