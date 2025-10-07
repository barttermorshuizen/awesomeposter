import { randomUUID } from 'node:crypto';
import { d as defineEventHandler, g as getQuery, c as createError, e as setHeader } from '../../../nitro/nitro.mjs';
import { z } from 'zod';
import { r as requireApiAuth } from '../../../_/api-auth.mjs';
import { r as requireUserSession, a as assertClientAccess } from '../../../_/session.mjs';
import { r as requireDiscoveryFeatureEnabled, s as subscribeToFeatureFlagUpdates, F as FEATURE_DISCOVERY_AGENT } from '../../../_/feature-flags.mjs';
import { o as onDiscoveryEvent } from '../../../_/discovery-events.mjs';
import { b as discoverySourceTypeSchema, e as discoveryIngestionFailureReasonSchema } from '../../../_/discovery.mjs';
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

z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  url: z.string().url(),
  canonicalUrl: z.string().url(),
  sourceType: discoverySourceTypeSchema,
  identifier: z.string(),
  notes: z.string().optional().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});
const discoverySourceCreatedEventSchema = z.object({
  type: z.literal("source-created"),
  version: z.number().int().min(1),
  payload: z.object({
    id: z.string().uuid(),
    clientId: z.string().uuid(),
    url: z.string().url(),
    canonicalUrl: z.string().url(),
    sourceType: discoverySourceTypeSchema,
    identifier: z.string(),
    createdAt: z.string()
  })
});
const ingestionStartedEventSchema = z.object({
  type: z.literal("ingestion.started"),
  version: z.number().int().min(1),
  payload: z.object({
    runId: z.string().min(1),
    clientId: z.string().uuid(),
    sourceId: z.string().uuid(),
    sourceType: discoverySourceTypeSchema,
    scheduledAt: z.string(),
    startedAt: z.string()
  })
});
const ingestionAttemptSchema = z.object({
  attempt: z.number().int().min(1),
  startedAt: z.string(),
  completedAt: z.string(),
  durationMs: z.number().int().min(0),
  success: z.boolean(),
  failureReason: discoveryIngestionFailureReasonSchema.optional(),
  retryInMinutes: z.number().int().min(0).nullable().optional(),
  nextRetryAt: z.string().nullable().optional(),
  retryReason: z.enum(["transient", "permanent", "exhausted", "none"]).optional(),
  retryAfterOverride: z.boolean().optional()
});
const ingestionCompletedEventSchema = z.object({
  type: z.literal("ingestion.completed"),
  version: z.number().int().min(1),
  payload: z.object({
    runId: z.string().min(1),
    clientId: z.string().uuid(),
    sourceId: z.string().uuid(),
    sourceType: discoverySourceTypeSchema,
    startedAt: z.string(),
    completedAt: z.string(),
    durationMs: z.number().int().min(0),
    success: z.boolean(),
    failureReason: discoveryIngestionFailureReasonSchema.optional(),
    retryInMinutes: z.number().int().min(0).nullable().optional(),
    attempt: z.number().int().min(1).optional(),
    maxAttempts: z.number().int().min(1).optional(),
    attempts: z.array(ingestionAttemptSchema).optional(),
    nextRetryAt: z.string().optional()
  })
});
const ingestionFailedEventSchema = z.object({
  type: z.literal("ingestion.failed"),
  version: z.number().int().min(1),
  payload: z.object({
    runId: z.string().min(1),
    clientId: z.string().uuid(),
    sourceId: z.string().uuid(),
    sourceType: discoverySourceTypeSchema,
    failureReason: discoveryIngestionFailureReasonSchema,
    attempt: z.number().int().min(1),
    maxAttempts: z.number().int().min(1),
    retryInMinutes: z.number().int().min(0).nullable().optional(),
    nextRetryAt: z.string().optional()
  })
});
const sourceHealthPayloadSchema = z.object({
  clientId: z.string().uuid(),
  sourceId: z.string().uuid(),
  sourceType: discoverySourceTypeSchema,
  status: z.enum(["healthy", "warning", "error"]),
  lastFetchedAt: z.string().nullable(),
  failureReason: discoveryIngestionFailureReasonSchema.optional(),
  observedAt: z.string(),
  consecutiveFailures: z.number().int().min(0).optional(),
  attempt: z.number().int().min(1).optional(),
  staleSince: z.string().nullable().optional()
});
const sourceHealthEventSchema = z.object({
  type: z.literal("source.health"),
  version: z.number().int().min(1),
  payload: sourceHealthPayloadSchema
});
const discoveryKeywordUpdatedEventSchema = z.object({
  type: z.literal("keyword.updated"),
  version: z.number().int().min(1),
  payload: z.object({
    clientId: z.string().uuid(),
    keywords: z.array(z.string().min(1)),
    updatedAt: z.string()
  })
});
const discoveryScoreCompleteEventSchema = z.object({
  type: z.literal("discovery.score.complete"),
  version: z.number().int().min(1),
  payload: z.object({
    clientId: z.string().uuid(),
    itemId: z.string().uuid(),
    sourceId: z.string().uuid(),
    score: z.number().min(0).max(1),
    status: z.enum(["scored", "suppressed"]),
    components: z.object({
      keyword: z.number().min(0).max(1),
      recency: z.number().min(0).max(1),
      source: z.number().min(0).max(1)
    }).catchall(z.number()),
    appliedThreshold: z.number().min(0).max(1),
    weightsVersion: z.number().int().min(1),
    scoredAt: z.string()
  })
});
const discoveryQueueUpdatedEventSchema = z.object({
  type: z.literal("discovery.queue.updated"),
  version: z.number().int().min(1),
  payload: z.object({
    clientId: z.string().uuid(),
    pendingCount: z.number().int().min(0),
    scoredDelta: z.number().int().min(0).optional(),
    suppressedDelta: z.number().int().min(0).optional(),
    updatedAt: z.string(),
    reason: z.enum(["scoring", "backlog", "manual"]).optional()
  })
});
const discoveryScoringFailedEventSchema = z.object({
  type: z.literal("discovery.scoring.failed"),
  version: z.number().int().min(1),
  payload: z.object({
    clientId: z.string().uuid(),
    itemIds: z.array(z.string().uuid()).optional(),
    errorCode: z.string(),
    errorMessage: z.string(),
    details: z.record(z.unknown()).optional(),
    occurredAt: z.string()
  })
});
const discoverySearchRequestedEventSchema = z.object({
  type: z.literal("discovery.search.requested"),
  version: z.number().int().min(1),
  payload: z.object({
    requestId: z.string().uuid(),
    clientId: z.string().uuid(),
    requestedBy: z.string().uuid().optional(),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    statuses: z.array(z.string().min(1)).min(1),
    sourceCount: z.number().int().min(0),
    topicCount: z.number().int().min(0),
    hasSearchTerm: z.boolean(),
    searchTermLength: z.number().int().min(0).max(160),
    requestedAt: z.string()
  })
});
const discoverySearchCompletedEventSchema = z.object({
  type: z.literal("discovery.search.completed"),
  version: z.number().int().min(1),
  payload: z.object({
    requestId: z.string().uuid(),
    clientId: z.string().uuid(),
    latencyMs: z.number().min(0),
    total: z.number().int().min(0),
    returned: z.number().int().min(0),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    statuses: z.array(z.string().min(1)).min(1),
    sourceCount: z.number().int().min(0),
    topicCount: z.number().int().min(0),
    searchTermLength: z.number().int().min(0).max(160),
    degraded: z.boolean(),
    degradeReason: z.enum(["latency", "results", "other"]).nullable().optional(),
    completedAt: z.string()
  })
});
z.union([
  discoverySourceCreatedEventSchema,
  ingestionStartedEventSchema,
  ingestionCompletedEventSchema,
  ingestionFailedEventSchema,
  sourceHealthEventSchema,
  discoveryKeywordUpdatedEventSchema,
  discoveryScoreCompleteEventSchema,
  discoveryQueueUpdatedEventSchema,
  discoveryScoringFailedEventSchema,
  discoverySearchRequestedEventSchema,
  discoverySearchCompletedEventSchema
]);
const DISCOVERY_TELEMETRY_SCHEMA_VERSION = 1;
const discoverySourceCreatedTelemetrySchema = z.object({
  schemaVersion: z.literal(DISCOVERY_TELEMETRY_SCHEMA_VERSION),
  eventType: z.literal("source-created"),
  clientId: z.string().uuid(),
  entityId: z.string().uuid(),
  timestamp: z.string(),
  payload: discoverySourceCreatedEventSchema.shape.payload
});
const discoveryKeywordUpdatedTelemetrySchema = z.object({
  schemaVersion: z.literal(DISCOVERY_TELEMETRY_SCHEMA_VERSION),
  eventType: z.literal("keyword.updated"),
  clientId: z.string().uuid(),
  entityId: z.string().uuid(),
  timestamp: z.string(),
  payload: discoveryKeywordUpdatedEventSchema.shape.payload
});
const discoveryScoreCompleteTelemetrySchema = z.object({
  schemaVersion: z.literal(DISCOVERY_TELEMETRY_SCHEMA_VERSION),
  eventType: z.literal("discovery.score.complete"),
  clientId: z.string().uuid(),
  entityId: z.string().uuid(),
  timestamp: z.string(),
  payload: discoveryScoreCompleteEventSchema.shape.payload
});
const discoveryQueueUpdatedTelemetrySchema = z.object({
  schemaVersion: z.literal(DISCOVERY_TELEMETRY_SCHEMA_VERSION),
  eventType: z.literal("discovery.queue.updated"),
  clientId: z.string().uuid(),
  entityId: z.string().uuid(),
  timestamp: z.string(),
  payload: discoveryQueueUpdatedEventSchema.shape.payload
});
const discoveryScoringFailedTelemetrySchema = z.object({
  schemaVersion: z.literal(DISCOVERY_TELEMETRY_SCHEMA_VERSION),
  eventType: z.literal("discovery.scoring.failed"),
  clientId: z.string().uuid(),
  entityId: z.string().uuid(),
  timestamp: z.string(),
  payload: discoveryScoringFailedEventSchema.shape.payload
});
z.discriminatedUnion("eventType", [
  discoverySourceCreatedTelemetrySchema,
  discoveryKeywordUpdatedTelemetrySchema,
  discoveryScoreCompleteTelemetrySchema,
  discoveryQueueUpdatedTelemetrySchema,
  discoveryScoringFailedTelemetrySchema,
  z.object({
    schemaVersion: z.literal(DISCOVERY_TELEMETRY_SCHEMA_VERSION),
    eventType: z.literal("ingestion.started"),
    clientId: z.string().uuid(),
    entityId: z.string().uuid(),
    timestamp: z.string(),
    payload: ingestionStartedEventSchema.shape.payload
  }),
  z.object({
    schemaVersion: z.literal(DISCOVERY_TELEMETRY_SCHEMA_VERSION),
    eventType: z.literal("ingestion.completed"),
    clientId: z.string().uuid(),
    entityId: z.string().uuid(),
    timestamp: z.string(),
    payload: ingestionCompletedEventSchema.shape.payload
  }),
  z.object({
    schemaVersion: z.literal(DISCOVERY_TELEMETRY_SCHEMA_VERSION),
    eventType: z.literal("ingestion.failed"),
    clientId: z.string().uuid(),
    entityId: z.string().uuid(),
    timestamp: z.string(),
    payload: ingestionFailedEventSchema.shape.payload
  }),
  z.object({
    schemaVersion: z.literal(DISCOVERY_TELEMETRY_SCHEMA_VERSION),
    eventType: z.literal("source.health"),
    clientId: z.string().uuid(),
    entityId: z.string().uuid(),
    timestamp: z.string(),
    payload: sourceHealthEventSchema.shape.payload
  }),
  z.object({
    schemaVersion: z.literal(DISCOVERY_TELEMETRY_SCHEMA_VERSION),
    eventType: z.literal("discovery.search.requested"),
    clientId: z.string().uuid(),
    entityId: z.string().uuid(),
    timestamp: z.string(),
    payload: discoverySearchRequestedEventSchema.shape.payload
  }),
  z.object({
    schemaVersion: z.literal(DISCOVERY_TELEMETRY_SCHEMA_VERSION),
    eventType: z.literal("discovery.search.completed"),
    clientId: z.string().uuid(),
    entityId: z.string().uuid(),
    timestamp: z.string(),
    payload: discoverySearchCompletedEventSchema.shape.payload
  })
]);

