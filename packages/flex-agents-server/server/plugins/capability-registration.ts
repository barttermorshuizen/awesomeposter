import { STRATEGY_CAPABILITY } from '../../src/agents/strategy-manager'
import { CONTENT_CAPABILITY } from '../../src/agents/content-generator'
import { QA_CAPABILITY } from '../../src/agents/quality-assurance'
import { getLogger } from '../../src/services/logger'

const CAPABILITIES = [STRATEGY_CAPABILITY, CONTENT_CAPABILITY, QA_CAPABILITY]

export default defineNitroPlugin((nitro) => {
  const logger = getLogger()
  if (process.env.NODE_ENV !== 'production') {
    console.log('[flex-capability] plugin booting')
  }
  const configuredMaxAttempts = Number(process.env.FLEX_CAPABILITY_SELF_REGISTER_RETRIES)
  const maxAttempts =
    Number.isFinite(configuredMaxAttempts) && configuredMaxAttempts > 0 ? Math.floor(configuredMaxAttempts) : 5
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

  const registerCapability = async (payload: typeof CAPABILITIES[number], startingAttempt = 1): Promise<boolean> => {
    let attempt = startingAttempt
    while (attempt < startingAttempt + maxAttempts) {
      try {
        const res = await nitro.localFetch('/api/v1/flex/capabilities/register', {
          method: 'POST',
          body: JSON.stringify(payload),
          headers: {
            'content-type': 'application/json'
          }
        })

        if (!res.ok) {
          const text = typeof res.text === 'function' ? await res.text() : ''
          throw new Error(`Endpoint responded with ${res.status} ${res.statusText} ${text}`)
        }

        logger.info('flex_capability_self_registered', {
          capabilityId: payload.capabilityId,
          version: payload.version,
          attempt
        })
        return true
      } catch (error) {
        logger.warn('flex_capability_self_register_failed', {
          capabilityId: payload.capabilityId,
          attempt,
          error: error instanceof Error ? error.message : String(error)
        })
        attempt += 1
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
      }
    }

    logger.error('flex_capability_self_register_exhausted', {
      capabilityId: payload.capabilityId,
      attempts: attempt - 1
    })
    return false
  }

  const registerAll = async (startingAttempt = 1) => {
    for (const capability of CAPABILITIES) {
      let attempt = startingAttempt
      while (!(await registerCapability(capability, attempt))) {
        attempt += maxAttempts
      }
    }
  }

  const scheduleRefresh = () => {
    if (refreshIntervalMs <= 0) return
    setTimeout(() => {
      registerAll().catch((error) => {
        logger.error('flex_capability_register_refresh_failed', {
          error: error instanceof Error ? error.message : String(error)
        })
      })
      scheduleRefresh()
    }, refreshIntervalMs)
  }

  let registrationLoopStarted = false
  const startRegistrationLoop = () => {
    if (registrationLoopStarted) return
    registrationLoopStarted = true
    registerAll().catch((error) => {
      logger.error('flex_capability_register_startup_failed', {
        error: error instanceof Error ? error.message : String(error)
      })
    })
    scheduleRefresh()
  }

  nitro.hooks.hook('listen', () => {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[flex-capability] listen hook firing')
    }
    setTimeout(startRegistrationLoop, initialDelayMs)
  })

  // Dev fallback: if listen hook never fires (e.g., emfile), run anyway
  // Fallback timer for environments where Nitro never emits `listen`
  const fallbackDelay = Math.max(initialDelayMs * 2, initialDelayMs + 1000)
  setTimeout(startRegistrationLoop, fallbackDelay)
})
