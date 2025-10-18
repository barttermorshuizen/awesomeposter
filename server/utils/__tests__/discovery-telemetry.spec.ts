import { describe, expect, it } from 'vitest'

import { toDiscoveryTelemetryEvent } from '../discovery-telemetry'

describe('toDiscoveryTelemetryEvent', () => {
  it('maps discovery.bulk.action.completed envelopes into telemetry events', () => {
    const event = toDiscoveryTelemetryEvent({
      type: 'discovery.bulk.action.completed',
      version: 1,
      payload: {
        actionId: '11111111-1111-1111-1111-111111111111',
        action: 'archive',
        clientId: '22222222-2222-2222-2222-222222222222',
        actorId: '33333333-3333-3333-3333-333333333333',
        itemCount: 5,
        successCount: 4,
        conflictCount: 1,
        failedCount: 0,
        durationMs: 128,
        filtersSnapshot: {
          status: ['spotted'],
          sourceIds: [],
          topicIds: [],
          search: '',
          dateFrom: null,
          dateTo: null,
          pageSize: 25,
        },
        recordedAt: '2025-10-18T12:00:00.000Z',
        results: [],
      },
    })

    expect(event).toEqual({
      schemaVersion: 1,
      eventType: 'discovery.bulk.action.completed',
      clientId: '22222222-2222-2222-2222-222222222222',
      entityId: '11111111-1111-1111-1111-111111111111',
      timestamp: '2025-10-18T12:00:00.000Z',
      payload: expect.objectContaining({
        action: 'archive',
        successCount: 4,
        conflictCount: 1,
      }),
    })
  })
})
