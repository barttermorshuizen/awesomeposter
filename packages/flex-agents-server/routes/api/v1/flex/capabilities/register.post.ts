import { CapabilityRegistrationSchema } from '@awesomeposter/shared'
import { createError } from 'h3'
import { getFlexCapabilityRegistryService } from '../../../../../src/services/flex-capability-registry'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const parsed = CapabilityRegistrationSchema.safeParse(body)
  if (!parsed.success) {
    const formatted = parsed.error.flatten()
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid capability registration payload',
      data: formatted
    })
  }

  const service = getFlexCapabilityRegistryService()
  const record = await service.register(parsed.data)
  const active = await service.listActive()

  return {
    ok: true,
    record,
    registry: {
      active,
      count: active.length
    }
  }
})
