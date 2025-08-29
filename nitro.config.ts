import { defineNitroConfig } from 'nitropack/config'

export default defineNitroConfig({
  srcDir: 'server',
  scanDirs: ['server'],
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