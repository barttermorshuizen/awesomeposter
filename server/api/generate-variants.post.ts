export default defineEventHandler(async (event) => {
	const body = await readBody(event)
	if (!body?.briefId) throw createError({ statusCode: 400, statusMessage: 'briefId required' })
	return { ok: true, variants: [] }
})

