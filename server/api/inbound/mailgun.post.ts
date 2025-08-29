import crypto from 'node:crypto'
import { getEnv } from '../../utils/env'
import { getDb, emailsIngested } from '@awesomeposter/db'

function verifyMailgunSignature(timestamp: string, token: string, signature: string, key: string) {
  const hmac = crypto.createHmac('sha256', key)
  hmac.update(timestamp + token)
  const digest = hmac.digest('hex')
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature))
}

export default defineEventHandler(async (event) => {
  const env = getEnv()
  const body = await readBody(event)

  const { signature, "event-data": eventData } = body || {}
  if (!signature || !eventData) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid payload' })
  }

  const ok = verifyMailgunSignature(signature.timestamp, signature.token, signature.signature, env.MAILGUN_SIGNING_KEY)
  if (!ok) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid signature' })
  }

  const msg = eventData.message
  const db = getDb()
  const id = crypto.randomUUID()
  await db.insert(emailsIngested).values({
    id,
    provider: 'mailgun',
    providerEventId: eventData.id,
    messageId: msg.headers['message-id'] || msg['message-id'] || msg.headers['Message-Id'] || '',
    fromEmail: msg.headers.from,
    toEmail: msg.headers.to,
    subject: msg.headers.subject,
    rawUrl: msg.storage?.url ?? null,
    status: 'received',
    parsedJson: null
  })

  return { ok: true }
})


