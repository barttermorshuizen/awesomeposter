import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchItemsMock = vi.fn()
const featureFlagMock = vi.fn()
const keywordMock = vi.fn()

vi.mock('../discovery-repository', () => ({
  fetchDiscoveryItemsForScoring: fetchItemsMock,
}))

vi.mock('../client-config/feature-flags', () => ({
  isFeatureEnabled: featureFlagMock,
  FEATURE_DISCOVERY_AGENT: 'discovery-agent',
}))

vi.mock('../discovery-keyword-cache', () => ({
  getKeywordThemesForClient: keywordMock,
}))

describe('discovery scoring utility', () => {
  const now = new Date('2025-04-02T12:00:00Z')

  let scoreDiscoveryItem: typeof import('../discovery/scoring').scoreDiscoveryItem
  let scoreDiscoveryItems: typeof import('../discovery/scoring').scoreDiscoveryItems
  let resetCache: typeof import('../discovery/scoring').__resetDiscoveryScoringCacheForTests

  beforeEach(async () => {
    fetchItemsMock.mockReset()
    featureFlagMock.mockReset()
    keywordMock.mockReset()

    featureFlagMock.mockResolvedValue(true)
    keywordMock.mockResolvedValue(['alpha'])

    vi.resetModules()
    const scoringModule = await import('../discovery/scoring')
    scoreDiscoveryItem = scoringModule.scoreDiscoveryItem
    scoreDiscoveryItems = scoringModule.scoreDiscoveryItems
    resetCache = scoringModule.__resetDiscoveryScoringCacheForTests
    resetCache()
  })

  const baseItem = {
    id: 'item-1',
    clientId: 'client-1',
    sourceId: 'source-1',
    fetchedAt: new Date('2025-04-02T11:00:00Z'),
    publishedAt: new Date('2025-04-01T12:00:00Z'),
    normalized: {
      externalId: 'ext-1',
      title: 'Alpha market update',
      url: 'https://example.com/alpha',
      contentType: 'article' as const,
      publishedAt: '2025-04-01T12:00:00Z',
      publishedAtSource: 'original' as const,
      fetchedAt: '2025-04-02T11:00:00Z',
      extractedBody: 'Alpha insights and longer context for ranking.',
      excerpt: 'Alpha insights',
    },
    sourceMetadata: { contentType: 'article' },
  }

  it('returns weighted score with component breakdown for a single item', async () => {
    fetchItemsMock.mockResolvedValue([baseItem])

    const response = await scoreDiscoveryItem('item-1', { now: () => now })

    expect(response.ok).toBe(true)
    if (!response.ok) return

    expect(response.result.score).toBeCloseTo(0.9121, 4)
    expect(response.result.components.keyword).toBe(1)
    expect(response.result.components.recency).toBeCloseTo(0.7071, 4)
    expect(response.result.components.source).toBe(1)
    expect(response.result.status).toBe('scored')
    expect(response.config.threshold).toBeCloseTo(0.6)
    expect(response.result.matchedKeywords).toEqual(['alpha'])
  })

  it('boosts keyword component when only part of the list matches', async () => {
    keywordMock.mockResolvedValue(['alpha', 'beta', 'gamma', 'delta'])
    fetchItemsMock.mockResolvedValue([
      {
        ...baseItem,
        normalized: {
          ...baseItem.normalized,
          extractedBody: 'Alpha signals and gamma coverage for discovery.',
        },
      },
    ])

    const response = await scoreDiscoveryItem('item-1', { now: () => now })

    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(response.result.components.keyword).toBeCloseTo(0.75, 4)
    expect(response.result.matchedKeywords).toEqual(['alpha', 'gamma'])
  })

  it('short-circuits when the discovery agent flag is disabled', async () => {
    fetchItemsMock.mockResolvedValue([baseItem])
    featureFlagMock.mockResolvedValue(false)

    const response = await scoreDiscoveryItems(['item-1'], { now: () => now })

    expect(response.ok).toBe(false)
    if (response.ok) return
    expect(response.error.code).toBe('DISCOVERY_SCORING_DISABLED')
    expect(response.error.details).toMatchObject({ clientId: 'client-1' })
  })

  it('returns structured error when an item is missing', async () => {
    fetchItemsMock.mockResolvedValue([])

    const response = await scoreDiscoveryItems(['item-1'])

    expect(response.ok).toBe(false)
    if (response.ok) return
    expect(response.error.code).toBe('DISCOVERY_SCORING_NOT_FOUND')
    expect(response.error.details).toMatchObject({ itemIds: ['item-1'] })
  })

  it('returns invalid item envelope when normalized payload is missing data', async () => {
    fetchItemsMock.mockResolvedValue([
      {
        ...baseItem,
        normalized: {
          ...baseItem.normalized,
          extractedBody: '',
        },
      },
    ])

    const response = await scoreDiscoveryItems(['item-1'])

    expect(response.ok).toBe(false)
    if (response.ok) return
    expect(response.error.code).toBe('DISCOVERY_SCORING_INVALID_ITEM')
    expect(response.error.details).toMatchObject({
      invalidItems: [{ itemId: 'item-1' }],
    })
  })

  it('handles empty batches without hitting the repository', async () => {
    const response = await scoreDiscoveryItems([])

    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(response.results).toHaveLength(0)
    expect(fetchItemsMock).not.toHaveBeenCalled()
  })
})
