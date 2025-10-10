import { randomUUID } from 'node:crypto'
import { createError, defineEventHandler, readBody } from 'h3'
import { z } from 'zod'
import {
  DiscoveryItemAlreadyPromotedError,
  DiscoveryItemNotFoundError,
  promoteDiscoveryItem,
} from '../../../../utils/discovery-repository'
import { discoveryPromoteItemInputSchema } from '@awesomeposter/shared'

const paramsSchema = z.object({
  id: z.string().uuid(),
})

export default defineEventHandler(async (event) => {
  const { id } = paramsSchema.parse(event.context.params ?? {})

  let payload: unknown
  try {
    payload = await readBody(event)
  } catch {
    payload = {}
  }

  if (typeof payload === 'string') {
    payload = { note: payload }
  }

  const parsedPayload = discoveryPromoteItemInputSchema.safeParse(payload ?? {})
  if (!parsedPayload.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid promotion payload',
      data: { issues: parsedPayload.error.issues },
    })
  }

  const { note } = parsedPayload.data

  const actorId = randomUUID()
  const actorName = 'Dashboard Reviewer'

  try {
    const detail = await promoteDiscoveryItem({
      itemId: id,
      note,
      actorId,
      actorName,
    })
    return detail
  } catch (error) {
    if (error instanceof DiscoveryItemNotFoundError) {
      throw createError({ statusCode: 404, statusMessage: error.message })
    }
    if (error instanceof DiscoveryItemAlreadyPromotedError) {
      throw createError({ statusCode: 409, statusMessage: error.message })
    }
    throw error
  }
})
