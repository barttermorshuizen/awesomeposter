import { defineNitroConfig } from 'nitropack/config'
import { config as loadEnv } from 'dotenv'
import { resolve } from 'node:path'

const projectRoot = process.cwd()
loadEnv({ path: resolve(projectRoot, '.env'), override: false })
loadEnv({ path: resolve(projectRoot, '.env.local'), override: true })

export default defineNitroConfig({
  srcDir: 'server',
  scanDirs: ['server'],
  compatibilityDate: '2025-10-04',
  experimental: {
    tasks: true,
  },
  tasks: {
    'discovery-ingestion': {
      handler: '~/jobs/discovery/ingest-sources',
      description: 'Fetch discovery sources on cadence',
    },
    'discovery-mark-stale': {
      handler: '~/jobs/discovery/mark-stale-sources',
      description: 'Mark stale discovery sources warning/error states',
    },
  },
  scheduledTasks: {
    '*/5 * * * *': 'discovery-ingestion',
    '0 * * * *': 'discovery-mark-stale',
  },
  runtimeConfig: {
    DATABASE_URL: process.env.DATABASE_URL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    MAILGUN_SIGNING_KEY: process.env.MAILGUN_SIGNING_KEY,
    R2_ENDPOINT: process.env.R2_ENDPOINT,
    R2_ACCESS_KEY: process.env.R2_ACCESS_KEY,
    R2_SECRET_KEY: process.env.R2_SECRET_KEY,
    R2_BUCKET_RAW: process.env.R2_BUCKET_RAW,
    R2_BUCKET_ASSETS: process.env.R2_BUCKET_ASSETS,
    QUEUE_URL: process.env.QUEUE_URL,
    APP_BASE_URL: process.env.APP_BASE_URL
    // public: {} // add if you need public runtime config
  },
  externals: {
    inline: ['@awesomeposter/db', '@awesomeposter/shared']
  }
})
