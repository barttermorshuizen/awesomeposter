import {
  updateDiscoverySourceWebListConfig,
  InvalidDiscoverySourceError,
  DiscoverySourceNotFoundError,
} from '../../../../utils/discovery-repository'
import { FeatureFlagDisabledError } from '../../../../utils/client-config/feature-flags'

export default defineEventHandler(async (event) => {
  const clientId = getRouterParam(event, 'id')
  const sourceId = getRouterParam(event, 'sourceId')
  if (!clientId || !sourceId) {
    throw createError({ statusCode: 400, statusMessage: 'clientId and sourceId are required' })
  }

  const body = await readBody<{
    webList?: Record<string, unknown> | null
    suggestionId?: string | null
  }>(event)

  const webList = typeof body?.webList === 'object' || body?.webList === null
    ? body?.webList ?? null
    : undefined

  if (webList === undefined) {
    throw createError({ statusCode: 400, statusMessage: 'webList payload must be an object or null' })
  }

  const suggestionId = typeof body?.suggestionId === 'string' && body.suggestionId.trim().length
    ? body.suggestionId.trim()
    : undefined

  try {
    const result = await updateDiscoverySourceWebListConfig({
      clientId,
      sourceId,
      webList,
      suggestionId,
    })

    return {
      ok: true,
      source: result.record,
      warnings: result.warnings,
      suggestionAcknowledged: result.suggestionAcknowledged,
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
    throw error
  }
})
