import { getDb, assets, eq } from '@awesomeposter/db'
import { getSignedDownloadUrl } from '../../../utils/storage'

export default defineEventHandler(async (event) => {
  const assetId = getRouterParam(event, 'id')
  if (!assetId) throw createError({ statusCode: 400, statusMessage: 'Asset ID required' })
  
  const db = getDb()
  
  // Get asset details
  const [asset] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1)
  if (!asset) {
    throw createError({ statusCode: 404, statusMessage: 'Asset not found' })
  }
  
  if (!asset.filename) {
    throw createError({ statusCode: 404, statusMessage: 'Asset file not found' })
  }
  
  try {
    // Generate signed URL for download
    const signedUrl = await getSignedDownloadUrl(asset.filename, 300) // 5 minutes expiry
    
    // Redirect to the signed URL
    return sendRedirect(event, signedUrl)
  } catch (error) {
    console.error('Failed to generate signed URL for asset:', assetId, error)
    throw createError({ statusCode: 500, statusMessage: 'Failed to generate download URL' })
  }
})
