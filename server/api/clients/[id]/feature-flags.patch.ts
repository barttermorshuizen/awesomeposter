import {
  FEATURE_DISCOVERY_AGENT,
} from '../../../utils/client-config/feature-flags'
import {
  setDiscoveryFlag,
  FeatureFlagAdminError,
  ClientNotFoundError,
} from '../../../utils/client-config/feature-flag-admin'

export default defineEventHandler(async (event) => {
  const clientId = getRouterParam(event, 'id')
  if (!clientId) {
    throw createError({ statusCode: 400, statusMessage: 'clientId is required in path' })
  }

  const body = await readBody<{
    feature?: string
    enabled?: unknown
    actor?: unknown
    reason?: unknown
  }>(event).catch(() => ({}))

  const feature = typeof body.feature === 'string' ? body.feature : ''
  if (feature !== FEATURE_DISCOVERY_AGENT) {
    throw createError({ statusCode: 400, statusMessage: 'Unsupported feature flag' })
  }

  if (typeof body.enabled !== 'boolean') {
    throw createError({ statusCode: 400, statusMessage: 'enabled must be provided as a boolean' })
  }

  const actorRaw = typeof body.actor === 'string' ? body.actor.trim() : ''
  if (!actorRaw) {
    throw createError({ statusCode: 400, statusMessage: 'actor is required' })
  }

  const reason = typeof body.reason === 'string' ? body.reason : undefined

  try {
    const result = await setDiscoveryFlag({
      clientId,
      enable: body.enabled,
      actor: actorRaw,
      reason: reason ?? null,
    })

    return {
      ok: true,
      changed: result.changed,
      client: result.client,
      flag: {
        feature: FEATURE_DISCOVERY_AGENT,
        enabled: result.newEnabled,
        previousEnabled: result.previousEnabled,
        occurredAt: result.occurredAt.toISOString(),
      },
    }
  } catch (error) {
    if (error instanceof ClientNotFoundError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    }
    if (error instanceof FeatureFlagAdminError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    }
    throw createError({ statusCode: 500, statusMessage: 'Failed to toggle feature flag', data: { error: String(error) } })
  }
})
