import { defineEventHandler, readBody } from 'h3'
import { FeatureFlagDisabledError, requireDiscoveryFeatureEnabled } from '../utils/client-config/feature-flags'
import { scoreDiscoveryVariants } from '../utils/discovery-scoring'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event) as {
      clientId: string
      briefId: string
      variants: Array<{
        id: string
        content: string
        platform: string
      }>
    }
    
    const { clientId, briefId, variants } = body
    
    if (!clientId || !briefId || !variants || variants.length === 0) {
      throw new Error('clientId, briefId and variants are required')
    }

    await requireDiscoveryFeatureEnabled(clientId)
    
    const rankedVariants = await scoreDiscoveryVariants(clientId, variants)
    
    return {
      success: true,
      rankedVariants
    }
  } catch (error) {
    if (error instanceof FeatureFlagDisabledError) {
      event.node.res.statusCode = 403
      return {
        success: false,
        error: error.message,
        code: 'feature_disabled'
      }
    }
    console.error('Error ranking variants:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
})
