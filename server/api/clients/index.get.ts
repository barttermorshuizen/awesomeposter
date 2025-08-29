import { clients, getDb } from '@awesomeposter/db'

export default defineEventHandler(async () => {
  try {
    const db = getDb()
    const rows = await db.select().from(clients).limit(100)
    return { ok: true, items: rows }
  } catch (err: unknown) {
    // Graceful fallback when DB is not configured in dev
    if (err instanceof Error && err.message.includes('DATABASE_URL is not set')) {
      return { ok: true, items: [] }
    }
    throw err
  }
})


