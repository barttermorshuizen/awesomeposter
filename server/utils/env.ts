import { z } from 'zod'
import { useRuntimeConfig } from 'nitropack/runtime'

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  MAILGUN_SIGNING_KEY: z.string().min(1).optional(),
  // Make R2 optional in dev; upload route will validate presence
  R2_ENDPOINT: z.string().min(1).optional(),
  R2_ACCESS_KEY: z.string().min(1).optional(),
  R2_SECRET_KEY: z.string().min(1).optional(),
  R2_BUCKET_RAW: z.string().min(1).optional(),
  R2_BUCKET_ASSETS: z.string().min(1).optional(),
  QUEUE_URL: z.string().optional(),
  APP_BASE_URL: z.string().url().optional()
})

export type Env = z.infer<typeof EnvSchema>

export function getEnv(): Env {
  const runtimeConfig = useRuntimeConfig()
  const parsed = EnvSchema.safeParse(runtimeConfig)
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`)
  }
  return parsed.data
}


