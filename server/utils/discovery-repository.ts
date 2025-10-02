import { and, eq, getDb, discoverySources, discoveryKeywords } from '@awesomeposter/db'
import { desc } from 'drizzle-orm'
import type { InferModel } from 'drizzle-orm'
import { z } from 'zod'
import {
  CreateDiscoverySourceInput,
  createDiscoverySourceInputSchema,
  normalizeDiscoverySourceUrl,
  deriveDuplicateKey,
  DiscoverySourceType,
  normalizeDiscoveryKeyword,
} from '@awesomeposter/shared'
import { requireDiscoveryFeatureEnabled } from './client-config/feature-flags'

export type DiscoverySourceRecord = InferModel<typeof discoverySources>
export type DiscoveryKeywordRecord = InferModel<typeof discoveryKeywords>

export class InvalidDiscoverySourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidDiscoverySourceError'
  }
}

export class DuplicateDiscoverySourceError extends Error {
  public readonly duplicateKey: string

  constructor(message: string, duplicateKey: string) {
    super(message)
    this.name = 'DuplicateDiscoverySourceError'
    this.duplicateKey = duplicateKey
  }
}

export class InvalidDiscoveryKeywordError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidDiscoveryKeywordError'
  }
}

export class DuplicateDiscoveryKeywordError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DuplicateDiscoveryKeywordError'
  }
}

export class KeywordLimitExceededError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KeywordLimitExceededError'
  }
}

export class DiscoveryKeywordNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DiscoveryKeywordNotFoundError'
  }
}

const deleteInputSchema = z.object({
  clientId: z.string().uuid(),
  sourceId: z.string().uuid(),
})

const keywordInputSchema = z.object({
  clientId: z.string().uuid(),
  keyword: z.string(),
  addedBy: z.string().trim().min(1).optional(),
})

const keywordUpdateSchema = z.object({
  clientId: z.string().uuid(),
  keywordId: z.string().uuid(),
  keyword: z.string(),
})

const keywordDeleteSchema = z.object({
  clientId: z.string().uuid(),
  keywordId: z.string().uuid(),
})

const KEYWORD_LIMIT = 20

function buildConfigPayload(type: DiscoverySourceType, identifier: string) {
  if (type === 'youtube-channel') {
    return { youtube: { channel: identifier } }
  }
  if (type === 'youtube-playlist') {
    return { youtube: { playlist: identifier } }
  }
  if (type === 'rss') {
    return { rss: { canonical: true } }
  }
  return null
}

export async function listDiscoverySources(clientId: string) {
  await requireDiscoveryFeatureEnabled(clientId)
  const db = getDb()
  return db
    .select()
    .from(discoverySources)
    .where(eq(discoverySources.clientId, clientId))
    .orderBy(desc(discoverySources.createdAt))
}

