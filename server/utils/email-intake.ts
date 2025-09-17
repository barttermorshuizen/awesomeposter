import crypto from 'node:crypto'
import path from 'node:path'
import {
  getDb,
  clients,
  briefs,
  assets,
  emailsIngested,
  eq,
} from '@awesomeposter/db'
import { putAssetObject } from './storage'
import { getOpenAI } from './llm'

export interface EmailAddressLike {
  address: string
  name?: string | null
}

export interface EmailAttachmentInput {
  filename?: string | null
  contentType?: string | null
  content: Buffer
  size?: number | null
  disposition?: string | null
}

export interface ProcessEmailInput {
  provider?: string | null
  providerEventId?: string | null
  emailsIngestedId?: string | null
  messageId?: string | null
  subject?: string | null
  text?: string | null
  html?: string | null
  from: EmailAddressLike
  to?: EmailAddressLike[] | null
  receivedAt?: Date | null
  rawUrl?: string | null
  attachments?: EmailAttachmentInput[]
}

export interface ProcessEmailResult {
  ok: boolean
  status: 'processed' | 'skipped' | 'duplicate'
  reason?: string
  briefId?: string
  emailIngestedId?: string
  clientId?: string | null
  attachmentCount?: number
}

type ClientRow = typeof clients.$inferSelect

type EmailParsedMetadata = {
  briefId?: string
  clientId?: string | null
  title?: string
  attachmentIds?: string[]
  match?: string
  matchValue?: string
  [key: string]: unknown
}

type IntakeMatch = {
  client: ClientRow
  match: 'email' | 'domain' | 'website' | 'fallback'
  value: string
}

const EMAIL_REGEXP = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i
const DOMAIN_REGEXP = /^[a-z0-9.-]+\.[a-z]{2,}$/i

type AttachmentSummary = {
  filename?: string | null
  contentType?: string | null
  size?: number | null
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

function normalizeDomain(value: string): string {
  return value.replace(/^@+/, '').replace(/^\.+/, '').replace(/^www\./i, '').trim().toLowerCase()
}

function extractHostname(value?: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const asUrl = trimmed.includes('://') ? trimmed : `https://${trimmed}`
    const hostname = new URL(asUrl).hostname
    return normalizeDomain(hostname)
  } catch {
    return null
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function safeDateFromString(value: unknown): Date | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }
  return parsed
}

function summarizeAttachments(attachments: AttachmentSummary[]): string {
  if (!attachments.length) return 'None'
  return attachments
    .map((attachment, index) => {
      const name = attachment.filename?.trim() || `attachment-${index + 1}`
      const type = attachment.contentType?.split(';')[0] ?? 'unknown'
      const size = typeof attachment.size === 'number' && attachment.size > 0
        ? `${Math.round(attachment.size / 1024)} KB`
        : 'unknown size'
      return `- ${name} (${type}, ${size})`
    })
    .join('\n')
}

type LlmExtraction = {
  title: string
  description: string
  objective: string | null
  targetAudience: string | null
  deadline: string | null
}

async function extractBriefFieldsWithLlm(input: {
  subject?: string | null
  body: string
  receivedAt: Date
  attachments: AttachmentSummary[]
}): Promise<LlmExtraction | null> {
  const openai = getOpenAI()
  const schema = {
    name: 'brief_extraction',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'description', 'objective', 'targetAudience', 'deadline'],
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 180 },
        description: { type: 'string', minLength: 1, maxLength: 400 },
        objective: { type: ['string', 'null'], minLength: 1, maxLength: 240 },
        targetAudience: { type: ['string', 'null'], minLength: 1, maxLength: 180 },
        deadline: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      },
    },
    strict: true,
  } as const

  const bodyText = input.body.length > 6000 ? `${input.body.slice(0, 6000)}…` : input.body
  const attachmentsSummary = summarizeAttachments(input.attachments)

  const completion = await openai.chat.completions.create({
    model: 'gpt-5',
    response_format: { type: 'json_schema', json_schema: schema },
    messages: [
      {
        role: 'system',
        content: `You extract a structured brief from a client email so a marketing team can create social posts based on the brief.
Guidelines:
1. Base every field strictly on facts in the email body (and any attachments explicitly referenced). Never invent topics, tone, or audiences.
2. "title" must capture the concrete request/topic (e.g. "TGIF Drinks Post"), not meta instructions or improvement notes. Keep it under 120 characters.
3. "description" is the part of the email body stating what the post is about. Remove greetings, sign-offs, and unrelated logistics. Focus on the core message (e.g. "Promote Friday's TGIF drinks gathering.").
4. If the email does not clearly specify an objective or target audience, set those fields to null. When they do, summarise concisely.
5. Convert relative dates ("next Friday") into ISO YYYY-MM-DD using the provided Received At timestamp. If timing is unclear, use null.
6. Mention attachments only if the email instructs to use them. Do not fabricate attachment details.
7. Return JSON that matches the provided schema exactly.`,
      },
      {
        role: 'user',
        content: `Email Subject: ${input.subject ?? '(no subject)'}
Received At: ${input.receivedAt.toISOString()}
Body:
${bodyText}

Attachments:
${attachmentsSummary}`,
      },
    ],
  })

  const raw = completion.choices?.[0]?.message?.content
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const title = toNullableString(parsed.title)
    const description = toNullableString(parsed.description)
    if (!title || !description) {
      return null
    }
    return {
      title,
      description,
      objective: toNullableString(parsed.objective),
      targetAudience: toNullableString(parsed.targetAudience),
      deadline: toNullableString(parsed.deadline),
    }
  } catch (error) {
    console.warn('[email-intake] Failed to parse LLM response', error)
    return null
  }
}

