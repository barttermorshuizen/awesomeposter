import process from 'node:process';globalThis._importMeta_=globalThis._importMeta_||{url:"file:///_entry.js",env:process.env};import { z } from 'zod';
import { createRequire } from 'node:module';

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
});
const runtimeRequire = createRequire(globalThis._importMeta_.url);
let cachedUseRuntimeConfig;
function resolveRuntimeConfig() {
  if (cachedUseRuntimeConfig === void 0) {
    try {
      const nitroRuntime = runtimeRequire("nitropack/runtime");
      cachedUseRuntimeConfig = typeof nitroRuntime.useRuntimeConfig === "function" ? nitroRuntime.useRuntimeConfig : null;
    } catch {
      cachedUseRuntimeConfig = null;
    }
  }
  if (!cachedUseRuntimeConfig) {
    return null;
  }
  try {
    return cachedUseRuntimeConfig();
  } catch {
    return null;
  }
}
function getEnv() {
  const runtimeConfig = resolveRuntimeConfig();
  const fallbackEnv = {
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
  };
  const merged = {
    ...fallbackEnv,
    ...runtimeConfig != null ? runtimeConfig : {}
  };
  const parsed = EnvSchema.safeParse(merged);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
  }
  return parsed.data;
}

export { getEnv as g };
//# sourceMappingURL=env.mjs.map
