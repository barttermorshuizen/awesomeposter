import { getDb, tasks } from '@awesomeposter/db'

export default defineEventHandler(async () => {
	const db = getDb()
	const rows = await db.select().from(tasks).limit(50)
	return { ok: true, items: rows }
})

