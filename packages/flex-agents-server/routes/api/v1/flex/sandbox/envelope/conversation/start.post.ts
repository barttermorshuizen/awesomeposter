import { readBody } from 'h3'
import { z } from 'zod'
import { beginSandboxConversation } from '../../../../../../../src/services/flex-sandbox-conversation'
import { applySandboxCors, requireFlexSandboxEnabled } from '../../../../../../../src/utils/flex-sandbox'

const StartPayloadSchema = z
  .object({
    envelope: z.unknown().optional()
  })
  .optional()

export default defineEventHandler(async (event) => {
  applySandboxCors(event)
  requireFlexSandboxEnabled()

  const rawBody = await readBody<unknown>(event)
  const payload = StartPayloadSchema.parse(rawBody) ?? {}

  const response = await beginSandboxConversation(payload.envelope)
  return response
})
