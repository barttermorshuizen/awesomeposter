import { resolve } from 'pathe'
import { createError } from 'h3'

const FLAG_NAME = 'USE_FLEX_DEV_SANDBOX'
const DEFAULT_TEMPLATE_DIR = 'tmp'

function isEnabled(value: string | undefined | null): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on'
}

export function isFlexSandboxEnabled(): boolean {
  if (isEnabled(process.env[FLAG_NAME])) return true
  if (isEnabled(process.env.VITE_USE_FLEX_DEV_SANDBOX)) return true
  return false
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
