import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const selectMock = vi.fn()
const fromMock = vi.fn()
const whereMock = vi.fn()
const limitMock = vi.fn()

const mockDb = {
  select: selectMock,
  from: fromMock,
  where: whereMock,
  limit: limitMock,
}

selectMock.mockImplementation(() => mockDb)
fromMock.mockImplementation(() => mockDb)
whereMock.mockImplementation(() => mockDb)

vi.mock('@awesomeposter/db', () => ({
  getDb: () => mockDb,
  clientFeatures: {
    clientId: { column: 'client_id' },
    feature: { column: 'feature' },
    enabled: { column: 'enabled' },
  },
  eq: (column: unknown, value: unknown) => ({ column, value }),
  and: (...conditions: unknown[]) => conditions,
}))

import {
  isFeatureEnabled,
  requireDiscoveryFeatureEnabled,
  FeatureFlagDisabledError,
  publishFeatureFlagUpdate,
  flushLocalFeatureFlagCache,
} from '../client-config/feature-flags'
import { FEATURE_DISCOVERY_AGENT } from '@awesomeposter/shared'

describe('feature flag helper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    flushLocalFeatureFlagCache()
  })

  afterEach(() => {
    flushLocalFeatureFlagCache()
  })

  it('returns true when the feature flag is enabled', async () => {
    limitMock.mockResolvedValueOnce([{ enabled: true }])

    const result = await isFeatureEnabled('client-1', FEATURE_DISCOVERY_AGENT)

    expect(result).toBe(true)
    expect(limitMock).toHaveBeenCalledTimes(1)
  })

  it('returns false when the feature flag record is missing', async () => {
    limitMock.mockResolvedValueOnce([])

    const result = await isFeatureEnabled('client-2', FEATURE_DISCOVERY_AGENT)

    expect(result).toBe(false)
    expect(limitMock).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the data layer throws', async () => {
    limitMock.mockImplementationOnce(() => {
      throw new Error('db unavailable')
    })

    const result = await isFeatureEnabled('client-3', FEATURE_DISCOVERY_AGENT)

    expect(result).toBe(false)
  })

  it('uses the cache to avoid repeated lookups', async () => {
    limitMock.mockResolvedValueOnce([{ enabled: true }])

    const first = await isFeatureEnabled('client-4', FEATURE_DISCOVERY_AGENT)
    const second = await isFeatureEnabled('client-4', FEATURE_DISCOVERY_AGENT)

    expect(first).toBe(true)
    expect(second).toBe(true)
    expect(limitMock).toHaveBeenCalledTimes(1)
  })

  it('invalidates cached values when publishFeatureFlagUpdate is invoked', async () => {
    limitMock.mockResolvedValueOnce([{ enabled: true }])

    const initial = await isFeatureEnabled('client-5', FEATURE_DISCOVERY_AGENT)
    expect(initial).toBe(true)
    expect(limitMock).toHaveBeenCalledTimes(1)

    limitMock.mockResolvedValueOnce([{ enabled: false }])

    await publishFeatureFlagUpdate({
      clientId: 'client-5',
      feature: FEATURE_DISCOVERY_AGENT,
      enabled: false,
      updatedAt: new Date().toISOString(),
    })

    const next = await isFeatureEnabled('client-5', FEATURE_DISCOVERY_AGENT)
    expect(next).toBe(false)
    expect(limitMock).toHaveBeenCalledTimes(2)
  })

  it('throws FeatureFlagDisabledError with discovery-specific messaging', async () => {
    limitMock.mockResolvedValueOnce([{ enabled: false }])

    await expect(requireDiscoveryFeatureEnabled('client-6')).rejects.toThrow(FeatureFlagDisabledError)

    limitMock.mockResolvedValueOnce([{ enabled: false }])
    await requireDiscoveryFeatureEnabled('client-6').catch((error) => {
      expect(error).toBeInstanceOf(FeatureFlagDisabledError)
      expect((error as FeatureFlagDisabledError).message).toMatch(/Discovery agent is not enabled/)
    })
  })
})
