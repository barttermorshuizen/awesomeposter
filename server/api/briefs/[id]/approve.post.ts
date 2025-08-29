import { getDb, briefs, eq } from '@awesomeposter/db'

export default defineEventHandler(async (event) => {
	const id = getRouterParam(event, 'id')
	if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
	const db = getDb()
	await db.update(briefs).set({ status: 'approved' }).where(eq(briefs.id, id))
	return { ok: true }
})

