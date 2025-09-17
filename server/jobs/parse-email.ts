import type { ProcessEmailInput } from '../utils/email-intake'
import { processInboundEmail } from '../utils/email-intake'

type ParseEmailPayload = {
  storageUrl?: string | null
  providerEventId?: string | null
  email?: ProcessEmailInput
}

// Worker entrypoint: fetches payload from queue, normalizes, and hands off to email intake pipeline
export async function runParseEmailJob(payload: ParseEmailPayload) {
  console.log('parse-email started', payload)

  if (payload?.email) {
    const normalizedInput: ProcessEmailInput = {
      ...payload.email,
      providerEventId: payload.providerEventId ?? payload.email.providerEventId ?? null,
    }

    const result = await processInboundEmail(normalizedInput)
    return result
  }

  console.warn('parse-email job received no email payload; raw MIME processing not yet implemented')
  return { ok: false, status: 'skipped', reason: 'missing_email_payload' }
}
