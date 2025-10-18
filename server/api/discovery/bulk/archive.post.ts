import { createError, defineEventHandler, readBody } from 'h3'
import { discoveryBulkActionRequestSchema } from '@awesomeposter/shared'
import { executeDiscoveryBulkAction } from '../../../../utils/discovery-bulk-actions'

export default defineEventHandler(async (event) => {
  let payload: unknown
  try {
    payload = await readBody(event)
  } catch {
    payload = {}
  }

  const parsed = discoveryBulkActionRequestSchema.safeParse(payload)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid bulk archive payload',
      data: { issues: parsed.error.issues },
    })
  }

  return executeDiscoveryBulkAction('archive', parsed.data)
})