function guessAssetType(contentType?: string | null): 'image' | 'document' | 'video' | 'audio' | 'other' {
  if (!contentType) return 'other'
  const lower = contentType.toLowerCase()
  if (lower.startsWith('image/')) return 'image'
  if (lower.startsWith('video/')) return 'video'
  if (lower.startsWith('audio/')) return 'audio'
  if (
    lower.includes('pdf') ||
    lower.includes('word') ||
    lower.includes('excel') ||
    lower.includes('presentation') ||
    lower.includes('text') ||
    lower.includes('document')
  ) {
    return 'document'
  }
  return 'other'
}

function collectCandidateValues(settings: unknown): unknown[] {
  const values: unknown[] = []
  if (!settings || typeof settings !== 'object') return values
  const obj = settings as Record<string, unknown>
  const keys = [
    'emailIntake',
    'intakeEmails',
    'emailAliases',
    'aliases',
    'contacts',
    'forwardingEmails',
    'primaryContact',
    'intake'
  ]
  for (const key of keys) {
    if (obj[key] !== undefined) {
      values.push(obj[key])
    }
  }
  return values
}

function collectEmailsAndDomains(source: unknown, emails: Set<string>, domains: Set<string>) {
  if (!source) return
  if (typeof source === 'string') {
    const trimmed = source.trim()
    if (!trimmed) return
    if (EMAIL_REGEXP.test(trimmed)) {
      emails.add(normalizeEmail(trimmed))
    } else if (DOMAIN_REGEXP.test(trimmed) || trimmed.startsWith('@')) {
      domains.add(normalizeDomain(trimmed))
    }
    return
  }
  if (Array.isArray(source)) {
    for (const item of source) {
      collectEmailsAndDomains(item, emails, domains)
    }
    return
  }
  if (typeof source === 'object') {
    for (const value of Object.values(source)) {
      collectEmailsAndDomains(value, emails, domains)
    }
  }
}

async function findClientForSender(senderEmail: string): Promise<IntakeMatch | null> {
  const normalizedEmail = normalizeEmail(senderEmail)
  if (!normalizedEmail) {
    return null
  }
  const senderDomain = normalizedEmail.includes('@') ? normalizedEmail.split('@')[1] : ''
  const db = getDb()
  const rows = await db
    .select({
      id: clients.id,
      name: clients.name,
      slug: clients.slug,
      website: clients.website,
      settingsJson: clients.settingsJson
    })
    .from(clients)

  for (const row of rows) {
    const emails = new Set<string>()
    const domains = new Set<string>()

    const candidates = collectCandidateValues(row.settingsJson ?? {})
    for (const candidate of candidates) {
      collectEmailsAndDomains(candidate, emails, domains)
    }

    if (emails.has(normalizedEmail)) {
      return { client: row as ClientRow, match: 'email', value: normalizedEmail }
    }

    if (senderDomain) {
      const normalizedDomain = normalizeDomain(senderDomain)
      if (domains.has(normalizedDomain)) {
        return { client: row as ClientRow, match: 'domain', value: normalizedDomain }
      }

      const websiteDomain = extractHostname(row.website)
      if (websiteDomain && (normalizedDomain === websiteDomain || normalizedDomain.endsWith(`.${websiteDomain}`))) {
        return { client: row as ClientRow, match: 'website', value: websiteDomain }
      }

      if (row.slug && (normalizedDomain === row.slug || normalizedDomain.startsWith(`${row.slug}.`))) {
        return { client: row as ClientRow, match: 'fallback', value: row.slug }
      }
    }
  }

  return null
}

