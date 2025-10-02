import {
  updateDiscoveryKeyword,
  InvalidDiscoveryKeywordError,
  DuplicateDiscoveryKeywordError,
  DiscoveryKeywordNotFoundError,
  listDiscoveryKeywords,
} from '../../../../utils/discovery-repository'
import { emitDiscoveryEvent } from '../../../../utils/discovery-events'
import { FeatureFlagDisabledError } from '../../../../utils/client-config/feature-flags'

export default defineEventHandler(async (event) => {
  const clientId = getRouterParam(event, 'id')
  const keywordId = getRouterParam(event, 'keywordId')
  if (!clientId || !keywordId) {
    throw createError({ statusCode: 400, statusMessage: 'clientId and keywordId are required' })
  }

  const payload = await readBody(event)
  const keyword = typeof payload?.keyword === 'string' ? payload.keyword : ''

  try {
    const record = await updateDiscoveryKeyword({ clientId, keywordId, keyword })
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

    return {
      ok: true,
      keyword: {
        ...record,
        addedBy: record.addedBy ?? null,
        createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : record.createdAt,
        updatedAt: record.updatedAt instanceof Date ? record.updatedAt.toISOString() : record.updatedAt,
      },
    }
  } catch (error) {
    if (error instanceof FeatureFlagDisabledError) {
      throw createError({ statusCode: 403, statusMessage: error.message, data: { code: 'feature_disabled' } })
    }
    if (error instanceof InvalidDiscoveryKeywordError) {
      throw createError({ statusCode: 400, statusMessage: error.message })
    }
    if (error instanceof DuplicateDiscoveryKeywordError) {
      throw createError({ statusCode: 409, statusMessage: error.message })
    }
    if (error instanceof DiscoveryKeywordNotFoundError) {
      throw createError({ statusCode: 404, statusMessage: error.message })
    }
    throw error
  }
})
