import { and, eq, getDb, discoverySources } from '@awesomeposter/db'
import { desc } from 'drizzle-orm'
import type { InferModel } from 'drizzle-orm'
import { z } from 'zod'
import {
  CreateDiscoverySourceInput,
  createDiscoverySourceInputSchema,
  normalizeDiscoverySourceUrl,
  deriveDuplicateKey,
  DiscoverySourceType,
} from '@awesomeposter/shared'

export type DiscoverySourceRecord = InferModel<typeof discoverySources>

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

const deleteInputSchema = z.object({
  clientId: z.string().uuid(),
  sourceId: z.string().uuid(),
})

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
