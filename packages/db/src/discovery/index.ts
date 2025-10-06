import { createHash, randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '../client.js'
import { discoveryItems, discoveryScores } from '../schema.js'

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

export type DiscoveryItemRecord = typeof discoveryItems.$inferSelect

export type DiscoveryScoreRecord = typeof discoveryScores.$inferSelect

export type DiscoveryScoreStatus = 'scored' | 'suppressed'

export type DiscoveryScoreComponents = {
  keyword: number
  recency: number
  source: number
  [key: string]: number
}

export type UpsertDiscoveryScoreInput = {
  itemId: string
  score: number
  keywordScore: number
  recencyScore: number
  sourceScore: number
  appliedThreshold: number
  weightsVersion?: number
  status: DiscoveryScoreStatus
  components?: Record<string, unknown>
  rationale?: Record<string, unknown> | null
  knobsHint?: Record<string, unknown> | null
  metadata?: Record<string, unknown>
  scoredAt?: Date
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

export async function listDiscoveryItemsByStatus(status: DiscoveryItemStatus, limit = 50) {
  const db = getDb()
  return db
    .select()
    .from(discoveryItems)
    .where(eq(discoveryItems.status, status))
    .orderBy(desc(discoveryItems.ingestedAt), desc(discoveryItems.fetchedAt))
    .limit(limit)
}

export async function listPendingDiscoveryItems(limit = 50) {
  return listDiscoveryItemsByStatus('pending_scoring', limit)
}

export async function countPendingDiscoveryItems(clientId?: string): Promise<number> {
  const db = getDb()
  const baseCondition = eq(discoveryItems.status, 'pending_scoring')
  const whereCondition = clientId ? and(baseCondition, eq(discoveryItems.clientId, clientId)) : baseCondition

  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(discoveryItems)
    .where(whereCondition)

  return Number(row?.count ?? 0)
}

export async function fetchDiscoveryItemsByIds(ids: string[]) {
  if (!ids.length) return []
  const db = getDb()
  return db
    .select()
    .from(discoveryItems)
    .where(inArray(discoveryItems.id, ids))
}

export async function updateDiscoveryItemStatus(itemId: string, status: DiscoveryItemStatus) {
  const db = getDb()
  await db
    .update(discoveryItems)
    .set({ status })
    .where(eq(discoveryItems.id, itemId))
}

export async function resetDiscoveryItemsToPending(itemIds: string[]) {
  if (!itemIds.length) return
  const db = getDb()
  await db
    .update(discoveryItems)
    .set({ status: 'pending_scoring' })
    .where(inArray(discoveryItems.id, itemIds))
}

export async function upsertDiscoveryScore(input: UpsertDiscoveryScoreInput) {
  const db = getDb()
  const scoredAt = input.scoredAt ?? new Date()
  await db.transaction(async (tx) => {
    const decimal = (value: number) => value.toString()
    const components = input.components ?? {
      keyword: input.keywordScore,
      recency: input.recencyScore,
      source: input.sourceScore,
    }

    const values: typeof discoveryScores.$inferInsert = {
      itemId: input.itemId,
      score: decimal(input.score),
      keywordScore: decimal(input.keywordScore),
      recencyScore: decimal(input.recencyScore),
      sourceScore: decimal(input.sourceScore),
      appliedThreshold: decimal(input.appliedThreshold),
      weightsVersion: input.weightsVersion ?? 1,
      componentsJson: components,
      rationaleJson: input.rationale ?? null,
      knobsHintJson: input.knobsHint ?? null,
      metadataJson: input.metadata ?? {},
      statusOutcome: input.status,
      scoredAt,
    }

    await tx
      .insert(discoveryScores)
      .values(values)
      .onConflictDoUpdate({
        target: discoveryScores.itemId,
        set: {
          score: values.score,
          keywordScore: values.keywordScore,
          recencyScore: values.recencyScore,
          sourceScore: values.sourceScore,
          appliedThreshold: values.appliedThreshold,
          weightsVersion: values.weightsVersion,
          componentsJson: values.componentsJson,
          rationaleJson: values.rationaleJson,
          knobsHintJson: values.knobsHintJson,
          metadataJson: values.metadataJson,
          statusOutcome: values.statusOutcome,
          scoredAt: values.scoredAt,
        },
      })

    await tx
      .update(discoveryItems)
      .set({ status: input.status })
      .where(eq(discoveryItems.id, input.itemId))
  })
}
