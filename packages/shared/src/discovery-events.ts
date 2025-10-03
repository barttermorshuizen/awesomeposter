import { z } from 'zod'
import { discoverySourceTypeSchema } from './discovery.js'

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
])

export type DiscoveryTelemetryEvent = z.infer<typeof discoveryTelemetryEventSchema>
export type DiscoveryTelemetryEventType = DiscoveryTelemetryEvent['eventType']
