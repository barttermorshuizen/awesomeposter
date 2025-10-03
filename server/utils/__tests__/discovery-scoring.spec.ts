import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emitDiscoveryEvent } from '../../utils/discovery-events'

const selectMock = vi.fn()
const orderByMock = vi.fn()
const getDbMock = vi.fn()

vi.mock('@awesomeposter/db', () => ({
  getDb: getDbMock,
  eq: (value: unknown) => value,
  discoveryKeywords: { keyword: 'keyword' },
}))

describe('scoreDiscoveryVariants', () => {
  let scoreDiscoveryVariants: (clientId: string, variants: Array<{ id: string; content: string; platform: string }>) => Promise<Array<{ id: string; score: number }>>
  let clearKeywordThemeCache: (clientId?: string) => void
  let mockRows: Array<{ keyword: string }>

  beforeEach(async () => {
    selectMock.mockReset()
    orderByMock.mockReset()
    getDbMock.mockReset()

    mockRows = [{ keyword: 'alpha' }]

    orderByMock.mockImplementation(async () => mockRows)
    selectMock.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          orderBy: orderByMock,
        }),
      }),
    }))
    getDbMock.mockReturnValue({ select: selectMock })

    vi.resetModules()
    const scoringModule = await import('../discovery-scoring')
    scoreDiscoveryVariants = scoringModule.scoreDiscoveryVariants
    const cacheModule = await import('../discovery-keyword-cache')
    clearKeywordThemeCache = cacheModule.clearKeywordThemeCache
  })

  afterEach(() => {
    clearKeywordThemeCache()
  })

  it('boosts variants that match the latest keyword themes', async () => {
    const variants = [
      { id: 'v1', content: 'Alpha news update for the client', platform: 'linkedin' },
      { id: 'v2', content: 'Beta insights and commentary', platform: 'linkedin' },
    ]

    let ranked = await scoreDiscoveryVariants('client-1', variants)
    expect(ranked[0]?.id).toBe('v1')
    expect(selectMock).toHaveBeenCalledTimes(1)

    mockRows = [{ keyword: 'beta' }]
    emitDiscoveryEvent({
      type: 'keyword.updated',
      version: 1,
      payload: {
        clientId: 'client-1',
        keywords: ['beta'],
        updatedAt: new Date().toISOString(),
      },
    })

    ranked = await scoreDiscoveryVariants('client-1', variants)
    expect(ranked[0]?.id).toBe('v2')
    expect(selectMock).toHaveBeenCalledTimes(2)
  })
})
