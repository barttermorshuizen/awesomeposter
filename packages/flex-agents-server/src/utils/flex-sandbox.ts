import { resolve } from 'pathe'
import { createError } from 'h3'

const FLAG_NAME = 'USE_FLEX_DEV_SANDBOX'
const DEFAULT_TEMPLATE_DIR = 'tmp'

export function isFlexSandboxEnabled(): boolean {
  return (process.env[FLAG_NAME] || '').toLowerCase() === 'true'
}

export function requireFlexSandboxEnabled() {
  if (!isFlexSandboxEnabled()) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }
}

export function resolveFlexTemplateDir(): string {
  const configured = process.env.FLEX_SANDBOX_TEMPLATE_DIR
  const base = configured && configured.trim().length > 0 ? configured.trim() : DEFAULT_TEMPLATE_DIR
  return resolve(process.cwd(), base)
}
