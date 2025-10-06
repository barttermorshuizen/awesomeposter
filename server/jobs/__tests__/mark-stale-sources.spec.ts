import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../utils/discovery-repository', () => ({
  markStaleDiscoverySources: vi.fn(),
}))

vi.mock('../../utils/discovery-health', () => ({
  publishSourceHealthStatus: vi.fn(),
}))

vi.mock('nitropack/runtime', () => ({
  defineTask: (input: unknown) => input,
}))

import { runMarkStaleDiscoverySourcesJob } from '../discovery/mark-stale-sources'
import { markStaleDiscoverySources } from '../../utils/discovery-repository'
import { publishSourceHealthStatus } from '../../utils/discovery-health'

describe('runMarkStaleDiscoverySourcesJob', () => {
  const now = new Date('2025-04-02T12:00:00Z')
  const staleCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(markStaleDiscoverySources).mockResolvedValue([])
  })

  it('publishes health updates for stale sources and returns counts', async () => {
    const lastFetchedAt = new Date('2025-04-01T02:00:00Z')
    const staleSince = new Date('2025-04-01T06:00:00Z')

    vi.mocked(markStaleDiscoverySources).mockResolvedValue([
      {
        clientId: 'client-1',
        sourceId: 'source-1',
        sourceType: 'rss',
        health: {
          status: 'warning',
          observedAt: now,
          lastFetchedAt,
          consecutiveFailures: 2,
          lastSuccessAt: new Date('2025-03-31T09:00:00Z'),
          failureReason: null,
          staleSince,
        },
      },
    ])

    const result = await runMarkStaleDiscoverySourcesJob(now)

    expect(markStaleDiscoverySources).toHaveBeenCalledWith(staleCutoff, now)
    expect(publishSourceHealthStatus).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'client-1',
      sourceId: 'source-1',
      status: 'warning',
      consecutiveFailures: 2,
      staleSince,
    }))
    expect(result).toEqual({ updated: 1, thresholdHours: 24 })
  })
})