async function ensureEmailRecord(payload: ProcessEmailInput, resolvedClientId: string | null): Promise<string> {
  const db = getDb()
  const provider = payload.provider?.trim() || 'unknown'
  const providerEventId = payload.providerEventId?.trim() || null
  const messageId = payload.messageId?.trim() || null
  const fromEmail = payload.from?.address ?? ''
  const toEmail = (payload.to ?? [])
    .map((address) => address?.address)
    .filter((value): value is string => Boolean(value))
    .join(', ')
  const subject = payload.subject ?? null
  const baseData = {
    provider,
    providerEventId,
    messageId,
    fromEmail,
    toEmail,
    subject,
    rawUrl: payload.rawUrl ?? null,
    clientId: resolvedClientId,
  }

  if (payload.emailsIngestedId) {
    const existingId = payload.emailsIngestedId.trim()
    if (existingId) {
      await db
        .update(emailsIngested)
        .set({ ...baseData, status: 'processing' })
        .where(eq(emailsIngested.id, existingId))
      return existingId
    }
  }

  if (providerEventId) {
    const [existing] = await db
      .select({ id: emailsIngested.id, provider: emailsIngested.provider })
      .from(emailsIngested)
      .where(eq(emailsIngested.providerEventId, providerEventId))
      .limit(1)
    if (existing?.id && existing.provider === provider) {
      await db
        .update(emailsIngested)
        .set({ ...baseData, status: 'processing' })
        .where(eq(emailsIngested.id, existing.id))
      return existing.id
    }
  }

  if (messageId) {
    const [existing] = await db
      .select({ id: emailsIngested.id, status: emailsIngested.status })
      .from(emailsIngested)
      .where(eq(emailsIngested.messageId, messageId))
      .limit(1)
    if (existing?.id) {
      await db
        .update(emailsIngested)
        .set({ ...baseData, status: 'processing' })
        .where(eq(emailsIngested.id, existing.id))
      return existing.id
    }
  }

  const id = crypto.randomUUID()
  await db.insert(emailsIngested).values({
    id,
    ...baseData,
    status: 'processing',
    parsedJson: null,
    createdAt: new Date(),
  })
  return id
}

async function markEmailRecordSkipped(emailId: string, reason: string) {
  const db = getDb()
  await db
    .update(emailsIngested)
    .set({ status: reason, parsedJson: { reason } })
    .where(eq(emailsIngested.id, emailId))
}

async function saveAttachment(
  briefId: string,
  clientId: string,
  attachment: EmailAttachmentInput,
): Promise<{ assetId: string; filename: string; downloadUrl: string } | null> {
  if (!attachment.content || attachment.content.length === 0) {
    return null
  }

  const buffer = attachment.content
  const originalName = attachment.filename?.trim() || 'attachment'
  const extensionFromName = path.extname(originalName)
  const inferredExt = extensionFromName || inferExtensionFromMime(attachment.contentType)
  const key = inferredExt
    ? `briefs/${briefId}/${crypto.randomUUID()}${inferredExt}`
    : `briefs/${briefId}/${crypto.randomUUID()}`

  const publicUrl = await putAssetObject(key, buffer, attachment.contentType ?? undefined)

  const assetId = crypto.randomUUID()
  const downloadUrl = `/api/assets/${assetId}/download`

  const db = getDb()
  await db.insert(assets).values({
    id: assetId,
    clientId,
    briefId,
    filename: key,
    originalName,
    url: downloadUrl,
    type: guessAssetType(attachment.contentType),
    mimeType: attachment.contentType ?? null,
    fileSize: buffer.length,
    metaJson: {
      disposition: attachment.disposition ?? null,
      sourceFilename: originalName,
      storedAt: publicUrl,
    },
  })

  return { assetId, filename: key, downloadUrl }
}

function inferExtensionFromMime(mime?: string | null): string {
  if (!mime) return ''
  const [, subtype] = mime.split('/')
  if (!subtype) return ''
  if (subtype.includes('jpeg')) return '.jpg'
  if (subtype.includes('png')) return '.png'
  if (subtype.includes('gif')) return '.gif'
  if (subtype.includes('pdf')) return '.pdf'
  if (subtype.includes('zip')) return '.zip'
  if (subtype.includes('msword')) return '.doc'
  if (subtype.includes('spreadsheet')) return '.xlsx'
  if (subtype.includes('presentation')) return '.pptx'
  if (subtype.includes('plain')) return '.txt'
  if (subtype.includes('html')) return '.html'
  return `.${subtype.split(';')[0]}`.replace(/[^a-z0-9.]/gi, '')
}

