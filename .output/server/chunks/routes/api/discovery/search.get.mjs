import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { d as defineEventHandler, g as getQuery, c as createError } from '../../../nitro/nitro.mjs';
import { z, ZodError } from 'zod';
import { r as requireApiAuth } from '../../../_/api-auth.mjs';
import { r as requireUserSession, a as assertClientAccess } from '../../../_/session.mjs';
import { r as requireDiscoveryFeatureEnabled, c as requireFeatureEnabled, a as FEATURE_DISCOVERY_FILTERS_V1 } from '../../../_/feature-flags.mjs';
import { e as emitDiscoveryEvent } from '../../../_/discovery-events.mjs';
import { s as searchDiscoveryItems } from '../../../_/discovery-repository.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:url';
import '@upstash/redis';
import 'drizzle-orm';
import '../../../_/client.mjs';
import 'drizzle-orm/node-postgres';
import 'pg';
import 'drizzle-orm/pg-core';
import '../../../_/discovery.mjs';

const ALLOWED_PAGE_SIZES = [25, 50, 100];
const discoverySearchStatusSchema = z.string().trim().min(1).transform((value) => value.toLowerCase()).pipe(z.enum(["spotted", "approved", "suppressed", "archived", "pending", "promoted"]));
const discoverySearchFiltersSchema = z.object({
  clientId: z.string().uuid(),
  statuses: z.array(discoverySearchStatusSchema).default(["spotted"]),
  sourceIds: z.array(z.string().uuid()).default([]),
  topics: z.array(z.string().trim().min(1)).default([]),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine((value) => ALLOWED_PAGE_SIZES.includes(value), {
    message: `pageSize must be one of ${ALLOWED_PAGE_SIZES.join(", ")}`
  }).default(25),
  searchTerm: z.string().trim().min(2).max(160).optional()
});
function toArray(value) {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => typeof entry === "string" ? entry.split(",") : []).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  }
  if (typeof value === "string") {
    return value.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  }
  return [];
}
function firstString(value) {
  if (Array.isArray(value)) {
    const match = value.find((entry) => typeof entry === "string" && entry.length > 0);
    return (match == null ? void 0 : match.trim()) || void 0;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : void 0;
  }
  return void 0;
}
function parseDiscoverySearchFilters(query) {
  var _a, _b, _c, _d, _e;
  const parsed = discoverySearchFiltersSchema.parse({
    clientId: firstString(query.clientId),
    statuses: toArray((_a = query.status) != null ? _a : query.statuses),
    sourceIds: toArray((_c = (_b = query.sourceId) != null ? _b : query.sourceIds) != null ? _c : query.sources),
    topics: toArray((_d = query.topic) != null ? _d : query.topics),
    dateFrom: firstString(query.dateFrom),
    dateTo: firstString(query.dateTo),
    page: firstString(query.page),
    pageSize: firstString(query.pageSize),
    searchTerm: firstString((_e = query.searchTerm) != null ? _e : query.search)
  });
  if (parsed.statuses.length === 0) {
    parsed.statuses = ["spotted"];
  }
  return parsed;
}
const discoverySearchHighlightSchema = z.object({
  field: z.enum(["title", "excerpt", "body"]),
  snippets: z.array(z.string().min(1)).max(5)
});
const discoverySearchItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  url: z.string().url(),
  status: discoverySearchStatusSchema,
  score: z.number().min(0).max(1).nullable(),
  sourceId: z.string().uuid(),
  fetchedAt: z.string().datetime(),
  publishedAt: z.string().datetime().nullable(),
  ingestedAt: z.string().datetime(),
  summary: z.string().nullable(),
  topics: z.array(z.string()),
  highlights: z.array(discoverySearchHighlightSchema)
});
z.object({
  items: z.array(discoverySearchItemSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  latencyMs: z.number().min(0)
});

const DEGRADE_LATENCY_THRESHOLD_MS = 400;
const DEGRADE_TOTAL_RESULTS_THRESHOLD = 1e3;
const search_get = defineEventHandler(async (event) => {
  var _a, _b, _c, _d;
  requireApiAuth(event);
  const sessionUser = requireUserSession(event);
  const rawQuery = getQuery(event);
  let filters;
  try {
    filters = parseDiscoverySearchFilters(rawQuery);
  } catch (error) {
    if (error instanceof ZodError) {
      throw createError({
        statusCode: 400,
        statusMessage: "Invalid discovery search parameters",
        data: { issues: error.issues }
      });
    }
    throw error;
  }
  assertClientAccess(sessionUser, filters.clientId);
  await requireDiscoveryFeatureEnabled(filters.clientId);
  await requireFeatureEnabled(filters.clientId, FEATURE_DISCOVERY_FILTERS_V1, "Discovery filters are disabled for this client.");
  const requestId = randomUUID();
  const requestedAtIso = (/* @__PURE__ */ new Date()).toISOString();
  const startedAt = performance.now();
  emitDiscoveryEvent({
    type: "discovery.search.requested",
    version: 1,
    payload: {
      requestId,
      clientId: filters.clientId,
      requestedBy: sessionUser.id,
      page: filters.page,
      pageSize: filters.pageSize,
      statuses: filters.statuses,
      sourceCount: filters.sourceIds.length,
      topicCount: filters.topics.length,
      hasSearchTerm: Boolean(filters.searchTerm),
      searchTermLength: (_b = (_a = filters.searchTerm) == null ? void 0 : _a.length) != null ? _b : 0,
      requestedAt: requestedAtIso
    }
  });
  const result = await searchDiscoveryItems(filters);
  const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
  let degradeReason = null;
  if (latencyMs > DEGRADE_LATENCY_THRESHOLD_MS) {
    degradeReason = "latency";
  } else if (result.total > DEGRADE_TOTAL_RESULTS_THRESHOLD) {
    degradeReason = "results";
  }
  const completedAtIso = (/* @__PURE__ */ new Date()).toISOString();
  emitDiscoveryEvent({
    type: "discovery.search.completed",
    version: 1,
    payload: {
      requestId,
      clientId: filters.clientId,
      latencyMs,
      total: result.total,
      returned: result.items.length,
      page: filters.page,
      pageSize: filters.pageSize,
      statuses: filters.statuses,
      sourceCount: filters.sourceIds.length,
      topicCount: filters.topics.length,
      searchTermLength: (_d = (_c = filters.searchTerm) == null ? void 0 : _c.length) != null ? _d : 0,
      degraded: degradeReason !== null,
      degradeReason,
      completedAt: completedAtIso
    }
  });
  return {
    items: result.items,
    total: result.total,
    page: filters.page,
    pageSize: filters.pageSize,
    latencyMs
  };
});

export { search_get as default };
//# sourceMappingURL=search.get.mjs.map
