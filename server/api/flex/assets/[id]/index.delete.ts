import { flexAssets, getDb, eq } from '@awesomeposter/db'
import { deleteAssetObject } from '../../../../utils/storage'

export default defineEventHandler(async (event) => {
  const assetId = getRouterParam(event, 'id')
  if (!assetId) {
    throw createError({ statusCode: 400, statusMessage: 'Asset ID is required.' })
  }

  const db = getDb()
  const [existing] = await db.select().from(flexAssets).where(eq(flexAssets.id, assetId)).limit(1)
  if (!existing) {
    return { ok: true }
  }

  await db.delete(flexAssets).where(eq(flexAssets.id, assetId))

  if (existing.filename) {
    try {
      await deleteAssetObject(existing.filename)
    } catch (error) {
      console.warn('Failed to delete flex asset object', { assetId, filename: existing.filename, error })
    }
  }

  return { ok: true }
})
