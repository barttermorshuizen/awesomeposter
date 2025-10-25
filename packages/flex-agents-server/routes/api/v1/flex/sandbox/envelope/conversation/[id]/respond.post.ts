import { readBody, createError } from 'h3'
import { z } from 'zod'
import { continueSandboxConversation } from '../../../../../../../../src/services/flex-sandbox-conversation'
import { applySandboxCors, requireFlexSandboxEnabled } from '../../../../../../../../src/utils/flex-sandbox'

const RespondSchema = z.object({
  message: z.string().min(1, 'message is required'),
  envelope: z.unknown().optional()
})

export default defineEventHandler(async (event) => {
  applySandboxCors(event)
  requireFlexSandboxEnabled()

  const { id } = event.context.params ?? {}
  if (!id || typeof id !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Conversation id is required.' })
  }

  const rawBody = await readBody<unknown>(event)
  const payload = RespondSchema.parse(rawBody ?? {})

  const response = await continueSandboxConversation(id, payload.message, payload.envelope)
  return response
})
