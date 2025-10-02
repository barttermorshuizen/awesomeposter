import { deleteDiscoverySource } from '../../../../utils/discovery-repository'
import { FeatureFlagDisabledError } from '../../../../utils/client-config/feature-flags'

export default defineEventHandler(async (event) => {
  const clientId = getRouterParam(event, 'id')
  const sourceId = getRouterParam(event, 'sourceId')
  if (!clientId || !sourceId) {
    throw createError({ statusCode: 400, statusMessage: 'clientId and sourceId are required' })
  }

  try {
    const deletedId = await deleteDiscoverySource({ clientId, sourceId })
    if (!deletedId) {
      throw createError({ statusCode: 404, statusMessage: 'Source not found' })
    }

    return { ok: true }
  } catch (error) {
    if (error instanceof FeatureFlagDisabledError) {
      throw createError({ statusCode: 403, statusMessage: error.message, data: { code: 'feature_disabled' } })
    }
    throw error
  }
})
