import { z } from 'zod'
import { discoverySourceTypeSchema, discoveryIngestionFailureReasonSchema } from './discovery.js'

export const discoverySourceSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  url: z.string().url(),
  canonicalUrl: z.string().url(),
  sourceType: discoverySourceTypeSchema,
  identifier: z.string(),
  notes: z.string().optional().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type DiscoverySource = z.infer<typeof discoverySourceSchema>

export const discoverySourceCreatedEventSchema = z.object({
  type: z.literal('source-created'),
  version: z.number().int().min(1),
  payload: z.object({
    id: z.string().uuid(),
    clientId: z.string().uuid(),
    url: z.string().url(),
    canonicalUrl: z.string().url(),
    sourceType: discoverySourceTypeSchema,
    identifier: z.string(),
    createdAt: z.string(),
  }),
})

export type DiscoverySourceCreatedEvent = z.infer<typeof discoverySourceCreatedEventSchema>

const discoveryWebListSelectorSchema = z.object({
  selector: z.string().min(1),
  attribute: z.string().min(1).optional(),
  valueTemplate: z.string().min(1).optional(),
}).passthrough()

const discoveryWebListFieldsSchema = z.object({
  title: discoveryWebListSelectorSchema.optional(),
  url: discoveryWebListSelectorSchema.optional(),
  excerpt: discoveryWebListSelectorSchema.optional(),
  timestamp: discoveryWebListSelectorSchema.optional(),
}).partial().passthrough()

const discoveryWebListPaginationSchema = z.object({
  nextPage: discoveryWebListSelectorSchema,
  maxDepth: z.number().int().min(1).max(20),
}).passthrough()

const discoveryWebListConfigSchema = z.object({
  listContainerSelector: z.string().min(1),
  itemSelector: z.string().min(1),
  fields: discoveryWebListFieldsSchema.default({}),
  pagination: discoveryWebListPaginationSchema.optional(),
}).passthrough()

export const discoverySourceUpdatedEventSchema = z.object({
  type: z.literal('source.updated'),
  version: z.number().int().min(1),
  payload: z.object({
    sourceId: z.string().uuid(),
    clientId: z.string().uuid(),
    sourceType: discoverySourceTypeSchema,
    updatedAt: z.string(),
    webListEnabled: z.boolean(),
    webListConfig: discoveryWebListConfigSchema.nullable(),
    warnings: z.array(z.string()).optional(),
    suggestion: z.object({
      id: z.string(),
      config: discoveryWebListConfigSchema,
      warnings: z.array(z.string()).optional(),
      confidence: z.number().min(0).max(1).nullable().optional(),
      receivedAt: z.string(),
    }).nullable().optional(),
  }),
})

export type DiscoverySourceUpdatedEvent = z.infer<typeof discoverySourceUpdatedEventSchema>

export const ingestionStartedEventSchema = z.object({
  type: z.literal('ingestion.started'),
  version: z.number().int().min(1),
  payload: z.object({
    runId: z.string().min(1),
    clientId: z.string().uuid(),
    sourceId: z.string().uuid(),
    sourceType: discoverySourceTypeSchema,
    scheduledAt: z.string(),
    startedAt: z.string(),
  }),
})

export type IngestionStartedEvent = z.infer<typeof ingestionStartedEventSchema>

const ingestionAttemptSchema = z.object({
  attempt: z.number().int().min(1),
  startedAt: z.string(),
  completedAt: z.string(),
  durationMs: z.number().int().min(0),
  success: z.boolean(),
  failureReason: discoveryIngestionFailureReasonSchema.optional(),
  retryInMinutes: z.number().int().min(0).nullable().optional(),
  nextRetryAt: z.string().nullable().optional(),
  retryReason: z.enum(['transient', 'permanent', 'exhausted', 'none']).optional(),
  retryAfterOverride: z.boolean().optional(),
})

export const ingestionCompletedEventSchema = z.object({
  type: z.literal('ingestion.completed'),
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
    nextRetryAt: z.string().optional(),
  }),
})

export type IngestionCompletedEvent = z.infer<typeof ingestionCompletedEventSchema>

export const ingestionFailedEventSchema = z.object({
  type: z.literal('ingestion.failed'),
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
    nextRetryAt: z.string().optional(),
  }),
})

export type IngestionFailedEvent = z.infer<typeof ingestionFailedEventSchema>

const sourceHealthPayloadSchema = z.object({
  clientId: z.string().uuid(),
  sourceId: z.string().uuid(),
  sourceType: discoverySourceTypeSchema,
  status: z.enum(['healthy', 'warning', 'error']),
  lastFetchedAt: z.string().nullable(),
  failureReason: discoveryIngestionFailureReasonSchema.optional(),
  observedAt: z.string(),
  consecutiveFailures: z.number().int().min(0).optional(),
  attempt: z.number().int().min(1).optional(),
  staleSince: z.string().nullable().optional(),
})

