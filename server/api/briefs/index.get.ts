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
		// Improve observability and provide graceful dev fallback
		try { console.error('[api/briefs] list error:', err) } catch {}
		const msg = err instanceof Error ? err.message : String(err)
		// Common local dev cases: no DB configured, or DB unreachable
		if (
			msg.includes('DATABASE_URL is not set') ||
			/ECONNREFUSED|ENOTFOUND|timeout|no pg_hba/i.test(msg)
		) {
			return { ok: true, items: [] }
		}
		// In non-production, prefer empty list to unblock UI
		if (process.env.NODE_ENV !== 'production') {
			return { ok: true, items: [] }
		}
		throw err
	}
})
