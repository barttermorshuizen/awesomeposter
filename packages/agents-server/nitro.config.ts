import { defineNitroConfig } from 'nitropack/config'

const RESOLVED_DEFAULT_MODEL = (process.env.OPENAI_DEFAULT_MODEL || process.env.OPENAI_MODEL || 'gpt-4o').trim()

export default defineNitroConfig({
  compatibilityDate: '2025-09-02',
  srcDir: '.',
  imports: {
    dirs: ['server/middleware']
  },
  future: { nativeSWR: true },
  runtimeConfig: {
    DATABASE_URL: process.env.DATABASE_URL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_DEFAULT_MODEL: RESOLVED_DEFAULT_MODEL,
    // Legacy alias maintained for downstream compatibility
    OPENAI_MODEL: RESOLVED_DEFAULT_MODEL
  }
})
