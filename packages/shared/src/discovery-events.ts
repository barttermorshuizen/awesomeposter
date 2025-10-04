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
  }),
})

export type IngestionCompletedEvent = z.infer<typeof ingestionCompletedEventSchema>

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

export const discoveryEventEnvelopeSchema = z.union([
  discoverySourceCreatedEventSchema,
  ingestionStartedEventSchema,
  ingestionCompletedEventSchema,
  discoveryKeywordUpdatedEventSchema,
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

const discoveryKeywordUpdatedTelemetrySchema = z.object({
  schemaVersion: z.literal(DISCOVERY_TELEMETRY_SCHEMA_VERSION),
  eventType: z.literal('keyword.updated'),
  clientId: z.string().uuid(),
  entityId: z.string().uuid(),
  timestamp: z.string(),
  payload: discoveryKeywordUpdatedEventSchema.shape.payload,
})

export const discoveryTelemetryEventSchema = z.discriminatedUnion('eventType', [
  discoverySourceCreatedTelemetrySchema,
  discoveryKeywordUpdatedTelemetrySchema,
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
])

export type DiscoveryTelemetryEvent = z.infer<typeof discoveryTelemetryEventSchema>
export type DiscoveryTelemetryEventType = DiscoveryTelemetryEvent['eventType']
