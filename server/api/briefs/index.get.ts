import { getDb, briefs, clients, eq } from '@awesomeposter/db'

export default defineEventHandler(async () => {
	try {
		const db = getDb()
		
		// Join briefs with clients to get client names
		const rows = await db
			.select({
				id: briefs.id,
				title: briefs.title,
				clientId: briefs.clientId,
				clientName: clients.name,
				objective: briefs.objective,
				status: briefs.status,
				audienceId: briefs.audienceId,
				deadlineAt: briefs.deadlineAt,
				createdAt: briefs.createdAt,
				updatedAt: briefs.updatedAt
			})
			.from(briefs)
			.leftJoin(clients, eq(briefs.clientId, clients.id))
			.limit(100)
		
		return { ok: true, items: rows }
	} catch (err: unknown) {
		// Graceful fallback when DB is not configured in dev
		if (err instanceof Error && err.message.includes('DATABASE_URL is not set')) {
			return { ok: true, items: [] }
		}
		throw err
	}
})
