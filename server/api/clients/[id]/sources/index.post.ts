import {
  createDiscoverySource,
  DuplicateDiscoverySourceError,
  InvalidDiscoverySourceError,
} from '../../../../utils/discovery-repository'
import { emitDiscoveryEvent } from '../../../../utils/discovery-events'
import { FeatureFlagDisabledError } from '../../../../utils/client-config/feature-flags'

export default defineEventHandler(async (event) => {
  const clientId = getRouterParam(event, 'id')
  if (!clientId) {
    throw createError({ statusCode: 400, statusMessage: 'clientId is required' })
  }

  const payload = await readBody(event)
  const url = typeof payload?.url === 'string' ? payload.url : ''
  const notes = typeof payload?.notes === 'string' ? payload.notes : undefined

  try {
    const record = await createDiscoverySource({
      clientId,
      url,
      notes,
    })

    emitDiscoveryEvent({
      type: 'source-created',
      version: 1,
      payload: {
        id: record.id,
        clientId: record.clientId,
        url: record.url,
        canonicalUrl: record.canonicalUrl,
        sourceType: record.sourceType,
        identifier: record.identifier,
        createdAt: record.createdAt.toISOString(),
      },
    })

    return {
      ok: true,
      source: {
        ...record,
        notes: record.notes ?? null,
      },
    }
  } catch (error) {
    if (error instanceof FeatureFlagDisabledError) {
      throw createError({ statusCode: 403, statusMessage: error.message, data: { code: 'feature_disabled' } })
    }
    if (error instanceof InvalidDiscoverySourceError) {
      throw createError({ statusCode: 400, statusMessage: error.message })
    }
    if (error instanceof DuplicateDiscoverySourceError) {
      throw createError({ statusCode: 409, statusMessage: error.message })
    }
    throw error
  }
})
