import {
  eq,
  getDb,
  discoverySources,
  discoveryKeywords,
  discoveryIngestRuns,
  discoveryItems,
  fetchDiscoveryItemsByIds,
  persistDiscoveryItems,
  resetDiscoveryItemsToPending as resetDiscoveryItemsToPendingDb,
  upsertDiscoveryScore,
  countPendingDiscoveryItems,
  type PersistDiscoveryItemInput,
  type PersistDiscoveryItemsResult,
} from '@awesomeposter/db'
import { and, desc, ne, or, lte, isNull } from 'drizzle-orm'
import type { InferModel } from 'drizzle-orm'
import { z } from 'zod'
import {
  CreateDiscoverySourceInput,
  createDiscoverySourceInputSchema,
  normalizeDiscoverySourceUrl,
  deriveDuplicateKey,
  DiscoverySourceType,
  normalizeDiscoveryKeyword,
  type NormalizedDiscoveryAdapterItem,
  type DiscoverySourceMetadata,
  type DiscoveryIngestionFailureReason,
} from '@awesomeposter/shared'
import type { SourceHealthStatus } from './discovery-health'
import { requireDiscoveryFeatureEnabled } from './client-config/feature-flags'

export type DiscoverySourceRecord = InferModel<typeof discoverySources>
export type DiscoveryKeywordRecord = InferModel<typeof discoveryKeywords>
export type DiscoveryIngestRunRecord = InferModel<typeof discoveryIngestRuns>

export type DiscoverySourceWithCadence = DiscoverySourceRecord & {
  nextFetchAt: Date | null
  fetchIntervalMinutes: number
  lastFetchStatus: 'idle' | 'running' | 'success' | 'failure'
  lastFetchStartedAt: Date | null
  lastFetchCompletedAt: Date | null
  lastFailureReason: string | null
  lastSuccessAt: Date | null
  consecutiveFailureCount: number
  healthJson: Record<string, unknown> | null
}

export type DiscoverySourceHealthUpdate = {
  status: SourceHealthStatus
  observedAt: Date
  lastFetchedAt: Date | null
  consecutiveFailures: number
  lastSuccessAt: Date | null
  failureReason?: DiscoveryIngestionFailureReason | null
  staleSince?: Date | null
}

export type MarkedStaleDiscoverySource = {
  clientId: string
  sourceId: string
  sourceType: DiscoverySourceType
  health: DiscoverySourceHealthUpdate
}

type StreakType = 'success' | 'failure' | 'stale'

function coerceNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return fallback
}

function readStreakCount(health: Record<string, unknown> | null | undefined, expectedType: StreakType): number {
  if (!health || typeof health !== 'object') {
    return 0
  }
  const rawStreak = (health as { streak?: { type?: unknown; count?: unknown } }).streak
  if (!rawStreak || typeof rawStreak !== 'object') {
    return 0
  }
  if ((rawStreak as { type?: unknown }).type !== expectedType) {
    return 0
  }
  return coerceNumber((rawStreak as { count?: unknown }).count, 0)
}

