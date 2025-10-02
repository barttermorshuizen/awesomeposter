import { deleteDiscoverySource } from '../../../../utils/discovery-repository'

export default defineEventHandler(async (event) => {
  const clientId = getRouterParam(event, 'id')
  const sourceId = getRouterParam(event, 'sourceId')
  if (!clientId || !sourceId) {
    throw createError({ statusCode: 400, statusMessage: 'clientId and sourceId are required' })
  }

  const deletedId = await deleteDiscoverySource({ clientId, sourceId })
  if (!deletedId) {
    throw createError({ statusCode: 404, statusMessage: 'Source not found' })
  }

  return { ok: true }
})
