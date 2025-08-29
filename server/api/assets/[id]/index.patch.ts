import { getDb, assets, eq } from '@awesomeposter/db'

export default defineEventHandler(async (event) => {
  const assetId = getRouterParam(event, 'id')
  if (!assetId) throw createError({ statusCode: 400, statusMessage: 'Asset ID required' })
  
  const body = await readBody(event)
  const { briefId } = body
  
  const db = getDb()
  
  // Update the asset's briefId
  await db.update(assets).set({
    briefId: briefId || null
  }).where(eq(assets.id, assetId))
  
  return { ok: true, message: 'Asset updated successfully' }
})
