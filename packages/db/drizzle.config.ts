import type { Config } from 'drizzle-kit'
import { config as loadEnv } from 'dotenv'
import { resolve } from 'node:path'

// Try root .env then apps/web/.env (Nuxt app envs)
loadEnv({ path: resolve(__dirname, '../../.env') })
loadEnv({ path: resolve(__dirname, '../../apps/web/.env') })

export default {
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || ''
  }
} satisfies Config

