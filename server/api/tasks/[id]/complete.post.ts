import { getDb, tasks, eq } from '@awesomeposter/db'

export default defineEventHandler(async (event) => {
	const id = getRouterParam(event, 'id')
	if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
	const db = getDb()
	await db.update(tasks).set({ status: 'completed' }).where(eq(tasks.id, id))
	return { ok: true }
})

