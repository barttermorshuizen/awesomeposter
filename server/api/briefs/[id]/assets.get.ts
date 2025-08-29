import { getDb, assets, eq } from '@awesomeposter/db'

export default defineEventHandler(async (event) => {
  const briefId = getRouterParam(event, 'id')
  if (!briefId) throw createError({ statusCode: 400, statusMessage: 'Brief ID required' })
  
  const db = getDb()
  const briefAssets = await db.select().from(assets).where(eq(assets.briefId, briefId))
  
  // Transform assets to match the new Asset type
  const transformedAssets = briefAssets.map(asset => ({
    id: asset.id,
    filename: asset.filename || '',
    originalName: asset.originalName || '',
    url: asset.url,
    type: asset.type || 'other',
    mimeType: asset.mimeType || '',
    fileSize: asset.fileSize || 0,
    metaJson: asset.metaJson || {}
  }))
  
  return { ok: true, assets: transformedAssets }
})