function toIsoString(value: Date | null | undefined): string | null {
  if (!value) {
    return null
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function buildHealthJson(
  snapshot: DiscoverySourceHealthUpdate,
  streak: { type: StreakType; count: number },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    status: snapshot.status,
    observedAt: snapshot.observedAt.toISOString(),
    lastFetchedAt: toIsoString(snapshot.lastFetchedAt),
    lastSuccessAt: toIsoString(snapshot.lastSuccessAt),
    consecutiveFailures: snapshot.consecutiveFailures,
    streak: {
      type: streak.type,
      count: streak.count,
      updatedAt: snapshot.observedAt.toISOString(),
    },
  }

  if (snapshot.failureReason) {
    payload.failureReason = snapshot.failureReason
  }

  if (snapshot.staleSince) {
    payload.staleSince = snapshot.staleSince.toISOString()
  }

  return payload
}

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

export function computeNextFetchAt(
  completedAt: Date,
  fetchIntervalMinutes: number,
  retryInMinutes?: number | null,
) {
  const base = completedAt.getTime()
  const offsetMinutes = typeof retryInMinutes === 'number' && retryInMinutes >= 0
    ? retryInMinutes
    : fetchIntervalMinutes
  return new Date(base + offsetMinutes * 60_000)
}

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

export async function listDiscoverySourcesDue(limit: number, now = new Date()) {
  const db = getDb()
  return db
    .select()
    .from(discoverySources)
    .where(and(
      or(isNull(discoverySources.nextFetchAt), lte(discoverySources.nextFetchAt, now)),
      ne(discoverySources.lastFetchStatus, 'running'),
    ))
    .orderBy(discoverySources.nextFetchAt)
    .limit(limit)
}

export async function claimDiscoverySourceForFetch(sourceId: string, now = new Date()) {
  const db = getDb()
  const [record] = await db
    .update(discoverySources)
    .set({
      lastFetchStatus: 'running',
      lastFetchStartedAt: now,
      updatedAt: now,
    })
    .where(and(
      eq(discoverySources.id, sourceId),
      ne(discoverySources.lastFetchStatus, 'running'),
      or(isNull(discoverySources.nextFetchAt), lte(discoverySources.nextFetchAt, now)),
    ))
    .returning()
  return record ?? null
}

export type CompleteDiscoverySourceFetchInput = {
  runId: string
  sourceId: string
  clientId: string
  startedAt: Date
  completedAt: Date
  fetchIntervalMinutes: number
  success: boolean
  failureReason?: string | null
  retryInMinutes?: number | null
  telemetry?: Record<string, unknown>
  metrics?: Record<string, unknown>
}

export async function completeDiscoverySourceFetch(input: CompleteDiscoverySourceFetchInput): Promise<DiscoverySourceHealthUpdate> {
  const db = getDb()
  const durationMs = Math.max(0, input.completedAt.getTime() - input.startedAt.getTime())
  const nextFetchAt = computeNextFetchAt(input.completedAt, input.fetchIntervalMinutes, input.retryInMinutes)

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        consecutiveFailureCount: discoverySources.consecutiveFailureCount,
        lastSuccessAt: discoverySources.lastSuccessAt,
        healthJson: discoverySources.healthJson,
      })
      .from(discoverySources)
      .where(eq(discoverySources.id, input.sourceId))
      .limit(1)

    const previousFailures = current?.consecutiveFailureCount ?? 0
    const previousSuccessAt = current?.lastSuccessAt ?? null
    const previousHealthJson = current?.healthJson ?? null

    const nextFailures = input.success ? 0 : previousFailures + 1
    const lastSuccessAt = input.success ? input.completedAt : previousSuccessAt
    const status: SourceHealthStatus = input.success
      ? 'healthy'
      : nextFailures >= 3
        ? 'error'
        : 'warning'
    const failureReason = input.success ? null : input.failureReason ?? null
    const observedAt = input.completedAt
    const streakType: StreakType = input.success ? 'success' : 'failure'
    const streakCount = input.success
      ? readStreakCount(previousHealthJson, 'success') + 1
      : nextFailures

    const snapshot: DiscoverySourceHealthUpdate = {
      status,
      observedAt,
      lastFetchedAt: input.completedAt,
      consecutiveFailures: nextFailures,
      lastSuccessAt,
      failureReason: failureReason ?? undefined,
    }

    const healthJson = buildHealthJson(snapshot, { type: streakType, count: streakCount })

    await tx.insert(discoveryIngestRuns).values({
      id: crypto.randomUUID(),
      runId: input.runId,
      clientId: input.clientId,
      sourceId: input.sourceId,
      status: input.success ? 'succeeded' : 'failed',
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      durationMs,
      failureReason: failureReason,
      retryInMinutes: input.retryInMinutes ?? null,
      metricsJson: input.metrics ?? {},
      telemetryJson: input.telemetry ?? {},
      createdAt: new Date(),
    })

    await tx
      .update(discoverySources)
      .set({
        lastFetchStatus: input.success ? 'success' : 'failure',
        lastFetchCompletedAt: input.completedAt,
        lastFailureReason: failureReason,
        nextFetchAt,
        updatedAt: observedAt,
        lastSuccessAt,
        consecutiveFailureCount: nextFailures,
        healthJson,
      })
      .where(eq(discoverySources.id, input.sourceId))

    return snapshot
  })
}

export type SaveDiscoveryItemsInput = {
  clientId: string
  sourceId: string
  items: Array<{
    normalized: NormalizedDiscoveryAdapterItem
    rawPayload: unknown
    sourceMetadata: DiscoverySourceMetadata
  }>
}

