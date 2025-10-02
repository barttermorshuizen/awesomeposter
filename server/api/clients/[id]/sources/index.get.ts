import { listDiscoverySources } from '../../../../utils/discovery-repository'

export default defineEventHandler(async (event) => {
  const clientId = getRouterParam(event, 'id')
  if (!clientId) {
    throw createError({ statusCode: 400, statusMessage: 'clientId is required' })
  }

  const items = await listDiscoverySources(clientId)
  return {
    ok: true,
    items: items.map((item) => ({
      ...item,
      notes: item.notes ?? null,
    })),
  }
})