function toDiscoveryTelemetryEvent(envelope) {
  var _a;
  switch (envelope.type) {
    case "source-created":
      return {
        schemaVersion: DISCOVERY_TELEMETRY_SCHEMA_VERSION,
        eventType: "source-created",
        clientId: envelope.payload.clientId,
        entityId: envelope.payload.id,
        timestamp: envelope.payload.createdAt,
        payload: envelope.payload
      };
    case "ingestion.started":
      return {
        schemaVersion: DISCOVERY_TELEMETRY_SCHEMA_VERSION,
        eventType: "ingestion.started",
        clientId: envelope.payload.clientId,
        entityId: envelope.payload.sourceId,
        timestamp: envelope.payload.startedAt,
        payload: envelope.payload
      };
    case "ingestion.completed":
      return {
        schemaVersion: DISCOVERY_TELEMETRY_SCHEMA_VERSION,
        eventType: "ingestion.completed",
        clientId: envelope.payload.clientId,
        entityId: envelope.payload.sourceId,
        timestamp: envelope.payload.completedAt,
        payload: envelope.payload
      };
    case "ingestion.failed":
      return {
        schemaVersion: DISCOVERY_TELEMETRY_SCHEMA_VERSION,
        eventType: "ingestion.failed",
        clientId: envelope.payload.clientId,
        entityId: envelope.payload.sourceId,
        timestamp: (_a = envelope.payload.nextRetryAt) != null ? _a : (/* @__PURE__ */ new Date()).toISOString(),
        payload: envelope.payload
      };
    case "source.health":
      return {
        schemaVersion: DISCOVERY_TELEMETRY_SCHEMA_VERSION,
        eventType: "source.health",
        clientId: envelope.payload.clientId,
        entityId: envelope.payload.sourceId,
        timestamp: envelope.payload.observedAt,
        payload: envelope.payload
      };
    case "keyword.updated":
      return {
        schemaVersion: DISCOVERY_TELEMETRY_SCHEMA_VERSION,
        eventType: "keyword.updated",
        clientId: envelope.payload.clientId,
        entityId: envelope.payload.clientId,
        timestamp: envelope.payload.updatedAt,
        payload: envelope.payload
      };
    case "discovery.score.complete":
      return {
        schemaVersion: DISCOVERY_TELEMETRY_SCHEMA_VERSION,
        eventType: "discovery.score.complete",
        clientId: envelope.payload.clientId,
        entityId: envelope.payload.itemId,
        timestamp: envelope.payload.scoredAt,
        payload: envelope.payload
      };
    case "discovery.queue.updated":
      return {
        schemaVersion: DISCOVERY_TELEMETRY_SCHEMA_VERSION,
        eventType: "discovery.queue.updated",
        clientId: envelope.payload.clientId,
        entityId: envelope.payload.clientId,
        timestamp: envelope.payload.updatedAt,
        payload: envelope.payload
      };
    case "discovery.scoring.failed":
      return {
        schemaVersion: DISCOVERY_TELEMETRY_SCHEMA_VERSION,
        eventType: "discovery.scoring.failed",
        clientId: envelope.payload.clientId,
        entityId: envelope.payload.clientId,
        timestamp: envelope.payload.occurredAt,
        payload: envelope.payload
      };
    case "discovery.search.requested":
      return {
        schemaVersion: DISCOVERY_TELEMETRY_SCHEMA_VERSION,
        eventType: "discovery.search.requested",
        clientId: envelope.payload.clientId,
        entityId: envelope.payload.requestId,
        timestamp: envelope.payload.requestedAt,
        payload: envelope.payload
      };
    case "discovery.search.completed":
      return {
        schemaVersion: DISCOVERY_TELEMETRY_SCHEMA_VERSION,
        eventType: "discovery.search.completed",
        clientId: envelope.payload.clientId,
        entityId: envelope.payload.requestId,
        timestamp: envelope.payload.completedAt,
        payload: envelope.payload
      };
    default:
      return null;
  }
}

