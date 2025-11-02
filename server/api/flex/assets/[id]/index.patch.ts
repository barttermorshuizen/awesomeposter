import { flexAssets, getDb, eq } from '@awesomeposter/db'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export default defineEventHandler(async (event) => {
  const assetId = getRouterParam(event, 'id')
  if (!assetId) {
    throw createError({ statusCode: 400, statusMessage: 'Asset ID is required.' })
  }

  const body = await readBody(event).catch(() => ({}))
  const db = getDb()
  const [existing] = await db.select().from(flexAssets).where(eq(flexAssets.id, assetId)).limit(1)
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Flex asset not found.' })
  }

  const updates: Record<string, unknown> = {}

  if (typeof body?.ordering === 'number' && Number.isFinite(body.ordering)) {
    updates.ordering = body.ordering
  }

  if (isRecord(body?.metaOverrides)) {
    const currentMeta = (existing.metaJson ?? {}) as Record<string, unknown>
    updates.metaJson = {
      ...currentMeta,
      ...body.metaOverrides
    }
  }

  if (!Object.keys(updates).length) {
    return { ok: true }
  }

  await db.update(flexAssets).set(updates).where(eq(flexAssets.id, assetId))

  return { ok: true }
})
