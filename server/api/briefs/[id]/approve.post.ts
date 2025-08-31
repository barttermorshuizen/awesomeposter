import { getDb, briefs, eq } from '@awesomeposter/db'
import { defineEventHandler, getRouterParam, createError } from 'h3'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })

  try {
    const db = getDb()

    // Fetch current brief to verify status
    const [row] = await db.select().from(briefs).where(eq(briefs.id, id)).limit(1)
    if (!row) {
      throw createError({ statusCode: 404, statusMessage: 'Not found' })
    }

    const status = (row as { status?: 'draft' | 'approved' | 'sent' | 'published' | null }).status ?? null
    if (status !== 'draft') {
      throw createError({ statusCode: 400, statusMessage: 'Only Draft briefs can be approved' })
    }

    await db.update(briefs).set({ status: 'approved' }).where(eq(briefs.id, id))
    return { ok: true }
  } catch (err: unknown) {
    // Graceful behavior for local dev without DB configured
    if (err instanceof Error && err.message.includes('DATABASE_URL is not set')) {
      return { ok: true }
    }
    throw err
  }
})

