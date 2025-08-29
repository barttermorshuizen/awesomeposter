import { getDb, briefs, eq } from '@awesomeposter/db'

export default defineEventHandler(async (event) => {
	const id = getRouterParam(event, 'id')
	if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
	const db = getDb()
	const [row] = await db.select().from(briefs).where(eq(briefs.id, id)).limit(1)
	if (!row) throw createError({ statusCode: 404, statusMessage: 'Not found' })
	return { ok: true, brief: row }
})

