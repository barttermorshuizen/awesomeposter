import { listDiscoveryKeywords } from '../../../../utils/discovery-repository'

export default defineEventHandler(async (event) => {
  const clientId = getRouterParam(event, 'id')
  if (!clientId) {
    throw createError({ statusCode: 400, statusMessage: 'clientId is required' })
  }

  const items = await listDiscoveryKeywords(clientId)
  return {
    ok: true,
    items: items.map((item) => ({
      ...item,
      addedBy: item.addedBy ?? null,
      createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt,
      updatedAt: item.updatedAt instanceof Date ? item.updatedAt.toISOString() : item.updatedAt,
    })),
  }
})
