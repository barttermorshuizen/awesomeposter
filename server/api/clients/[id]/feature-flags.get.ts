import {
  isFeatureEnabled,
  FEATURE_DISCOVERY_AGENT,
  FEATURE_DISCOVERY_FILTERS_V1,
} from '../../../utils/client-config/feature-flags'

export default defineEventHandler(async (event) => {
  const clientId = getRouterParam(event, 'id')
  if (!clientId) {
    throw createError({ statusCode: 400, statusMessage: 'clientId is required' })
  }

  try {
    const [discoveryAgentEnabled, discoveryFiltersEnabled] = await Promise.all([
      isFeatureEnabled(clientId, FEATURE_DISCOVERY_AGENT),
      isFeatureEnabled(clientId, FEATURE_DISCOVERY_FILTERS_V1),
    ])
    return {
      ok: true,
      flags: {
        discoveryAgent: discoveryAgentEnabled,
        discoveryFiltersV1: discoveryFiltersEnabled,
      },
    }
  } catch (error) {
    throw createError({ statusCode: 500, statusMessage: 'Failed to load feature flags', data: { error: String(error) } })
  }
})
