import { getDb, briefs, eq } from '@awesomeposter/db'
import { createBriefSchema } from '@awesomeposter/shared'

export default defineEventHandler(async (event) => {
	const id = getRouterParam(event, 'id')
	if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
	const body = await readBody(event)
	const parsed = createBriefSchema.partial().safeParse(body)
	if (!parsed.success) throw createError({ statusCode: 400, statusMessage: parsed.error.message })
	const db = getDb()

	// Build update payload only with provided fields
	const updateData: Record<string, unknown> = {}
	if (parsed.data.title !== undefined) updateData.title = parsed.data.title
	if (parsed.data.description !== undefined) updateData.description = parsed.data.description
	if (parsed.data.clientId !== undefined) updateData.clientId = parsed.data.clientId
	if (parsed.data.objective !== undefined) updateData.objective = parsed.data.objective
	if (parsed.data.audienceId !== undefined) updateData.audienceId = parsed.data.audienceId
	if (parsed.data.deadlineAt !== undefined) {
		updateData.deadlineAt = parsed.data.deadlineAt ? new Date(parsed.data.deadlineAt) : null
	}
	if (parsed.data.status !== undefined) updateData.status = parsed.data.status

	// Debug log
	console.log('[briefs.update] id', id, 'updateData', updateData)

	await db.update(briefs).set(updateData).where(eq(briefs.id, id))

	// Return updated row
	const [updated] = await db.select().from(briefs).where(eq(briefs.id, id)).limit(1)
	return { ok: true, brief: updated }
})

