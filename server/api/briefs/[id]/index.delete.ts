import { getDb, briefs, assets, eq } from '@awesomeposter/db'
import { deleteBriefAssets } from '../../../utils/storage'

export default defineEventHandler(async (event) => {
  const briefId = getRouterParam(event, 'id')
  if (!briefId) throw createError({ statusCode: 400, statusMessage: 'Brief ID required' })
  
  const db = getDb()
  
  // Check if brief exists
  const [brief] = await db.select().from(briefs).where(eq(briefs.id, briefId)).limit(1)
  if (!brief) {
    throw createError({ statusCode: 404, statusMessage: 'Brief not found' })
  }
  
  // Get all assets for this brief
  const briefAssets = await db.select().from(assets).where(eq(assets.briefId, briefId))
  
  // Delete assets from database (cascading will handle this, but we want the list for R2 cleanup)
  await db.delete(assets).where(eq(assets.briefId, briefId))
  
  // Delete the brief itself (this will cascade to brief_versions and other related tables)
  await db.delete(briefs).where(eq(briefs.id, briefId))
  
  // Clean up R2 storage
  try {
    // Delete individual asset files
    for (const asset of briefAssets) {
      if (asset.filename) {
        try {
          const { deleteAssetObject } = await import('../../../utils/storage')
          await deleteAssetObject(asset.filename)
        } catch (error) {
          console.error('Failed to delete individual asset from R2:', asset.filename, error)
        }
      }
    }
    
    // Also clean up the entire brief folder (in case there are orphaned files)
    await deleteBriefAssets(briefId)
  } catch (error) {
    console.error('Failed to delete brief assets from R2:', error)
    // Don't fail the request if R2 deletion fails, as the DB records are already deleted
  }
  
  return { ok: true, message: 'Brief deleted successfully' }
})
