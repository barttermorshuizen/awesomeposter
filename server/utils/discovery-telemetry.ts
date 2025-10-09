import type {
  DiscoveryEventEnvelope,
  DiscoveryTelemetryEvent,
} from '@awesomeposter/shared'
import {
  DISCOVERY_TELEMETRY_SCHEMA_VERSION,
} from '@awesomeposter/shared'

export function toDiscoveryTelemetryEvent(envelope: DiscoveryEventEnvelope): DiscoveryTelemetryEvent | null {
  switch (envelope.type) {
    case 'source-created':
      return {
        schemaVersion: DISCOVERY_TELEMETRY_SCHEMA_VERSION,
        eventType: 'source-created',
        clientId: envelope.payload.clientId,
        entityId: envelope.payload.id,
        timestamp: envelope.payload.createdAt,
        payload: envelope.payload,
      }
    case 'source.updated':
      return {
        schemaVersion: DISCOVERY_TELEMETRY_SCHEMA_VERSION,
        eventType: 'source.updated',
        clientId: envelope.payload.clientId,
        entityId: envelope.payload.sourceId,
        timestamp: envelope.payload.updatedAt,
        payload: envelope.payload,
      }
    case 'ingestion.started':
      return {
        schemaVersion: DISCOVERY_TELEMETRY_SCHEMA_VERSION,
        eventType: 'ingestion.started',
        clientId: envelope.payload.clientId,
        entityId: envelope.payload.sourceId,
        timestamp: envelope.payload.startedAt,
        payload: envelope.payload,
      }
    case 'ingestion.completed':
      return {
        schemaVersion: DISCOVERY_TELEMETRY_SCHEMA_VERSION,
        eventType: 'ingestion.completed',
        clientId: envelope.payload.clientId,
        entityId: envelope.payload.sourceId,
        timestamp: envelope.payload.completedAt,
        payload: envelope.payload,
      }
    case 'ingestion.failed':
      return {
        schemaVersion: DISCOVERY_TELEMETRY_SCHEMA_VERSION,
        eventType: 'ingestion.failed',
        clientId: envelope.payload.clientId,
        entityId: envelope.payload.sourceId,
        timestamp: envelope.payload.nextRetryAt ?? new Date().toISOString(),
        payload: envelope.payload,
      }
    case 'source.health':
      return {
        schemaVersion: DISCOVERY_TELEMETRY_SCHEMA_VERSION,
        eventType: 'source.health',
        clientId: envelope.payload.clientId,
        entityId: envelope.payload.sourceId,
        timestamp: envelope.payload.observedAt,
        payload: envelope.payload,
      }
    case 'keyword.updated':
      return {
        schemaVersion: DISCOVERY_TELEMETRY_SCHEMA_VERSION,
        eventType: 'keyword.updated',
        clientId: envelope.payload.clientId,
        entityId: envelope.payload.clientId,
        timestamp: envelope.payload.updatedAt,
        payload: envelope.payload,
      }
    case 'discovery.score.complete':
      return {
        schemaVersion: DISCOVERY_TELEMETRY_SCHEMA_VERSION,
        eventType: 'discovery.score.complete',
        clientId: envelope.payload.clientId,
        entityId: envelope.payload.itemId,
        timestamp: envelope.payload.scoredAt,
        payload: envelope.payload,
      }
    case 'discovery.queue.updated':
      return {
        schemaVersion: DISCOVERY_TELEMETRY_SCHEMA_VERSION,
        eventType: 'discovery.queue.updated',
        clientId: envelope.payload.clientId,
        entityId: envelope.payload.clientId,
        timestamp: envelope.payload.updatedAt,
        payload: envelope.payload,
      }
    case 'discovery.scoring.failed':
      return {
        schemaVersion: DISCOVERY_TELEMETRY_SCHEMA_VERSION,
        eventType: 'discovery.scoring.failed',
        clientId: envelope.payload.clientId,
        entityId: envelope.payload.clientId,
        timestamp: envelope.payload.occurredAt,
        payload: envelope.payload,
      }
    case 'discovery.search.requested':
      return {
        schemaVersion: DISCOVERY_TELEMETRY_SCHEMA_VERSION,
        eventType: 'discovery.search.requested',
        clientId: envelope.payload.clientId,
        entityId: envelope.payload.requestId,
        timestamp: envelope.payload.requestedAt,
        payload: envelope.payload,
      }
    case 'discovery.search.completed':
      return {
        schemaVersion: DISCOVERY_TELEMETRY_SCHEMA_VERSION,
        eventType: 'discovery.search.completed',
        clientId: envelope.payload.clientId,
        entityId: envelope.payload.requestId,
        timestamp: envelope.payload.completedAt,
        payload: envelope.payload,
      }
    default:
      return null
  }
}
