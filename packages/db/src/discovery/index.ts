import { createHash, randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { getDb } from '../client.js'
import { discoveryItems } from '../schema.js'

export type DiscoveryItemStatus = 'pending_scoring' | 'scored' | 'suppressed' | 'promoted' | 'archived'

export type PersistDiscoveryItemInput = {
  clientId: string
  sourceId: string
  externalId: string
  title: string
  url: string
  fetchedAt: string
  publishedAt: string | null
  publishedAtSource: 'original' | 'fallback' | 'feed' | 'api'
  normalized: Record<string, unknown>
  rawPayload: unknown
  sourceMetadata: Record<string, unknown>
}

export type PersistDiscoveryItemsResult = {
  inserted: Array<{ id: string; rawHash: string }>
  duplicates: Array<{ rawHash: string }>
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`)
  return `{${entries.join(',')}}`
}

export function computeRawHash(rawPayload: unknown): string {
  const serialized = stableStringify(rawPayload)
  return createHash('sha256').update(serialized).digest('hex')
}

function toDate(value: string | null) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export async function persistDiscoveryItems(
  inputs: PersistDiscoveryItemInput[],
): Promise<PersistDiscoveryItemsResult> {
  if (!inputs.length) {
    return { inserted: [], duplicates: [] }
  }

  const db = getDb()

  const itemsWithHash = inputs.map((input) => ({
    input,
    rawHash: computeRawHash(input.rawPayload),
  }))

  const clientIds = new Set(itemsWithHash.map((item) => item.input.clientId))
  if (clientIds.size !== 1) {
    throw new Error('persistDiscoveryItems expects all inputs to share the same clientId')
  }
  const [clientId] = [...clientIds]

  const rawHashes = itemsWithHash.map((item) => item.rawHash)

  const existing = await db
    .select({ rawHash: discoveryItems.rawHash })
    .from(discoveryItems)
    .where(and(eq(discoveryItems.clientId, clientId), inArray(discoveryItems.rawHash, rawHashes)))

  const existingSet = new Set(existing.map((row) => row.rawHash))

  const toInsert = itemsWithHash.filter((item) => !existingSet.has(item.rawHash))

  const rows = toInsert.map(({ input, rawHash }) => ({
    id: randomUUID(),
    clientId: input.clientId,
    sourceId: input.sourceId,
    externalId: input.externalId,
    rawHash,
    status: 'pending_scoring' as DiscoveryItemStatus,
    title: input.title,
    url: input.url,
    fetchedAt: new Date(input.fetchedAt),
    publishedAt: toDate(input.publishedAt),
    publishedAtSource: input.publishedAtSource,
    rawPayloadJson: input.rawPayload as Record<string, unknown>,
    normalizedJson: input.normalized,
    sourceMetadataJson: input.sourceMetadata,
  }))

  let inserted: Array<{ id: string; rawHash: string }> = []
  if (rows.length) {
    inserted = await db
      .insert(discoveryItems)
      .values(rows)
      .returning({ id: discoveryItems.id, rawHash: discoveryItems.rawHash })
  }

  const duplicates = itemsWithHash
    .filter((item) => existingSet.has(item.rawHash))
    .map((item) => ({ rawHash: item.rawHash }))

  return { inserted, duplicates }
}