const CONNECTION_LIMIT_PER_USER = 5;
const HEARTBEAT_INTERVAL_MS = 3e4;
const RETRY_DELAY_MS = 5e3;
const querySchema = z.object({
  clientId: z.string().uuid()
});
const userConnections = /* @__PURE__ */ new Map();
function getConnectionSet(userId) {
  let set = userConnections.get(userId);
  if (!set) {
    set = /* @__PURE__ */ new Set();
    userConnections.set(userId, set);
  }
  return set;
}
function ensureCapacity(connection) {
  const set = getConnectionSet(connection.userId);
  if (set.size >= CONNECTION_LIMIT_PER_USER) {
    console.warn(JSON.stringify({
      event: "discovery.sse.rate_limited",
      userId: connection.userId,
      clientId: connection.clientId,
      attemptedAt: (/* @__PURE__ */ new Date()).toISOString(),
      activeConnections: set.size
    }));
    throw createError({ statusCode: 429, statusMessage: "Too many concurrent SSE connections" });
  }
  return set;
}
function registerConnection(connection) {
  const set = ensureCapacity(connection);
  set.add(connection);
  return set;
}
function releaseConnection(connection) {
  const set = userConnections.get(connection.userId);
  if (!set) return;
  set.delete(connection);
  if (set.size === 0) {
    userConnections.delete(connection.userId);
  }
}
function writeEvent(res, event) {
  res.write(`data: ${JSON.stringify(event)}

`);
}
const discoverySseHandler = defineEventHandler(async (event) => {
  var _a;
  requireApiAuth(event);
  const sessionUser = requireUserSession(event);
  const rawQuery = getQuery(event);
  const parseResult = querySchema.safeParse(rawQuery);
  if (!parseResult.success) {
    throw createError({ statusCode: 400, statusMessage: "clientId is required and must be a UUID" });
  }
  const clientId = parseResult.data.clientId;
  assertClientAccess(sessionUser, clientId);
  await requireDiscoveryFeatureEnabled(clientId);
  const userId = sessionUser.id;
  const connectionId = randomUUID();
  const startedAt = Date.now();
  const connection = {
    id: connectionId,
    clientId,
    userId,
    startedAt
  };
  registerConnection(connection);
  const res = event.node.res;
  let heartbeat = null;
  try {
    setHeader(event, "Content-Type", "text/event-stream; charset=utf-8");
    setHeader(event, "Cache-Control", "no-cache, no-transform");
    setHeader(event, "Connection", "keep-alive");
    res.write(`retry: ${RETRY_DELAY_MS}
`);
    res.write(`: connected ${(/* @__PURE__ */ new Date()).toISOString()}

`);
    (_a = res.flushHeaders) == null ? void 0 : _a.call(res);
    event._handled = true;
    heartbeat = setInterval(() => {
      res.write(": heartbeat\n\n");
    }, HEARTBEAT_INTERVAL_MS);
  } catch (error) {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    releaseConnection(connection);
    throw error;
  }
  console.info(JSON.stringify({
    event: "discovery.sse.connected",
    connectionId,
    clientId,
    userId,
    connectedAt: new Date(startedAt).toISOString(),
    activeConnections: getConnectionSet(userId).size
  }));
  const sendTelemetry = (payload) => {
    try {
      writeEvent(res, payload);
    } catch (error) {
      console.error("Failed to write discovery SSE event", { error });
    }
  };
  const unsubscribeEvents = onDiscoveryEvent((envelope) => {
    const telemetry = toDiscoveryTelemetryEvent(envelope);
    if (!telemetry) return;
    if (telemetry.clientId !== clientId) return;
    sendTelemetry(telemetry);
  });
  const unsubscribeFlags = subscribeToFeatureFlagUpdates((payload) => {
    if (payload.feature !== FEATURE_DISCOVERY_AGENT) return;
    if (payload.clientId !== clientId) return;
    if (payload.enabled === false) {
      res.write("event: feature_disabled\n");
      res.write(`data: ${JSON.stringify({ reason: "discovery-disabled" })}

`);
      cleanup();
    }
  });
  let closed = false;
  function cleanup() {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    unsubscribeEvents();
    unsubscribeFlags();
    releaseConnection(connection);
    const durationMs = Date.now() - startedAt;
    console.info(JSON.stringify({
      event: "discovery.sse.disconnected",
      connectionId,
      clientId,
      userId,
      disconnectedAt: (/* @__PURE__ */ new Date()).toISOString(),
      durationMs
    }));
    try {
      res.end();
    } catch {
    }
  }
  event.node.req.on("close", cleanup);
  event.node.req.on("aborted", cleanup);
  event.node.req.on("end", cleanup);
  res.on("close", cleanup);
  res.on("error", cleanup);
});

export { discoverySseHandler as default };
//# sourceMappingURL=discovery.get.mjs.map
