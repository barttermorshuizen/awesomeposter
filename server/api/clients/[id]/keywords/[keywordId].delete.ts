import { deleteDiscoveryKeyword, listDiscoveryKeywords } from '../../../../utils/discovery-repository'
import { emitDiscoveryEvent } from '../../../../utils/discovery-events'
import { FeatureFlagDisabledError } from '../../../../utils/client-config/feature-flags'

export default defineEventHandler(async (event) => {
  const clientId = getRouterParam(event, 'id')
  const keywordId = getRouterParam(event, 'keywordId')
  if (!clientId || !keywordId) {
    throw createError({ statusCode: 400, statusMessage: 'clientId and keywordId are required' })
  }

  try {
    const deletedId = await deleteDiscoveryKeyword({ clientId, keywordId })
    if (!deletedId) {
      throw createError({ statusCode: 404, statusMessage: 'Keyword not found' })
    }

    const items = await listDiscoveryKeywords(clientId)

    emitDiscoveryEvent({
      type: 'keyword.updated',
      version: 1,
      payload: {
        clientId,
        keywords: items.map((item) => item.keyword),
        updatedAt: new Date().toISOString(),
      },
    })

    return { ok: true }
  } catch (error) {
    if (error instanceof FeatureFlagDisabledError) {
      throw createError({ statusCode: 403, statusMessage: error.message, data: { code: 'feature_disabled' } })
    }
    throw error
  }
})
