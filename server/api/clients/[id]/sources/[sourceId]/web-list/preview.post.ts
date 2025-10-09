import {
  previewDiscoverySourceWebList,
  InvalidDiscoverySourceError,
  DiscoverySourceNotFoundError,
  DiscoverySourcePreviewError,
} from '../../../../../../utils/discovery-repository'
import { FeatureFlagDisabledError } from '../../../../../../utils/client-config/feature-flags'

export default defineEventHandler(async (event) => {
  const clientId = getRouterParam(event, 'id')
  const sourceId = getRouterParam(event, 'sourceId')
  if (!clientId || !sourceId) {
    throw createError({ statusCode: 400, statusMessage: 'clientId and sourceId are required' })
  }

  const body = await readBody<{ webList?: Record<string, unknown> | null }>(event)
  if (!body?.webList || typeof body.webList !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'webList payload is required for preview' })
  }

  try {
    const result = await previewDiscoverySourceWebList({
      clientId,
      sourceId,
      webList: body.webList,
    })
    return {
      ok: true,
      result,
    }
  } catch (error) {
    if (error instanceof FeatureFlagDisabledError) {
      throw createError({ statusCode: 403, statusMessage: error.message, data: { code: 'feature_disabled' } })
    }
    if (error instanceof DiscoverySourceNotFoundError) {
      throw createError({ statusCode: 404, statusMessage: error.message })
    }
    if (error instanceof InvalidDiscoverySourceError) {
      throw createError({ statusCode: 400, statusMessage: error.message })
    }
    if (error instanceof DiscoverySourcePreviewError) {
      throw createError({ statusCode: 502, statusMessage: error.message })
    }
    throw error
  }
})
