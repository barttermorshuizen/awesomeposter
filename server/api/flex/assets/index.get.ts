import { flexAssets, getDb, eq, and } from '@awesomeposter/db'
import { asc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const assignmentId = typeof query.assignmentId === 'string' ? query.assignmentId.trim() : ''
  const facet = typeof query.facet === 'string' ? query.facet.trim() : ''

  if (!assignmentId) {
    throw createError({ statusCode: 400, statusMessage: 'assignmentId is required.' })
  }

  const db = getDb()

  let where = eq(flexAssets.assignmentId, assignmentId)
  if (facet) {
    where = and(where, eq(flexAssets.facet, facet))
  }

  const rows = await db
    .select()
    .from(flexAssets)
    .where(where)
    .orderBy(asc(flexAssets.ordering), asc(flexAssets.createdAt))

  return {
    ok: true,
    assets: rows.map((asset) => ({
      id: asset.id,
      assignmentId: asset.assignmentId,
      runId: asset.runId,
      nodeId: asset.nodeId,
      facet: asset.facet,
      url: asset.url,
      filename: asset.filename,
      originalName: asset.originalName,
      mimeType: asset.mimeType,
      fileSize: asset.fileSize,
      ordering: asset.ordering ?? 0,
      meta: asset.metaJson,
      uploadedBy: asset.uploadedBy,
      createdAt: asset.createdAt
    }))
  }
})
