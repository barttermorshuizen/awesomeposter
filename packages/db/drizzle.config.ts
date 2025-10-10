import type { Config } from 'drizzle-kit'
import { config as loadEnv } from 'dotenv'
import { resolve } from 'node:path'

const projectRoot = resolve(__dirname, '../..')
const appRoot = resolve(projectRoot, 'apps/web')

for (const filename of ['.env', '.env.local']) {
  loadEnv({ path: resolve(projectRoot, filename), override: true })
}

for (const filename of ['.env', '.env.local']) {
  loadEnv({ path: resolve(appRoot, filename), override: true })
}

export default {
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || ''
  }
} satisfies Config
