import { defineEventHandler, readBody } from 'h3'
import { FeatureFlagDisabledError, requireDiscoveryFeatureEnabled } from '../utils/client-config/feature-flags'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event) as {
      clientId: string
      briefId: string
      platform?: string
      limit?: number
    }
    
    const { clientId, briefId, platform: _platform, limit = 5 } = body
    
    if (!clientId || !briefId) {
      throw new Error('clientId and briefId are required')
    }

    await requireDiscoveryFeatureEnabled(clientId)
    
    // Mock response for now
    const winners = [
      {
        id: 'winner-1',
        content: 'This is a winning post that performed well',
        platform: 'linkedin',
        performance: { impressions: 1000, engagement: 0.08 }
      },
      {
        id: 'winner-2',
        content: 'Another high-performing post with great insights',
        platform: 'linkedin',
        performance: { impressions: 800, engagement: 0.12 }
      }
    ].slice(0, limit)
    
    return {
      success: true,
      winners
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
    console.error('Error retrieving winners:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
})

