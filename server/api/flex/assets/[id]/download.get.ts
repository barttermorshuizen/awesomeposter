import { getDb, flexAssets, eq } from '@awesomeposter/db'
import { getSignedDownloadUrl } from '../../../../utils/storage'

export default defineEventHandler(async (event) => {
  const assetId = getRouterParam(event, 'id')
  if (!assetId) {
    throw createError({ statusCode: 400, statusMessage: 'Asset ID required' })
  }

  const db = getDb()
  const [record] = await db.select().from(flexAssets).where(eq(flexAssets.id, assetId)).limit(1)

  if (!record) {
    throw createError({ statusCode: 404, statusMessage: 'Flex asset not found' })
  }

  if (!record.filename) {
    throw createError({ statusCode: 404, statusMessage: 'Flex asset file not available' })
  }

  try {
    const signedUrl = await getSignedDownloadUrl(record.filename, 300)
    return sendRedirect(event, signedUrl)
  } catch (error) {
    console.error('Failed to generate download URL for flex asset', assetId, error)
    throw createError({ statusCode: 500, statusMessage: 'Failed to generate flex asset download URL' })
  }
})
