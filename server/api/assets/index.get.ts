import { assets, getDb, eq } from '@awesomeposter/db'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const clientId = query.clientId as string
  
  const db = getDb()
  
  let rows
  if (clientId) {
    // Filter assets by clientId AND ensure briefId is null (client brand assets only)
    // Since isNull is not available, we'll use a different approach
    rows = await db.select().from(assets).where(
      eq(assets.clientId, clientId)
    ).then(assets => assets.filter(asset => asset.briefId === null))
  } else {
    // Return all assets (limited to 100)
    rows = await db.select().from(assets).limit(100)
  }
  
  return { ok: true, assets: rows }
})