export const sourceHealthEventSchema = z.object({
  type: z.literal('source.health'),
  version: z.number().int().min(1),
  payload: sourceHealthPayloadSchema,
})

export type SourceHealthEvent = z.infer<typeof sourceHealthEventSchema>

export const discoveryKeywordUpdatedEventSchema = z.object({
  type: z.literal('keyword.updated'),
  version: z.number().int().min(1),
  payload: z.object({
    clientId: z.string().uuid(),
    keywords: z.array(z.string().min(1)),
    updatedAt: z.string(),
  }),
})

export type DiscoveryKeywordUpdatedEvent = z.infer<typeof discoveryKeywordUpdatedEventSchema>

export const discoveryScoreCompleteEventSchema = z.object({
  type: z.literal('discovery.score.complete'),
  version: z.number().int().min(1),
  payload: z.object({
    clientId: z.string().uuid(),
    itemId: z.string().uuid(),
    sourceId: z.string().uuid(),
    score: z.number().min(0).max(1),
    status: z.enum(['scored', 'suppressed']),
    components: z.object({
      keyword: z.number().min(0).max(1),
      recency: z.number().min(0).max(1),
      source: z.number().min(0).max(1),
    }).catchall(z.number()),
    appliedThreshold: z.number().min(0).max(1),
    weightsVersion: z.number().int().min(1),
    scoredAt: z.string(),
  }),
})

export type DiscoveryScoreCompleteEvent = z.infer<typeof discoveryScoreCompleteEventSchema>

export const discoveryQueueUpdatedEventSchema = z.object({
  type: z.literal('discovery.queue.updated'),
  version: z.number().int().min(1),
  payload: z.object({
    clientId: z.string().uuid(),
    pendingCount: z.number().int().min(0),
    scoredDelta: z.number().int().min(0).optional(),
    suppressedDelta: z.number().int().min(0).optional(),
    updatedAt: z.string(),
    reason: z.enum(['scoring', 'backlog', 'manual']).optional(),
  }),
})

export type DiscoveryQueueUpdatedEvent = z.infer<typeof discoveryQueueUpdatedEventSchema>

export const discoveryScoringFailedEventSchema = z.object({
  type: z.literal('discovery.scoring.failed'),
  version: z.number().int().min(1),
  payload: z.object({
    clientId: z.string().uuid(),
    itemIds: z.array(z.string().uuid()).optional(),
    errorCode: z.string(),
    errorMessage: z.string(),
    details: z.record(z.unknown()).optional(),
    occurredAt: z.string(),
  }),
})

export type DiscoveryScoringFailedEvent = z.infer<typeof discoveryScoringFailedEventSchema>

export const discoverySearchRequestedEventSchema = z.object({
  type: z.literal('discovery.search.requested'),
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
    requestedAt: z.string(),
  }),
})

export type DiscoverySearchRequestedEvent = z.infer<typeof discoverySearchRequestedEventSchema>

export const discoverySearchCompletedEventSchema = z.object({
  type: z.literal('discovery.search.completed'),
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
    degradeReason: z.enum(['latency', 'results', 'other']).nullable().optional(),
    completedAt: z.string(),
  }),
})

export type DiscoverySearchCompletedEvent = z.infer<typeof discoverySearchCompletedEventSchema>

export const discoveryEventEnvelopeSchema = z.union([
  discoverySourceCreatedEventSchema,
  discoverySourceUpdatedEventSchema,
  ingestionStartedEventSchema,
  ingestionCompletedEventSchema,
  ingestionFailedEventSchema,
  sourceHealthEventSchema,
  discoveryKeywordUpdatedEventSchema,
  discoveryScoreCompleteEventSchema,
  discoveryQueueUpdatedEventSchema,
  discoveryScoringFailedEventSchema,
  discoverySearchRequestedEventSchema,
  discoverySearchCompletedEventSchema,
])

export type DiscoveryEventEnvelope = z.infer<typeof discoveryEventEnvelopeSchema>

export const DISCOVERY_TELEMETRY_SCHEMA_VERSION = 1 as const

const discoverySourceCreatedTelemetrySchema = z.object({
  schemaVersion: z.literal(DISCOVERY_TELEMETRY_SCHEMA_VERSION),
  eventType: z.literal('source-created'),
  clientId: z.string().uuid(),
  entityId: z.string().uuid(),
  timestamp: z.string(),
  payload: discoverySourceCreatedEventSchema.shape.payload,
})

