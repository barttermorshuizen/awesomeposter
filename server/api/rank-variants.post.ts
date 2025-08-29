import { defineEventHandler, readBody } from 'h3'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event) as {
      briefId: string
      variants: Array<{
        id: string
        content: string
        platform: string
      }>
    }
    
    const { briefId, variants } = body
    
    if (!briefId || !variants || variants.length === 0) {
      throw new Error('Brief ID and variants are required')
    }
    
    // Simple ranking based on content length for now
    const rankedVariants = variants
      .map(variant => ({
        ...variant,
        score: variant.content.length > 100 ? 0.8 : 0.6
      }))
      .sort((a, b) => (b.score || 0) - (a.score || 0))
    
    return {
      success: true,
      rankedVariants
    }
  } catch (error) {
    console.error('Error ranking variants:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
})