export async function saveDiscoveryItems(input: SaveDiscoveryItemsInput): Promise<PersistDiscoveryItemsResult> {
  if (!input.items.length) {
    return { inserted: [], duplicates: [] }
  }

  const payloads: PersistDiscoveryItemInput[] = input.items.map(({ normalized, rawPayload, sourceMetadata }) => ({
    clientId: input.clientId,
    sourceId: input.sourceId,
    externalId: normalized.externalId,
    title: normalized.title,
    url: normalized.url,
    fetchedAt: normalized.fetchedAt,
    publishedAt: normalized.publishedAt,
    publishedAtSource: normalized.publishedAtSource,
    normalized: normalized as Record<string, unknown>,
    rawPayload,
    sourceMetadata: sourceMetadata as Record<string, unknown>,
  }))

  return persistDiscoveryItems(payloads)
}

export type DiscoveryScorePersistenceInput = {
  itemId: string
  clientId: string
  sourceId: string
  score: number
  keywordScore: number
  recencyScore: number
  sourceScore: number
  appliedThreshold: number
  status: 'scored' | 'suppressed'
  weightsVersion: number
  components?: Record<string, number>
  metadata?: Record<string, unknown>
  scoredAt?: Date
}

export async function persistDiscoveryScores(inputs: DiscoveryScorePersistenceInput[]): Promise<void> {
  if (!inputs.length) return

  await Promise.all(
    inputs.map((input) =>
      upsertDiscoveryScore({
        itemId: input.itemId,
        score: input.score,
        keywordScore: input.keywordScore,
        recencyScore: input.recencyScore,
        sourceScore: input.sourceScore,
        appliedThreshold: input.appliedThreshold,
        status: input.status,
        weightsVersion: input.weightsVersion,
        components: input.components ?? {
          keyword: input.keywordScore,
          recency: input.recencyScore,
          source: input.sourceScore,
        },
        metadata: {
          clientId: input.clientId,
          sourceId: input.sourceId,
          ...(input.metadata ?? {}),
        },
        scoredAt: input.scoredAt,
      }),
    ),
  )
}

export async function resetDiscoveryItemsToPending(itemIds: string[]): Promise<void> {
  if (!itemIds.length) return
  await resetDiscoveryItemsToPendingDb(itemIds)
}

export async function countPendingDiscoveryItemsForClient(clientId: string): Promise<number> {
  return countPendingDiscoveryItems(clientId)
}

export type PendingDiscoveryItem = {
  id: string
  clientId: string
  sourceId: string
  title: string
  url: string
  rawHash: string
  fetchedAt: Date
  publishedAt: Date | null
  normalized: Record<string, unknown>
  sourceMetadata: Record<string, unknown>
  rawPayload: Record<string, unknown>
}

export type DiscoveryItemForScoring = {
  id: string
  clientId: string
  sourceId: string
  fetchedAt: Date
  publishedAt: Date | null
  normalized: Record<string, unknown>
  sourceMetadata: Record<string, unknown>
}

export async function fetchDiscoveryItemsForScoring(itemIds: string[]): Promise<DiscoveryItemForScoring[]> {
  if (!itemIds.length) {
    return []
  }

  const rows = await fetchDiscoveryItemsByIds(itemIds)
  return rows.map((row) => ({
    id: row.id,
    clientId: row.clientId,
    sourceId: row.sourceId,
    fetchedAt: row.fetchedAt,
    publishedAt: row.publishedAt,
    normalized: row.normalizedJson,
    sourceMetadata: row.sourceMetadataJson as Record<string, unknown>,
  }))
}

export async function listPendingDiscoveryItems(limit: number, clientId?: string): Promise<PendingDiscoveryItem[]> {
  const db = getDb()
  const conditions = [eq(discoveryItems.status, 'pending_scoring' as const)]
  if (clientId) {
    conditions.push(eq(discoveryItems.clientId, clientId))
  }

  const whereCondition = conditions.length === 1 ? conditions[0]! : and(...conditions)

  const rows = await db
    .select({
      id: discoveryItems.id,
      clientId: discoveryItems.clientId,
      sourceId: discoveryItems.sourceId,
      title: discoveryItems.title,
      url: discoveryItems.url,
      rawHash: discoveryItems.rawHash,
      fetchedAt: discoveryItems.fetchedAt,
      publishedAt: discoveryItems.publishedAt,
      normalized: discoveryItems.normalizedJson,
      sourceMetadata: discoveryItems.sourceMetadataJson,
      rawPayload: discoveryItems.rawPayloadJson,
    })
    .from(discoveryItems)
    .where(whereCondition)
    .orderBy(discoveryItems.fetchedAt)
    .limit(limit)

  return rows.map((row) => ({
    id: row.id,
    clientId: row.clientId,
    sourceId: row.sourceId,
    title: row.title,
    url: row.url,
    rawHash: row.rawHash,
    fetchedAt: row.fetchedAt,
    publishedAt: row.publishedAt,
    normalized: row.normalized,
    sourceMetadata: row.sourceMetadata as Record<string, unknown>,
    rawPayload: row.rawPayload as Record<string, unknown>,
  }))
}

