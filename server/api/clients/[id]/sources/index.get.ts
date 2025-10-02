import { listDiscoverySources } from '../../../../utils/discovery-repository'
import { FeatureFlagDisabledError } from '../../../../utils/client-config/feature-flags'

export default defineEventHandler(async (event) => {
  const clientId = getRouterParam(event, 'id')
  if (!clientId) {
    throw createError({ statusCode: 400, statusMessage: 'clientId is required' })
  }

  try {
    const items = await listDiscoverySources(clientId)
    return {
      ok: true,
      items: items.map((item) => ({
        ...item,
        notes: item.notes ?? null,
      })),
    }
  } catch (error) {
    if (error instanceof FeatureFlagDisabledError) {
      throw createError({ statusCode: 403, statusMessage: error.message, data: { code: 'feature_disabled' } })
    }
    throw error
  }
})
