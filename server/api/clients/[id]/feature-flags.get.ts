import { isFeatureEnabled, FEATURE_DISCOVERY_AGENT } from '../../../utils/client-config/feature-flags'

export default defineEventHandler(async (event) => {
  const clientId = getRouterParam(event, 'id')
  if (!clientId) {
    throw createError({ statusCode: 400, statusMessage: 'clientId is required' })
  }

  try {
    const enabled = await isFeatureEnabled(clientId, FEATURE_DISCOVERY_AGENT)
    return {
      ok: true,
      flags: {
        discoveryAgent: enabled,
      },
    }
  } catch (error) {
    throw createError({ statusCode: 500, statusMessage: 'Failed to load feature flags', data: { error: String(error) } })
  }
})