export type ReleaseDiscoverySourceAfterFailedCompletionInput = {
  sourceId: string
  completedAt: Date
  fetchIntervalMinutes: number
  success: boolean
  failureReason?: string | null
  retryInMinutes?: number | null
}

export async function releaseDiscoverySourceAfterFailedCompletion(
  input: ReleaseDiscoverySourceAfterFailedCompletionInput,
): Promise<DiscoverySourceHealthUpdate> {
  const db = getDb()
  const nextFetchAt = computeNextFetchAt(input.completedAt, input.fetchIntervalMinutes, input.retryInMinutes)

  const [current] = await db
    .select({
      consecutiveFailureCount: discoverySources.consecutiveFailureCount,
      lastSuccessAt: discoverySources.lastSuccessAt,
      healthJson: discoverySources.healthJson,
    })
    .from(discoverySources)
    .where(eq(discoverySources.id, input.sourceId))
    .limit(1)

  const previousFailures = current?.consecutiveFailureCount ?? 0
  const previousSuccessAt = current?.lastSuccessAt ?? null
  const previousHealthJson = current?.healthJson ?? null

  const nextFailures = input.success ? 0 : previousFailures + 1
  const lastSuccessAt = input.success ? input.completedAt : previousSuccessAt
  const status: SourceHealthStatus = input.success
    ? 'healthy'
    : nextFailures >= 3
      ? 'error'
      : 'warning'
  const failureReason = input.success ? null : input.failureReason ?? null
  const observedAt = input.completedAt
  const streakType: StreakType = input.success ? 'success' : 'failure'
  const streakCount = input.success
    ? readStreakCount(previousHealthJson, 'success') + 1
    : nextFailures

  const snapshot: DiscoverySourceHealthUpdate = {
    status,
    observedAt,
    lastFetchedAt: input.completedAt,
    consecutiveFailures: nextFailures,
    lastSuccessAt,
    failureReason: failureReason ?? undefined,
  }

  const healthJson = buildHealthJson(snapshot, { type: streakType, count: streakCount })

  await db
    .update(discoverySources)
    .set({
      lastFetchStatus: input.success ? 'success' : 'failure',
      lastFetchCompletedAt: input.completedAt,
      lastFailureReason: failureReason,
      nextFetchAt,
      updatedAt: observedAt,
      lastSuccessAt,
      consecutiveFailureCount: nextFailures,
      healthJson,
    })
    .where(eq(discoverySources.id, input.sourceId))

  return snapshot
}

