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
    case 'keyword.updated':
      return {
        schemaVersion: DISCOVERY_TELEMETRY_SCHEMA_VERSION,
        eventType: 'keyword.updated',
        clientId: envelope.payload.clientId,
        entityId: envelope.payload.clientId,
        timestamp: envelope.payload.updatedAt,
        payload: envelope.payload,
      }
    default:
      return null
  }
}
