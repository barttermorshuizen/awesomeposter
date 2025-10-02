import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emitDiscoveryEvent, getDiscoveryEventEmitter } from '../../utils/discovery-events'

const selectMock = vi.fn()
const orderByMock = vi.fn()
const getDbMock = vi.fn()

vi.mock('@awesomeposter/db', () => ({
  getDb: getDbMock,
  eq: (value: unknown) => value,
  discoveryKeywords: { keyword: 'keyword' },
}))

describe('discovery keyword cache', () => {
  let getKeywordThemesForClient: (clientId: string) => Promise<string[]>
  let clearKeywordThemeCache: (clientId?: string) => void
  let getCacheSize: () => number
  let mockRows: Array<{ keyword: string }>

  beforeEach(async () => {
    selectMock.mockReset()
    orderByMock.mockReset()
    getDbMock.mockReset()

    mockRows = [{ keyword: 'alpha' }, { keyword: 'beta' }]
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
    const module = await import('../discovery-keyword-cache')
    getKeywordThemesForClient = module.getKeywordThemesForClient
    clearKeywordThemeCache = module.clearKeywordThemeCache
    getCacheSize = module.__getKeywordThemeCacheSizeForTests
  })

  it('caches keyword lookups and invalidates on keyword.updated events', async () => {
    let keywords = await getKeywordThemesForClient('123')
    expect(keywords).toEqual(['alpha', 'beta'])
    expect(getCacheSize()).toBe(1)
    expect(selectMock).toHaveBeenCalledTimes(1)
    expect(getDiscoveryEventEmitter().listenerCount('event')).toBeGreaterThan(0)

    keywords = await getKeywordThemesForClient('123')
    expect(selectMock).toHaveBeenCalledTimes(1)
    expect(keywords).toEqual(['alpha', 'beta'])

    mockRows = [{ keyword: 'gamma' }]

    emitDiscoveryEvent({
      type: 'keyword.updated',
      version: 1,
      payload: {
        clientId: '123',
        keywords: ['gamma'],
        updatedAt: new Date().toISOString(),
      },
    })

    clearKeywordThemeCache('123')
    keywords = await getKeywordThemesForClient('123')
    expect(getCacheSize()).toBe(1)
    expect(selectMock).toHaveBeenCalledTimes(2)
    expect(keywords).toEqual(['gamma'])
  })

  afterEach(() => {
    clearKeywordThemeCache()
  })
})
