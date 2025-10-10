import { createError, defineEventHandler } from 'h3'
import { z } from 'zod'
import { getDiscoveryItemDetail } from '../../../../utils/discovery-repository'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

export default defineEventHandler(async (event) => {
  const { id } = paramsSchema.parse(event.context.params ?? {})

  const detail = await getDiscoveryItemDetail(id)
  if (!detail) {
    throw createError({ statusCode: 404, statusMessage: 'Discovery item not found' })
  }

  return detail
})
