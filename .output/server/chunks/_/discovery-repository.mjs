import { g as getDb, j as discoveryKeywords, k as discoverySources, l as discoveryIngestRuns } from './index.mjs';
import { and, eq, desc, or, isNull, lte, ne } from 'drizzle-orm';
import { z } from 'zod';
import { r as requireDiscoveryFeatureEnabled } from './feature-flags.mjs';
import { n as normalizeDiscoveryKeyword, c as createDiscoverySourceInputSchema, a as normalizeDiscoverySourceUrl, d as deriveDuplicateKey } from './discovery.mjs';

var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, key + "" , value);
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
  await db.transaction(async (tx) => {
    var _a, _b, _c, _d;
    await tx.insert(discoveryIngestRuns).values({
      id: crypto.randomUUID(),
      runId: input.runId,
      clientId: input.clientId,
      sourceId: input.sourceId,
      status: input.success ? "succeeded" : "failed",
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      durationMs,
      failureReason: (_a = input.failureReason) != null ? _a : null,
      retryInMinutes: (_b = input.retryInMinutes) != null ? _b : null,
      telemetryJson: (_c = input.telemetry) != null ? _c : {},
      createdAt: /* @__PURE__ */ new Date()
    });
    await tx.update(discoverySources).set({
      lastFetchStatus: input.success ? "success" : "failure",
      lastFetchCompletedAt: input.completedAt,
      lastFailureReason: (_d = input.failureReason) != null ? _d : null,
      nextFetchAt,
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq(discoverySources.id, input.sourceId));
  });
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

export { DuplicateDiscoveryKeywordError as D, InvalidDiscoveryKeywordError as I, KeywordLimitExceededError as K, DiscoveryKeywordNotFoundError as a, deleteDiscoverySource as b, createDiscoveryKeyword as c, deleteDiscoveryKeyword as d, listDiscoverySources as e, createDiscoverySource as f, InvalidDiscoverySourceError as g, DuplicateDiscoverySourceError as h, listDiscoverySourcesDue as i, claimDiscoverySourceForFetch as j, completeDiscoverySourceFetch as k, listDiscoveryKeywords as l, updateDiscoveryKeyword as u };
//# sourceMappingURL=discovery-repository.mjs.map