export async function markStaleDiscoverySources(
  cutoff: Date,
  now = new Date(),
): Promise<MarkedStaleDiscoverySource[]> {
  const db = getDb()
  const rows = await db
    .select({
      id: discoverySources.id,
      clientId: discoverySources.clientId,
      sourceType: discoverySources.sourceType,
      lastFetchCompletedAt: discoverySources.lastFetchCompletedAt,
      lastSuccessAt: discoverySources.lastSuccessAt,
      lastFailureReason: discoverySources.lastFailureReason,
      consecutiveFailureCount: discoverySources.consecutiveFailureCount,
      healthJson: discoverySources.healthJson,
      createdAt: discoverySources.createdAt,
    })
    .from(discoverySources)
    .where(and(
      ne(discoverySources.lastFetchStatus, 'running'),
      or(
        and(isNull(discoverySources.lastFetchCompletedAt), lte(discoverySources.createdAt, cutoff)),
        lte(discoverySources.lastFetchCompletedAt, cutoff),
      ),
    ))

  if (!rows.length) {
    return []
  }

  const updates: MarkedStaleDiscoverySource[] = []

  await db.transaction(async (tx) => {
    for (const row of rows) {
      const previousFailures = row.consecutiveFailureCount ?? 0
      const consecutiveFailures = previousFailures > 0 ? previousFailures : 1
      const status: SourceHealthStatus = consecutiveFailures >= 3 ? 'error' : 'warning'
      const lastFetchedAt = row.lastFetchCompletedAt ?? null
      const lastSuccessAt = row.lastSuccessAt ?? null
      const staleSince = lastFetchedAt ?? lastSuccessAt ?? row.createdAt ?? cutoff
      const failureReason = row.lastFailureReason ?? undefined
      const streakCount = readStreakCount(row.healthJson, 'stale') + 1

      const snapshot: DiscoverySourceHealthUpdate = {
        status,
        observedAt: now,
        lastFetchedAt,
        consecutiveFailures,
        lastSuccessAt,
        failureReason,
        staleSince,
      }

      const healthJson = buildHealthJson(snapshot, { type: 'stale', count: streakCount })

      await tx
        .update(discoverySources)
        .set({
          consecutiveFailureCount: consecutiveFailures,
          updatedAt: now,
          healthJson,
        })
        .where(eq(discoverySources.id, row.id))

      updates.push({
        clientId: row.clientId,
        sourceId: row.id,
        sourceType: row.sourceType,
        health: snapshot,
      })
    }
  })

  return updates
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
    .select({
      id: discoverySources.id,
      identifier: discoverySources.identifier,
    })
    .from(discoverySources)
    .where(and(
      eq(discoverySources.clientId, parsed.data.clientId),
      eq(discoverySources.sourceType, normalized.sourceType),
    ))

  const normalizedIdentifier = normalized.identifier.toLowerCase()
  const duplicateMatch = existing.find((record) => record.identifier.toLowerCase() === normalizedIdentifier)

  if (duplicateMatch) {
    throw new DuplicateDiscoverySourceError('Source already exists for this client', duplicateKey)
  }

  const now = new Date()
  const id = crypto.randomUUID()
  const initialHealth: DiscoverySourceHealthUpdate = {
    status: 'healthy',
    observedAt: now,
    lastFetchedAt: null,
    consecutiveFailures: 0,
    lastSuccessAt: null,
  }
  const payload: DiscoverySourceRecord = {
    id,
    clientId: parsed.data.clientId,
    url: normalized.url,
    canonicalUrl: normalized.canonicalUrl,
    sourceType: normalized.sourceType,
    identifier: normalized.identifier,
    notes: parsed.data.notes?.trim() || null,
    configJson: buildConfigPayload(normalized.sourceType, normalized.identifier),
    fetchIntervalMinutes: 60,
    nextFetchAt: now,
    lastFetchStatus: 'idle',
    lastFetchStartedAt: null,
    lastFetchCompletedAt: null,
    lastFailureReason: null,
    lastSuccessAt: null,
    consecutiveFailureCount: 0,
    healthJson: buildHealthJson(initialHealth, { type: 'success', count: 0 }),
    createdAt: now,
    updatedAt: now,
  }

  try {
    await db.insert(discoverySources).values(payload)
  } catch (error) {
    if (isDuplicateSourceConstraint(error)) {
      throw new DuplicateDiscoverySourceError('Source already exists for this client', duplicateKey)
    }
    throw error
  }
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

function isDuplicateSourceConstraint(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false
  }
  const code = (error as { code?: unknown }).code
  if (code !== '23505') {
    return false
  }
  const constraint = (error as { constraint?: unknown }).constraint
  if (typeof constraint !== 'string') {
    return false
  }
  return constraint === 'discovery_sources_client_identifier_unique'
    || constraint === 'discovery_sources_client_identifier_lower_unique'
}

function isDuplicateKeywordConstraint(error: unknown) {
  if (!error || typeof error !== 'object') {
    return false
  }
  const code = (error as { code?: unknown }).code
  if (code !== '23505') {
    return false
  }
  const constraint = (error as { constraint?: unknown }).constraint
  if (typeof constraint !== 'string') {
    return false
  }
  return constraint === 'discovery_keywords_client_alias_unique'
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

  try {
    await db.insert(discoveryKeywords).values(record)
  } catch (error) {
    if (isDuplicateKeywordConstraint(error)) {
      throw new DuplicateDiscoveryKeywordError('Keyword already exists for this client')
    }
    throw error
  }
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
  let updated
  try {
    ;[updated] = await db
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
  } catch (error) {
    if (isDuplicateKeywordConstraint(error)) {
      throw new DuplicateDiscoveryKeywordError('Keyword already exists for this client')
    }
    throw error
  }

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