const discoverySourceUpdatedTelemetrySchema = z.object({
  schemaVersion: z.literal(DISCOVERY_TELEMETRY_SCHEMA_VERSION),
  eventType: z.literal('source.updated'),
  clientId: z.string().uuid(),
  entityId: z.string().uuid(),
  timestamp: z.string(),
  payload: discoverySourceUpdatedEventSchema.shape.payload,
})

const discoveryKeywordUpdatedTelemetrySchema = z.object({
  schemaVersion: z.literal(DISCOVERY_TELEMETRY_SCHEMA_VERSION),
  eventType: z.literal('keyword.updated'),
  clientId: z.string().uuid(),
  entityId: z.string().uuid(),
  timestamp: z.string(),
  payload: discoveryKeywordUpdatedEventSchema.shape.payload,
})

const discoveryScoreCompleteTelemetrySchema = z.object({
  schemaVersion: z.literal(DISCOVERY_TELEMETRY_SCHEMA_VERSION),
  eventType: z.literal('discovery.score.complete'),
  clientId: z.string().uuid(),
  entityId: z.string().uuid(),
  timestamp: z.string(),
  payload: discoveryScoreCompleteEventSchema.shape.payload,
})

const discoveryQueueUpdatedTelemetrySchema = z.object({
  schemaVersion: z.literal(DISCOVERY_TELEMETRY_SCHEMA_VERSION),
  eventType: z.literal('discovery.queue.updated'),
  clientId: z.string().uuid(),
  entityId: z.string().uuid(),
  timestamp: z.string(),
  payload: discoveryQueueUpdatedEventSchema.shape.payload,
})

const discoveryScoringFailedTelemetrySchema = z.object({
  schemaVersion: z.literal(DISCOVERY_TELEMETRY_SCHEMA_VERSION),
  eventType: z.literal('discovery.scoring.failed'),
  clientId: z.string().uuid(),
  entityId: z.string().uuid(),
  timestamp: z.string(),
  payload: discoveryScoringFailedEventSchema.shape.payload,
})

export const discoveryTelemetryEventSchema = z.discriminatedUnion('eventType', [
  discoverySourceCreatedTelemetrySchema,
  discoverySourceUpdatedTelemetrySchema,
  discoveryKeywordUpdatedTelemetrySchema,
  discoveryScoreCompleteTelemetrySchema,
  discoveryQueueUpdatedTelemetrySchema,
  discoveryScoringFailedTelemetrySchema,
  z.object({
    schemaVersion: z.literal(DISCOVERY_TELEMETRY_SCHEMA_VERSION),
    eventType: z.literal('ingestion.started'),
    clientId: z.string().uuid(),
    entityId: z.string().uuid(),
    timestamp: z.string(),
    payload: ingestionStartedEventSchema.shape.payload,
  }),
  z.object({
    schemaVersion: z.literal(DISCOVERY_TELEMETRY_SCHEMA_VERSION),
    eventType: z.literal('ingestion.completed'),
    clientId: z.string().uuid(),
    entityId: z.string().uuid(),
    timestamp: z.string(),
    payload: ingestionCompletedEventSchema.shape.payload,
  }),
  z.object({
    schemaVersion: z.literal(DISCOVERY_TELEMETRY_SCHEMA_VERSION),
    eventType: z.literal('ingestion.failed'),
    clientId: z.string().uuid(),
    entityId: z.string().uuid(),
    timestamp: z.string(),
    payload: ingestionFailedEventSchema.shape.payload,
  }),
  z.object({
    schemaVersion: z.literal(DISCOVERY_TELEMETRY_SCHEMA_VERSION),
    eventType: z.literal('source.health'),
    clientId: z.string().uuid(),
    entityId: z.string().uuid(),
    timestamp: z.string(),
    payload: sourceHealthEventSchema.shape.payload,
  }),
  z.object({
    schemaVersion: z.literal(DISCOVERY_TELEMETRY_SCHEMA_VERSION),
    eventType: z.literal('discovery.search.requested'),
    clientId: z.string().uuid(),
    entityId: z.string().uuid(),
    timestamp: z.string(),
    payload: discoverySearchRequestedEventSchema.shape.payload,
  }),
  z.object({
    schemaVersion: z.literal(DISCOVERY_TELEMETRY_SCHEMA_VERSION),
    eventType: z.literal('discovery.search.completed'),
    clientId: z.string().uuid(),
    entityId: z.string().uuid(),
    timestamp: z.string(),
    payload: discoverySearchCompletedEventSchema.shape.payload,
  }),
])

export type DiscoveryTelemetryEvent = z.infer<typeof discoveryTelemetryEventSchema>
export type DiscoveryTelemetryEventType = DiscoveryTelemetryEvent['eventType']
