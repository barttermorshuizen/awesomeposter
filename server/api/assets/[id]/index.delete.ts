import { getDb, assets, eq } from '@awesomeposter/db'
import { deleteAssetObject } from '../../../utils/storage'

export default defineEventHandler(async (event) => {
  const assetId = getRouterParam(event, 'id')
  if (!assetId) throw createError({ statusCode: 400, statusMessage: 'Asset ID required' })
  
  const db = getDb()
  
  // Get asset details before deletion for cleanup
  const [asset] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1)
  if (!asset) {
    throw createError({ statusCode: 404, statusMessage: 'Asset not found' })
  }
  
  // Delete from database first
  await db.delete(assets).where(eq(assets.id, assetId))
  
  // Delete from R2 storage if filename exists
  if (asset.filename) {
    try {
      await deleteAssetObject(asset.filename)
    } catch (error) {
      console.error('Failed to delete asset from R2:', error)
      // Don't fail the request if R2 deletion fails, as the DB record is already deleted
    }
  }
  
  return { ok: true, message: 'Asset deleted successfully' }
})