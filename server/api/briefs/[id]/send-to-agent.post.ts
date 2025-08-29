export default defineEventHandler(async (event) => {
	const id = getRouterParam(event, 'id')
	if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
	// TODO: Enqueue agentic workflow job
	return { ok: true }
})

