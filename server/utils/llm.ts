import OpenAI from 'openai'
import { getEnv } from './env'

let client: OpenAI | null = null

export function getOpenAI() {
  if (client) return client
  const env = getEnv()
  client = new OpenAI({ apiKey: env.OPENAI_API_KEY })
  return client
}

export async function embed(texts: string[]) {
  const openai = getOpenAI()
  const res = await openai.embeddings.create({
    model: 'text-embedding-3-large',
    input: texts
  })
  return res.data.map((d) => d.embedding)
}