export async function createDiscoverySource(input: CreateDiscoverySourceInput) {
  const parsed = createDiscoverySourceInputSchema.safeParse(input)
  if (!parsed.success) {
    throw new InvalidDiscoverySourceError(parsed.error.issues[0]?.message || 'Invalid payload')
  }

  await requireDiscoveryFeatureEnabled(parsed.data.clientId)

  const normalized = (() => {
    try {
      return normalizeDiscoverySourceUrl(parsed.data.url)
    } catch (err) {
      throw new InvalidDiscoverySourceError((err as Error).message)
    }
  })()

  const duplicateKey = deriveDuplicateKey(normalized)
  const db = getDb()
  const existing = await db
    .select({ id: discoverySources.id })
    .from(discoverySources)
    .where(and(
      eq(discoverySources.clientId, parsed.data.clientId),
      eq(discoverySources.sourceType, normalized.sourceType),
      eq(discoverySources.identifier, normalized.identifier),
    ))
    .limit(1)

  if (existing[0]) {
    throw new DuplicateDiscoverySourceError('Source already exists for this client', duplicateKey)
  }

  const now = new Date()
  const id = crypto.randomUUID()
  const payload: DiscoverySourceRecord = {
    id,
    clientId: parsed.data.clientId,
    url: normalized.url,
    canonicalUrl: normalized.canonicalUrl,
    sourceType: normalized.sourceType,
    identifier: normalized.identifier,
    notes: parsed.data.notes?.trim() || null,
    configJson: buildConfigPayload(normalized.sourceType, normalized.identifier),
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(discoverySources).values(payload)
  return payload
}

export async function deleteDiscoverySource(input: { clientId: string; sourceId: string }) {
  const parsed = deleteInputSchema.parse(input)
  await requireDiscoveryFeatureEnabled(parsed.clientId)
  const db = getDb()
  const result = await db
    .delete(discoverySources)
    .where(and(
      eq(discoverySources.clientId, parsed.clientId),
      eq(discoverySources.id, parsed.sourceId),
    ))
    .returning({ id: discoverySources.id })
  return result[0]?.id ?? null
}

function mapKeywordRecord(record: DiscoveryKeywordRecord) {
  return {
    id: record.id,
    clientId: record.clientId,
    keyword: record.keyword,
    addedBy: record.addedBy ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

async function fetchKeywordRecords(clientId: string) {
  await requireDiscoveryFeatureEnabled(clientId)
  const db = getDb()
  return db
    .select()
    .from(discoveryKeywords)
    .where(eq(discoveryKeywords.clientId, clientId))
    .orderBy(desc(discoveryKeywords.createdAt))
}

export async function listDiscoveryKeywords(clientId: string) {
  const records = await fetchKeywordRecords(clientId)
  return records.map(mapKeywordRecord)
}

export async function createDiscoveryKeyword(input: { clientId: string; keyword: string; addedBy?: string | null }) {
  const parsed = keywordInputSchema.parse(input)
  await requireDiscoveryFeatureEnabled(parsed.clientId)
  let normalized
  try {
    normalized = normalizeDiscoveryKeyword(parsed.keyword)
  } catch (err) {
    throw new InvalidDiscoveryKeywordError((err as Error).message)
  }

  const db = getDb()
  const existing = await fetchKeywordRecords(parsed.clientId)

  if (existing.length >= KEYWORD_LIMIT) {
    throw new KeywordLimitExceededError('Maximum of 20 keywords per client')
  }

  if (existing.some((entry) => entry.keywordAlias === normalized.duplicateKey)) {
    throw new DuplicateDiscoveryKeywordError('Keyword already exists for this client')
  }

  const now = new Date()
  const record: DiscoveryKeywordRecord = {
    id: crypto.randomUUID(),
    clientId: parsed.clientId,
    keyword: normalized.canonical,
    keywordAlias: normalized.duplicateKey,
    addedBy: parsed.addedBy ?? null,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(discoveryKeywords).values(record)
  return mapKeywordRecord(record)
}

export async function updateDiscoveryKeyword(input: { clientId: string; keywordId: string; keyword: string }) {
  const parsed = keywordUpdateSchema.parse(input)
  await requireDiscoveryFeatureEnabled(parsed.clientId)
  let normalized
  try {
    normalized = normalizeDiscoveryKeyword(parsed.keyword)
  } catch (err) {
    throw new InvalidDiscoveryKeywordError((err as Error).message)
  }

  const db = getDb()
  const records = await fetchKeywordRecords(parsed.clientId)
  const target = records.find((entry) => entry.id === parsed.keywordId)
  if (!target) {
    throw new DiscoveryKeywordNotFoundError('Keyword not found')
  }

  if (records.some((entry) => entry.id !== parsed.keywordId && entry.keywordAlias === normalized.duplicateKey)) {
    throw new DuplicateDiscoveryKeywordError('Keyword already exists for this client')
  }

  if (target.keyword === normalized.canonical) {
    return mapKeywordRecord(target)
  }

  const now = new Date()
  const [updated] = await db
    .update(discoveryKeywords)
    .set({
      keyword: normalized.canonical,
      keywordAlias: normalized.duplicateKey,
      updatedAt: now,
    })
    .where(and(
      eq(discoveryKeywords.clientId, parsed.clientId),
      eq(discoveryKeywords.id, parsed.keywordId),
    ))
    .returning()

  if (!updated) {
    throw new DiscoveryKeywordNotFoundError('Keyword not found')
  }

  return mapKeywordRecord(updated)
}

export async function deleteDiscoveryKeyword(input: { clientId: string; keywordId: string }) {
  const parsed = keywordDeleteSchema.parse(input)
  await requireDiscoveryFeatureEnabled(parsed.clientId)
  const db = getDb()
  const [deleted] = await db
    .delete(discoveryKeywords)
    .where(and(
      eq(discoveryKeywords.clientId, parsed.clientId),
      eq(discoveryKeywords.id, parsed.keywordId),
    ))
    .returning({ id: discoveryKeywords.id })

  return deleted?.id ?? null
}
