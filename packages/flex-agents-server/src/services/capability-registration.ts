import type { CapabilityRegistration } from '@awesomeposter/shared'
import { getLogger } from './logger'

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export function scheduleCapabilitySelfRegistration(payload: CapabilityRegistration) {
  if (process.env.NODE_ENV === 'test' || process.env.FLEX_DISABLE_CAPABILITY_SELF_REGISTER === 'true') {
    return
  }

  const logger = getLogger()

  const baseUrl =
    process.env.FLEX_CAPABILITY_REGISTER_URL ||
    (() => {
      const port = process.env.FLEX_SERVER_PORT || process.env.PORT || '3003'
      const host = process.env.FLEX_SERVER_HOST || '127.0.0.1'
      return `http://${host}:${port}/api/v1/flex/capabilities/register`
    })()

  const configuredMaxAttempts = Number(process.env.FLEX_CAPABILITY_SELF_REGISTER_RETRIES)
  const maxAttempts =
    Number.isFinite(configuredMaxAttempts) && configuredMaxAttempts > 0
      ? Math.floor(configuredMaxAttempts)
      : 5
  const retryDelayMs =
    Number.isFinite(Number(process.env.FLEX_CAPABILITY_SELF_REGISTER_RETRY_DELAY_MS))
      ? Math.max(100, Number(process.env.FLEX_CAPABILITY_SELF_REGISTER_RETRY_DELAY_MS))
      : 1000
  const refreshIntervalMs =
    Number.isFinite(Number(process.env.FLEX_CAPABILITY_SELF_REGISTER_REFRESH_MS))
      ? Math.max(0, Number(process.env.FLEX_CAPABILITY_SELF_REGISTER_REFRESH_MS))
      : 5 * 60 * 1000
  const initialDelayMs =
    Number.isFinite(Number(process.env.FLEX_CAPABILITY_SELF_REGISTER_INITIAL_DELAY_MS))
      ? Math.max(0, Number(process.env.FLEX_CAPABILITY_SELF_REGISTER_INITIAL_DELAY_MS))
      : 1500

  const attemptRegistration = async (attempt: number) => {
    try {
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify(payload)
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`Endpoint responded with ${res.status} ${res.statusText} ${text}`)
      }

      logger.info('flex_capability_self_registered', {
        capabilityId: payload.capabilityId,
        version: payload.version,
        attempt
      })

      if (refreshIntervalMs > 0) {
        setTimeout(() => {
          void attemptRegistration(1)
        }, refreshIntervalMs)
      }
    } catch (error) {
      logger.warn('flex_capability_self_register_failed', {
        capabilityId: payload.capabilityId,
        attempt,
        error: toErrorMessage(error)
      })
      if (attempt < maxAttempts) {
        setTimeout(() => void attemptRegistration(attempt + 1), retryDelayMs)
      } else {
        logger.error('flex_capability_self_register_exhausted', {
          capabilityId: payload.capabilityId,
          attempts: attempt,
          error: toErrorMessage(error)
        })
      }
    }
  }

  setTimeout(() => {
    void attemptRegistration(1)
  }, initialDelayMs)
}
