import { defineNitroConfig } from 'nitropack/config'
import { config as loadEnv } from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(currentDir, '..', '..')

for (const dir of [repoRoot, currentDir]) {
  loadEnv({ path: resolve(dir, '.env'), override: false })
  loadEnv({ path: resolve(dir, '.env.local'), override: true })
}

const rawDefaultModel =
  process.env.FLEX_OPENAI_DEFAULT_MODEL || process.env.OPENAI_DEFAULT_MODEL || process.env.OPENAI_MODEL || 'gpt-4o'
const RESOLVED_DEFAULT_MODEL = rawDefaultModel.trim()
const DATABASE_URL = process.env.FLEX_DATABASE_URL || process.env.DATABASE_URL
const OPENAI_API_KEY = process.env.FLEX_OPENAI_API_KEY || process.env.OPENAI_API_KEY

export default defineNitroConfig({
  compatibilityDate: '2025-09-02',
  srcDir: '.',
  plugins: ['./server/plugins/agents.ts', './server/plugins/capability-registration.ts'],
  imports: {
    dirs: ['server/middleware']
  },
  future: { nativeSWR: true },
  runtimeConfig: {
    DATABASE_URL,
    OPENAI_API_KEY,
    OPENAI_DEFAULT_MODEL: RESOLVED_DEFAULT_MODEL,
    // Legacy alias maintained for downstream compatibility
    OPENAI_MODEL: RESOLVED_DEFAULT_MODEL
  }
})
