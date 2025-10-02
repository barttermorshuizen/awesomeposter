import {
  createDiscoveryKeyword,
  InvalidDiscoveryKeywordError,
  DuplicateDiscoveryKeywordError,
  KeywordLimitExceededError,
  listDiscoveryKeywords,
} from '../../../../utils/discovery-repository'
import { emitDiscoveryEvent } from '../../../../utils/discovery-events'

export default defineEventHandler(async (event) => {
  const clientId = getRouterParam(event, 'id')
  if (!clientId) {
    throw createError({ statusCode: 400, statusMessage: 'clientId is required' })
  }

  const payload = await readBody(event)
  const keyword = typeof payload?.keyword === 'string' ? payload.keyword : ''
  const addedBy = typeof payload?.addedBy === 'string' ? payload.addedBy : undefined

  try {
    const record = await createDiscoveryKeyword({ clientId, keyword, addedBy })
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
    if (error instanceof InvalidDiscoveryKeywordError) {
      throw createError({ statusCode: 400, statusMessage: error.message })
    }
    if (error instanceof DuplicateDiscoveryKeywordError) {
      throw createError({ statusCode: 409, statusMessage: error.message })
    }
    if (error instanceof KeywordLimitExceededError) {
      throw createError({ statusCode: 422, statusMessage: error.message })
    }
    throw error
  }
})
