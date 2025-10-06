import { and, eq, inArray, sql, desc, ne, or, isNull, lte } from 'drizzle-orm';
import { g as getDb, j as discoveryItems, k as discoveryScores, l as discoveryKeywords, m as discoverySources, n as discoveryIngestRuns } from './client.mjs';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { r as requireDiscoveryFeatureEnabled } from './feature-flags.mjs';
import { n as normalizeDiscoveryKeyword, c as createDiscoverySourceInputSchema, a as normalizeDiscoverySourceUrl, d as deriveDuplicateKey } from './discovery.mjs';

function stableStringify(value) {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    }
    const entries = Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`);
    return `{${entries.join(',')}}`;
}
function computeRawHash(rawPayload) {
    const serialized = stableStringify(rawPayload);
    return createHash('sha256').update(serialized).digest('hex');
}
function toDate(value) {
    if (!value)
        return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
async function persistDiscoveryItems(inputs) {
    if (!inputs.length) {
        return { inserted: [], duplicates: [] };
    }
    const db = getDb();
    const itemsWithHash = inputs.map((input) => ({
        input,
        rawHash: computeRawHash(input.rawPayload),
    }));
    const clientIds = new Set(itemsWithHash.map((item) => item.input.clientId));
    if (clientIds.size !== 1) {
        throw new Error('persistDiscoveryItems expects all inputs to share the same clientId');
    }
    const [clientId] = [...clientIds];
    const rawHashes = itemsWithHash.map((item) => item.rawHash);
    const existing = await db
        .select({ rawHash: discoveryItems.rawHash })
        .from(discoveryItems)
        .where(and(eq(discoveryItems.clientId, clientId), inArray(discoveryItems.rawHash, rawHashes)));
    const existingSet = new Set(existing.map((row) => row.rawHash));
    const toInsert = itemsWithHash.filter((item) => !existingSet.has(item.rawHash));
    const rows = toInsert.map(({ input, rawHash }) => ({
        id: randomUUID(),
        clientId: input.clientId,
        sourceId: input.sourceId,
        externalId: input.externalId,
        rawHash,
        status: 'pending_scoring',
        title: input.title,
        url: input.url,
        fetchedAt: new Date(input.fetchedAt),
        publishedAt: toDate(input.publishedAt),
        publishedAtSource: input.publishedAtSource,
        rawPayloadJson: input.rawPayload,
        normalizedJson: input.normalized,
        sourceMetadataJson: input.sourceMetadata,
    }));
    let inserted = [];
    if (rows.length) {
        inserted = await db
            .insert(discoveryItems)
            .values(rows)
            .returning({ id: discoveryItems.id, rawHash: discoveryItems.rawHash });
    }
    const duplicates = itemsWithHash
        .filter((item) => existingSet.has(item.rawHash))
        .map((item) => ({ rawHash: item.rawHash }));
    return { inserted, duplicates };
}
async function countPendingDiscoveryItems(clientId) {
    const db = getDb();
    const baseCondition = eq(discoveryItems.status, 'pending_scoring');
    const whereCondition = clientId ? and(baseCondition, eq(discoveryItems.clientId, clientId)) : baseCondition;
    const [row] = await db
        .select({ count: sql `count(*)` })
        .from(discoveryItems)
        .where(whereCondition);
    return Number(row?.count ?? 0);
}
async function fetchDiscoveryItemsByIds(ids) {
    if (!ids.length)
        return [];
    const db = getDb();
    return db
        .select()
        .from(discoveryItems)
        .where(inArray(discoveryItems.id, ids));
}
async function resetDiscoveryItemsToPending$1(itemIds) {
    if (!itemIds.length)
        return;
    const db = getDb();
    await db
        .update(discoveryItems)
        .set({ status: 'pending_scoring' })
        .where(inArray(discoveryItems.id, itemIds));
}
async function upsertDiscoveryScore(input) {
    const db = getDb();
    const scoredAt = input.scoredAt ?? new Date();
    await db.transaction(async (tx) => {
        const decimal = (value) => value.toString();
        const components = input.components ?? {
            keyword: input.keywordScore,
            recency: input.recencyScore,
            source: input.sourceScore,
        };
        const values = {
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
        };
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
        });
        await tx
            .update(discoveryItems)
            .set({ status: input.status })
            .where(eq(discoveryItems.id, input.itemId));
    });
}

var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, key + "" , value);
function coerceNumber(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}
function readStreakCount(health, expectedType) {
  if (!health || typeof health !== "object") {
    return 0;
  }
  const rawStreak = health.streak;
  if (!rawStreak || typeof rawStreak !== "object") {
    return 0;
  }
  if (rawStreak.type !== expectedType) {
    return 0;
  }
  return coerceNumber(rawStreak.count, 0);
}
function toIsoString(value) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
function buildHealthJson(snapshot, streak) {
  const payload = {
    status: snapshot.status,
    observedAt: snapshot.observedAt.toISOString(),
    lastFetchedAt: toIsoString(snapshot.lastFetchedAt),
    lastSuccessAt: toIsoString(snapshot.lastSuccessAt),
    consecutiveFailures: snapshot.consecutiveFailures,
    streak: {
      type: streak.type,
      count: streak.count,
      updatedAt: snapshot.observedAt.toISOString()
    }
  };
  if (snapshot.failureReason) {
    payload.failureReason = snapshot.failureReason;
  }
  if (snapshot.staleSince) {
    payload.staleSince = snapshot.staleSince.toISOString();
  }
  return payload;
}
class InvalidDiscoverySourceError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidDiscoverySourceError";
  }
}
class DuplicateDiscoverySourceError extends Error {
  constructor(message, duplicateKey) {
    super(message);
    __publicField(this, "duplicateKey");
    this.name = "DuplicateDiscoverySourceError";
    this.duplicateKey = duplicateKey;
  }
}
class InvalidDiscoveryKeywordError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidDiscoveryKeywordError";
  }
}
class DuplicateDiscoveryKeywordError extends Error {
  constructor(message) {
    super(message);
    this.name = "DuplicateDiscoveryKeywordError";
  }
}
class KeywordLimitExceededError extends Error {
  constructor(message) {
    super(message);
    this.name = "KeywordLimitExceededError";
  }
}
class DiscoveryKeywordNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = "DiscoveryKeywordNotFoundError";
  }
}
const deleteInputSchema = z.object({
  clientId: z.string().uuid(),
  sourceId: z.string().uuid()
});
const keywordInputSchema = z.object({
  clientId: z.string().uuid(),
  keyword: z.string(),
  addedBy: z.string().trim().min(1).optional()
});
const keywordUpdateSchema = z.object({
  clientId: z.string().uuid(),
  keywordId: z.string().uuid(),
  keyword: z.string()
});
const keywordDeleteSchema = z.object({
  clientId: z.string().uuid(),
  keywordId: z.string().uuid()
});
const KEYWORD_LIMIT = 20;
function computeNextFetchAt(completedAt, fetchIntervalMinutes, retryInMinutes) {
  const base = completedAt.getTime();
  const offsetMinutes = typeof retryInMinutes === "number" && retryInMinutes >= 0 ? retryInMinutes : fetchIntervalMinutes;
  return new Date(base + offsetMinutes * 6e4);
}
function buildConfigPayload(type, identifier) {
  if (type === "youtube-channel") {
    return { youtube: { channel: identifier } };
  }
  if (type === "youtube-playlist") {
    return { youtube: { playlist: identifier } };
  }
  if (type === "rss") {
    return { rss: { canonical: true } };
  }
  return null;
}
async function listDiscoverySources(clientId) {
  await requireDiscoveryFeatureEnabled(clientId);
  const db = getDb();
  return db.select().from(discoverySources).where(eq(discoverySources.clientId, clientId)).orderBy(desc(discoverySources.createdAt));
}
async function listDiscoverySourcesDue(limit, now = /* @__PURE__ */ new Date()) {
  const db = getDb();
  return db.select().from(discoverySources).where(and(
    or(isNull(discoverySources.nextFetchAt), lte(discoverySources.nextFetchAt, now)),
    ne(discoverySources.lastFetchStatus, "running")
  )).orderBy(discoverySources.nextFetchAt).limit(limit);
}
async function claimDiscoverySourceForFetch(sourceId, now = /* @__PURE__ */ new Date()) {
  const db = getDb();
  const [record] = await db.update(discoverySources).set({
    lastFetchStatus: "running",
    lastFetchStartedAt: now,
    updatedAt: now
  }).where(and(
    eq(discoverySources.id, sourceId),
    ne(discoverySources.lastFetchStatus, "running"),
    or(isNull(discoverySources.nextFetchAt), lte(discoverySources.nextFetchAt, now))
  )).returning();
  return record != null ? record : null;
}
async function completeDiscoverySourceFetch(input) {
  const db = getDb();
  const durationMs = Math.max(0, input.completedAt.getTime() - input.startedAt.getTime());
  const nextFetchAt = computeNextFetchAt(input.completedAt, input.fetchIntervalMinutes, input.retryInMinutes);
  return db.transaction(async (tx) => {
    var _a, _b, _c, _d, _e, _f, _g;
    const [current] = await tx.select({
      consecutiveFailureCount: discoverySources.consecutiveFailureCount,
      lastSuccessAt: discoverySources.lastSuccessAt,
      healthJson: discoverySources.healthJson
    }).from(discoverySources).where(eq(discoverySources.id, input.sourceId)).limit(1);
    const previousFailures = (_a = current == null ? void 0 : current.consecutiveFailureCount) != null ? _a : 0;
    const previousSuccessAt = (_b = current == null ? void 0 : current.lastSuccessAt) != null ? _b : null;
    const previousHealthJson = (_c = current == null ? void 0 : current.healthJson) != null ? _c : null;
    const nextFailures = input.success ? 0 : previousFailures + 1;
    const lastSuccessAt = input.success ? input.completedAt : previousSuccessAt;
    const status = input.success ? "healthy" : nextFailures >= 3 ? "error" : "warning";
    const failureReason = input.success ? null : (_d = input.failureReason) != null ? _d : null;
    const observedAt = input.completedAt;
    const streakType = input.success ? "success" : "failure";
    const streakCount = input.success ? readStreakCount(previousHealthJson, "success") + 1 : nextFailures;
    const snapshot = {
      status,
      observedAt,
      lastFetchedAt: input.completedAt,
      consecutiveFailures: nextFailures,
      lastSuccessAt,
      failureReason: failureReason != null ? failureReason : void 0
    };
    const healthJson = buildHealthJson(snapshot, { type: streakType, count: streakCount });
    await tx.insert(discoveryIngestRuns).values({
      id: crypto.randomUUID(),
      runId: input.runId,
      clientId: input.clientId,
      sourceId: input.sourceId,
      status: input.success ? "succeeded" : "failed",
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      durationMs,
      failureReason,
      retryInMinutes: (_e = input.retryInMinutes) != null ? _e : null,
      metricsJson: (_f = input.metrics) != null ? _f : {},
      telemetryJson: (_g = input.telemetry) != null ? _g : {},
      createdAt: /* @__PURE__ */ new Date()
    });
    await tx.update(discoverySources).set({
      lastFetchStatus: input.success ? "success" : "failure",
      lastFetchCompletedAt: input.completedAt,
      lastFailureReason: failureReason,
      nextFetchAt,
      updatedAt: observedAt,
      lastSuccessAt,
      consecutiveFailureCount: nextFailures,
      healthJson
    }).where(eq(discoverySources.id, input.sourceId));
    return snapshot;
  });
}
async function saveDiscoveryItems(input) {
  if (!input.items.length) {
    return { inserted: [], duplicates: [] };
  }
  const payloads = input.items.map(({ normalized, rawPayload, sourceMetadata }) => ({
    clientId: input.clientId,
    sourceId: input.sourceId,
    externalId: normalized.externalId,
    title: normalized.title,
    url: normalized.url,
    fetchedAt: normalized.fetchedAt,
    publishedAt: normalized.publishedAt,
    publishedAtSource: normalized.publishedAtSource,
    normalized,
    rawPayload,
    sourceMetadata
  }));
  return persistDiscoveryItems(payloads);
}
async function persistDiscoveryScores(inputs) {
  if (!inputs.length) return;
  await Promise.all(
    inputs.map(
      (input) => {
        var _a, _b;
        return upsertDiscoveryScore({
          itemId: input.itemId,
          score: input.score,
          keywordScore: input.keywordScore,
          recencyScore: input.recencyScore,
          sourceScore: input.sourceScore,
          appliedThreshold: input.appliedThreshold,
          status: input.status,
          weightsVersion: input.weightsVersion,
          components: (_a = input.components) != null ? _a : {
            keyword: input.keywordScore,
            recency: input.recencyScore,
            source: input.sourceScore
          },
          metadata: {
            clientId: input.clientId,
            sourceId: input.sourceId,
            ...(_b = input.metadata) != null ? _b : {}
          },
          scoredAt: input.scoredAt
        });
      }
    )
  );
}
async function resetDiscoveryItemsToPending(itemIds) {
  if (!itemIds.length) return;
  await resetDiscoveryItemsToPending$1(itemIds);
}
async function countPendingDiscoveryItemsForClient(clientId) {
  return countPendingDiscoveryItems(clientId);
}
async function fetchDiscoveryItemsForScoring(itemIds) {
  if (!itemIds.length) {
    return [];
  }
  const rows = await fetchDiscoveryItemsByIds(itemIds);
  return rows.map((row) => ({
    id: row.id,
    clientId: row.clientId,
    sourceId: row.sourceId,
    fetchedAt: row.fetchedAt,
    publishedAt: row.publishedAt,
    normalized: row.normalizedJson,
    sourceMetadata: row.sourceMetadataJson
  }));
}
async function releaseDiscoverySourceAfterFailedCompletion(input) {
  var _a, _b, _c, _d;
  const db = getDb();
  const nextFetchAt = computeNextFetchAt(input.completedAt, input.fetchIntervalMinutes, input.retryInMinutes);
  const [current] = await db.select({
    consecutiveFailureCount: discoverySources.consecutiveFailureCount,
    lastSuccessAt: discoverySources.lastSuccessAt,
    healthJson: discoverySources.healthJson
  }).from(discoverySources).where(eq(discoverySources.id, input.sourceId)).limit(1);
  const previousFailures = (_a = current == null ? void 0 : current.consecutiveFailureCount) != null ? _a : 0;
  const previousSuccessAt = (_b = current == null ? void 0 : current.lastSuccessAt) != null ? _b : null;
  const previousHealthJson = (_c = current == null ? void 0 : current.healthJson) != null ? _c : null;
  const nextFailures = input.success ? 0 : previousFailures + 1;
  const lastSuccessAt = input.success ? input.completedAt : previousSuccessAt;
  const status = input.success ? "healthy" : nextFailures >= 3 ? "error" : "warning";
  const failureReason = input.success ? null : (_d = input.failureReason) != null ? _d : null;
  const observedAt = input.completedAt;
  const streakType = input.success ? "success" : "failure";
  const streakCount = input.success ? readStreakCount(previousHealthJson, "success") + 1 : nextFailures;
  const snapshot = {
    status,
    observedAt,
    lastFetchedAt: input.completedAt,
    consecutiveFailures: nextFailures,
    lastSuccessAt,
    failureReason: failureReason != null ? failureReason : void 0
  };
  const healthJson = buildHealthJson(snapshot, { type: streakType, count: streakCount });
  await db.update(discoverySources).set({
    lastFetchStatus: input.success ? "success" : "failure",
    lastFetchCompletedAt: input.completedAt,
    lastFailureReason: failureReason,
    nextFetchAt,
    updatedAt: observedAt,
    lastSuccessAt,
    consecutiveFailureCount: nextFailures,
    healthJson
  }).where(eq(discoverySources.id, input.sourceId));
  return snapshot;
}
async function markStaleDiscoverySources(cutoff, now = /* @__PURE__ */ new Date()) {
  const db = getDb();
  const rows = await db.select({
    id: discoverySources.id,
    clientId: discoverySources.clientId,
    sourceType: discoverySources.sourceType,
    lastFetchCompletedAt: discoverySources.lastFetchCompletedAt,
    lastSuccessAt: discoverySources.lastSuccessAt,
    lastFailureReason: discoverySources.lastFailureReason,
    consecutiveFailureCount: discoverySources.consecutiveFailureCount,
    healthJson: discoverySources.healthJson,
    createdAt: discoverySources.createdAt
  }).from(discoverySources).where(and(
    ne(discoverySources.lastFetchStatus, "running"),
    or(
      and(isNull(discoverySources.lastFetchCompletedAt), lte(discoverySources.createdAt, cutoff)),
      lte(discoverySources.lastFetchCompletedAt, cutoff)
    )
  ));
  if (!rows.length) {
    return [];
  }
  const updates = [];
  await db.transaction(async (tx) => {
    var _a, _b, _c, _d, _e, _f;
    for (const row of rows) {
      const previousFailures = (_a = row.consecutiveFailureCount) != null ? _a : 0;
      const consecutiveFailures = previousFailures > 0 ? previousFailures : 1;
      const status = consecutiveFailures >= 3 ? "error" : "warning";
      const lastFetchedAt = (_b = row.lastFetchCompletedAt) != null ? _b : null;
      const lastSuccessAt = (_c = row.lastSuccessAt) != null ? _c : null;
      const staleSince = (_e = (_d = lastFetchedAt != null ? lastFetchedAt : lastSuccessAt) != null ? _d : row.createdAt) != null ? _e : cutoff;
      const failureReason = (_f = row.lastFailureReason) != null ? _f : void 0;
      const streakCount = readStreakCount(row.healthJson, "stale") + 1;
      const snapshot = {
        status,
        observedAt: now,
        lastFetchedAt,
        consecutiveFailures,
        lastSuccessAt,
        failureReason,
        staleSince
      };
      const healthJson = buildHealthJson(snapshot, { type: "stale", count: streakCount });
      await tx.update(discoverySources).set({
        consecutiveFailureCount: consecutiveFailures,
        updatedAt: now,
        healthJson
      }).where(eq(discoverySources.id, row.id));
      updates.push({
        clientId: row.clientId,
        sourceId: row.id,
        sourceType: row.sourceType,
        health: snapshot
      });
    }
  });
  return updates;
}
async function createDiscoverySource(input) {
  var _a, _b;
  const parsed = createDiscoverySourceInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvalidDiscoverySourceError(((_a = parsed.error.issues[0]) == null ? void 0 : _a.message) || "Invalid payload");
  }
  await requireDiscoveryFeatureEnabled(parsed.data.clientId);
  const normalized = (() => {
    try {
      return normalizeDiscoverySourceUrl(parsed.data.url);
    } catch (err) {
      throw new InvalidDiscoverySourceError(err.message);
    }
  })();
  const duplicateKey = deriveDuplicateKey(normalized);
  const db = getDb();
  const existing = await db.select({
    id: discoverySources.id,
    identifier: discoverySources.identifier
  }).from(discoverySources).where(and(
    eq(discoverySources.clientId, parsed.data.clientId),
    eq(discoverySources.sourceType, normalized.sourceType)
  ));
  const normalizedIdentifier = normalized.identifier.toLowerCase();
  const duplicateMatch = existing.find((record) => record.identifier.toLowerCase() === normalizedIdentifier);
  if (duplicateMatch) {
    throw new DuplicateDiscoverySourceError("Source already exists for this client", duplicateKey);
  }
  const now = /* @__PURE__ */ new Date();
  const id = crypto.randomUUID();
  const initialHealth = {
    status: "healthy",
    observedAt: now,
    lastFetchedAt: null,
    consecutiveFailures: 0,
    lastSuccessAt: null
  };
  const payload = {
    id,
    clientId: parsed.data.clientId,
    url: normalized.url,
    canonicalUrl: normalized.canonicalUrl,
    sourceType: normalized.sourceType,
    identifier: normalized.identifier,
    notes: ((_b = parsed.data.notes) == null ? void 0 : _b.trim()) || null,
    configJson: buildConfigPayload(normalized.sourceType, normalized.identifier),
    fetchIntervalMinutes: 60,
    nextFetchAt: now,
    lastFetchStatus: "idle",
    lastFetchStartedAt: null,
    lastFetchCompletedAt: null,
    lastFailureReason: null,
    lastSuccessAt: null,
    consecutiveFailureCount: 0,
    healthJson: buildHealthJson(initialHealth, { type: "success", count: 0 }),
    createdAt: now,
    updatedAt: now
  };
  try {
    await db.insert(discoverySources).values(payload);
  } catch (error) {
    if (isDuplicateSourceConstraint(error)) {
      throw new DuplicateDiscoverySourceError("Source already exists for this client", duplicateKey);
    }
    throw error;
  }
  return payload;
}
async function deleteDiscoverySource(input) {
  var _a, _b;
  const parsed = deleteInputSchema.parse(input);
  await requireDiscoveryFeatureEnabled(parsed.clientId);
  const db = getDb();
  const result = await db.delete(discoverySources).where(and(
    eq(discoverySources.clientId, parsed.clientId),
    eq(discoverySources.id, parsed.sourceId)
  )).returning({ id: discoverySources.id });
  return (_b = (_a = result[0]) == null ? void 0 : _a.id) != null ? _b : null;
}
function isDuplicateSourceConstraint(error) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = error.code;
  if (code !== "23505") {
    return false;
  }
  const constraint = error.constraint;
  if (typeof constraint !== "string") {
    return false;
  }
  return constraint === "discovery_sources_client_identifier_unique" || constraint === "discovery_sources_client_identifier_lower_unique";
}
function isDuplicateKeywordConstraint(error) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = error.code;
  if (code !== "23505") {
    return false;
  }
  const constraint = error.constraint;
  if (typeof constraint !== "string") {
    return false;
  }
  return constraint === "discovery_keywords_client_alias_unique";
}
function mapKeywordRecord(record) {
  var _a;
  return {
    id: record.id,
    clientId: record.clientId,
    keyword: record.keyword,
    addedBy: (_a = record.addedBy) != null ? _a : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}
async function fetchKeywordRecords(clientId) {
  await requireDiscoveryFeatureEnabled(clientId);
  const db = getDb();
  return db.select().from(discoveryKeywords).where(eq(discoveryKeywords.clientId, clientId)).orderBy(desc(discoveryKeywords.createdAt));
}
async function listDiscoveryKeywords(clientId) {
  const records = await fetchKeywordRecords(clientId);
  return records.map(mapKeywordRecord);
}
async function createDiscoveryKeyword(input) {
  var _a;
  const parsed = keywordInputSchema.parse(input);
  await requireDiscoveryFeatureEnabled(parsed.clientId);
  let normalized;
  try {
    normalized = normalizeDiscoveryKeyword(parsed.keyword);
  } catch (err) {
    throw new InvalidDiscoveryKeywordError(err.message);
  }
  const db = getDb();
  const existing = await fetchKeywordRecords(parsed.clientId);
  if (existing.length >= KEYWORD_LIMIT) {
    throw new KeywordLimitExceededError("Maximum of 20 keywords per client");
  }
  if (existing.some((entry) => entry.keywordAlias === normalized.duplicateKey)) {
    throw new DuplicateDiscoveryKeywordError("Keyword already exists for this client");
  }
  const now = /* @__PURE__ */ new Date();
  const record = {
    id: crypto.randomUUID(),
    clientId: parsed.clientId,
    keyword: normalized.canonical,
    keywordAlias: normalized.duplicateKey,
    addedBy: (_a = parsed.addedBy) != null ? _a : null,
    createdAt: now,
    updatedAt: now
  };
  try {
    await db.insert(discoveryKeywords).values(record);
  } catch (error) {
    if (isDuplicateKeywordConstraint(error)) {
      throw new DuplicateDiscoveryKeywordError("Keyword already exists for this client");
    }
    throw error;
  }
  return mapKeywordRecord(record);
}
async function updateDiscoveryKeyword(input) {
  const parsed = keywordUpdateSchema.parse(input);
  await requireDiscoveryFeatureEnabled(parsed.clientId);
  let normalized;
  try {
    normalized = normalizeDiscoveryKeyword(parsed.keyword);
  } catch (err) {
    throw new InvalidDiscoveryKeywordError(err.message);
  }
  const db = getDb();
  const records = await fetchKeywordRecords(parsed.clientId);
  const target = records.find((entry) => entry.id === parsed.keywordId);
  if (!target) {
    throw new DiscoveryKeywordNotFoundError("Keyword not found");
  }
  if (records.some((entry) => entry.id !== parsed.keywordId && entry.keywordAlias === normalized.duplicateKey)) {
    throw new DuplicateDiscoveryKeywordError("Keyword already exists for this client");
  }
  if (target.keyword === normalized.canonical) {
    return mapKeywordRecord(target);
  }
  const now = /* @__PURE__ */ new Date();
  let updated;
  try {
    ;
    [updated] = await db.update(discoveryKeywords).set({
      keyword: normalized.canonical,
      keywordAlias: normalized.duplicateKey,
      updatedAt: now
    }).where(and(
      eq(discoveryKeywords.clientId, parsed.clientId),
      eq(discoveryKeywords.id, parsed.keywordId)
    )).returning();
  } catch (error) {
    if (isDuplicateKeywordConstraint(error)) {
      throw new DuplicateDiscoveryKeywordError("Keyword already exists for this client");
    }
    throw error;
  }
  if (!updated) {
    throw new DiscoveryKeywordNotFoundError("Keyword not found");
  }
  return mapKeywordRecord(updated);
}
async function deleteDiscoveryKeyword(input) {
  var _a;
  const parsed = keywordDeleteSchema.parse(input);
  await requireDiscoveryFeatureEnabled(parsed.clientId);
  const db = getDb();
  const [deleted] = await db.delete(discoveryKeywords).where(and(
    eq(discoveryKeywords.clientId, parsed.clientId),
    eq(discoveryKeywords.id, parsed.keywordId)
  )).returning({ id: discoveryKeywords.id });
  return (_a = deleted == null ? void 0 : deleted.id) != null ? _a : null;
}

export { DuplicateDiscoveryKeywordError as D, InvalidDiscoveryKeywordError as I, KeywordLimitExceededError as K, DiscoveryKeywordNotFoundError as a, deleteDiscoverySource as b, createDiscoveryKeyword as c, deleteDiscoveryKeyword as d, listDiscoverySources as e, createDiscoverySource as f, InvalidDiscoverySourceError as g, DuplicateDiscoverySourceError as h, fetchDiscoveryItemsForScoring as i, listDiscoverySourcesDue as j, claimDiscoverySourceForFetch as k, listDiscoveryKeywords as l, completeDiscoverySourceFetch as m, countPendingDiscoveryItemsForClient as n, resetDiscoveryItemsToPending as o, persistDiscoveryScores as p, markStaleDiscoverySources as q, releaseDiscoverySourceAfterFailedCompletion as r, saveDiscoveryItems as s, updateDiscoveryKeyword as u };
//# sourceMappingURL=discovery-repository.mjs.map