export async function processInboundEmail(payload: ProcessEmailInput): Promise<ProcessEmailResult> {
  const text = payload.text ?? (payload.html ? stripHtml(payload.html) : '')
  const subject = payload.subject ?? null

  const existingDb = getDb()
  const normalizedMessageId = payload.messageId?.trim()
  if (normalizedMessageId) {
    const [existing] = await existingDb
      .select({ id: emailsIngested.id, status: emailsIngested.status, parsedJson: emailsIngested.parsedJson })
      .from(emailsIngested)
      .where(eq(emailsIngested.messageId, normalizedMessageId))
      .limit(1)
    if (existing && existing.status === 'processed') {
      const parsed = (existing.parsedJson ?? {}) as EmailParsedMetadata
      if (parsed.briefId) {
        return {
          ok: true,
          status: 'duplicate',
          briefId: parsed.briefId,
          emailIngestedId: existing.id,
          clientId: parsed.clientId ?? null,
        }
      }
      return {
        ok: true,
        status: 'duplicate',
        emailIngestedId: existing.id,
        clientId: parsed.clientId ?? null,
      }
    }
  }

  const senderEmail = payload.from?.address?.trim()
  if (!senderEmail) {
    return { ok: false, status: 'skipped', reason: 'missing_sender' }
  }

  const match = await findClientForSender(senderEmail)
  const clientId = match?.client.id ?? null

  const emailRecordId = await ensureEmailRecord(payload, clientId)

  if (!match) {
    await markEmailRecordSkipped(emailRecordId, 'unknown_client')
    return { ok: false, status: 'skipped', reason: 'unknown_client', emailIngestedId: emailRecordId }
  }

  const bodyForExtraction = text && text.trim().length > 0
    ? text.trim()
    : [subject ?? '', match.client.name ?? ''].filter(Boolean).join('\n') || 'No additional context provided.'
  const receivedAt = payload.receivedAt ?? new Date()
  const llmExtraction = await extractBriefFieldsWithLlm({
    subject,
    body: bodyForExtraction,
    receivedAt,
    attachments: (payload.attachments ?? []).map((attachment) => ({
      filename: attachment.filename ?? null,
      contentType: attachment.contentType ?? null,
      size: attachment.size ?? null,
    })),
  })

  if (!llmExtraction) {
    await markEmailRecordSkipped(emailRecordId, 'manual_review')
    return { ok: false, status: 'skipped', reason: 'manual_review', emailIngestedId: emailRecordId }
  }

  const deadlineAt = safeDateFromString(llmExtraction.deadline)
  const fields = {
    title: llmExtraction.title.slice(0, 180),
    description: llmExtraction.description,
    objective: llmExtraction.objective,
    audienceId: llmExtraction.targetAudience,
    deadlineAt,
  }
  const db = getDb()
  const briefId = crypto.randomUUID()

  await db.insert(briefs).values({
    id: briefId,
    clientId: match.client.id,
    title: fields.title,
    description: fields.description,
    objective: fields.objective,
    audienceId: fields.audienceId,
    deadlineAt: fields.deadlineAt ?? null,
    status: 'draft',
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  const attachments = payload.attachments ?? []
  let storedCount = 0
  const storedAttachmentIds: Array<{ assetId: string; downloadUrl: string }> = []

  for (const attachment of attachments) {
    try {
      const stored = await saveAttachment(briefId, match.client.id, attachment)
      if (stored) {
        storedCount += 1
        storedAttachmentIds.push({ assetId: stored.assetId, downloadUrl: stored.downloadUrl })
      }
    } catch (error) {
      console.warn('[email-intake] Failed to persist attachment', attachment.filename, error)
    }
  }

  await db
    .update(emailsIngested)
    .set({
      clientId: match.client.id,
      status: 'processed',
      parsedJson: {
        briefId,
        clientId: match.client.id,
        title: fields.title,
        attachmentIds: storedAttachmentIds.map((entry) => entry.assetId),
        match: match.match,
        matchValue: match.value,
        llmModel: 'gpt-5',
        llmDeadline: llmExtraction.deadline,
      },
    })
    .where(eq(emailsIngested.id, emailRecordId))

  return {
    ok: true,
    status: 'processed',
    briefId,
    emailIngestedId: emailRecordId,
    clientId: match.client.id,
    attachmentCount: storedCount,
  }
}
