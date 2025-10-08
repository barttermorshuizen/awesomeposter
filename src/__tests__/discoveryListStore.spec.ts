import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { Router, RouteLocationNormalizedLoaded } from 'vue-router'
import { useDiscoveryListStore, DISCOVERY_MIN_SEARCH_LENGTH } from '@/stores/discoveryList'
import { searchDiscoveryItems } from '@/services/discovery/search'

vi.mock('@/services/discovery/search', () => ({
  searchDiscoveryItems: vi.fn(),
}))

const searchDiscoveryItemsMock = vi.mocked(searchDiscoveryItems)

describe('useDiscoveryListStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    searchDiscoveryItemsMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('initialises from route query strings including date range', () => {
    const store = useDiscoveryListStore()
    const route = {
      query: {
        status: 'spotted,approved',
        sources: 'rss-1',
        topics: 'summer',
        search: 'headline',
        dateFrom: '2025-04-01T00:00:00.000Z',
        dateTo: '2025-04-02T23:59:59.000Z',
        page: '2',
        pageSize: '50',
        clientId: 'client-42',
      },
    } as unknown as RouteLocationNormalizedLoaded

    store.initializeFromRoute(route)

    expect(store.clientId).toBe('client-42')
    expect(store.filters.status).toEqual(['spotted', 'approved'])
    expect(store.filters.sourceIds).toEqual(['rss-1'])
    expect(store.filters.topicIds).toEqual(['summer'])
    expect(store.filters.search).toBe('headline')
    expect(store.filters.dateFrom).toBe('2025-04-01T00:00:00.000Z')
    expect(store.filters.dateTo).toBe('2025-04-02T23:59:59.000Z')
    expect(store.pagination.page).toBe(2)
    expect(store.pagination.pageSize).toBe(50)
  })

  it('builds router query params including date filters', () => {
    const store = useDiscoveryListStore()
    store.setClientId('client-7')
    store.setFilters({
      status: ['spotted'],
      sourceIds: ['rss-21'],
      topicIds: ['ai'],
      search: 'breaking',
      dateFrom: '2025-04-01T00:00:00.000Z',
      dateTo: '2025-04-02T23:59:59.000Z',
    })
    store.setPagination({ page: 3, pageSize: 100 })

    const query = store.buildRouteQuery()
    expect(query.clientId).toBe('client-7')
    expect(query.status).toBe('spotted')
    expect(query.sources).toBe('rss-21')
    expect(query.topics).toBe('ai')
    expect(query.search).toBe('breaking')
    expect(query.dateFrom).toBe('2025-04-01T00:00:00.000Z')
    expect(query.dateTo).toBe('2025-04-02T23:59:59.000Z')
    expect(query.page).toBe('3')
    expect(query.pageSize).toBe('100')
  })

  it('syncs router when state changes', () => {
    const store = useDiscoveryListStore()
    const replace = vi.fn()
    const router = { replace } as unknown as Router
    const route = { query: {}, hash: '' } as unknown as RouteLocationNormalizedLoaded

    store.setClientId('client-55')
    store.setFilters({ search: 'virtualization' })

    store.syncRoute(router, route)

    expect(replace).toHaveBeenCalledTimes(1)
    const callArgs = replace.mock.calls[0]?.[0]
    expect(callArgs).toBeTruthy()
    expect(callArgs).toMatchObject({
      query: expect.objectContaining({
        clientId: 'client-55',
        search: 'virtualization',
        status: 'spotted',
      }),
      hash: '',
    })
  })

  it('fetches discovery items via search service and normalises response', async () => {
    const store = useDiscoveryListStore()
    store.setClientId('client-88')
    store.setFilters({
      status: ['Spotted', 'Suppressed'],
      sourceIds: ['abc-123'],
      topicIds: ['AI'],
      search: 'market',
    })
    store.setPagination({ page: 2, pageSize: 50 })

    searchDiscoveryItemsMock.mockResolvedValue({
      items: [
        {
          id: 'item-1',
          title: 'Example',
          url: 'https://example.com',
          status: 'spotted',
          score: 0.93,
          sourceId: 'abc-123',
          fetchedAt: new Date().toISOString(),
          publishedAt: null,
          ingestedAt: new Date().toISOString(),
          summary: 'Summary',
          topics: ['ai'],
          highlights: [],
        },
      ],
      total: 120,
      page: 2,
      pageSize: 50,
      latencyMs: 180,
    })

    await store.fetchResults('filters')

    expect(searchDiscoveryItemsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'client-88',
        statuses: ['spotted', 'suppressed'],
        sourceIds: ['abc-123'],
        topics: ['ai'],
        searchTerm: 'market',
        page: 2,
        pageSize: 50,
        dateFrom: expect.any(String),
        dateTo: undefined,
      }),
      expect.any(Object),
    )
    expect(store.items).toHaveLength(1)
    expect(store.total).toBe(120)
    expect(store.latencyMs).toBe(180)
    expect(store.lastSearchTerm).toBe('market')
  })

  it('trims search term when below minimum length', async () => {
    const store = useDiscoveryListStore()
    store.setClientId('client-11')
    store.setFilters({ search: 'a' })

    searchDiscoveryItemsMock.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
      latencyMs: 50,
    })

    await store.fetchResults('search')

    expect(searchDiscoveryItemsMock).toHaveBeenCalledWith(
      expect.objectContaining({ searchTerm: undefined }),
      expect.any(Object),
    )
    expect(store.lastSearchTerm).toBe('')
  })

  it('enables polling and marks degrade when telemetry reports issues', () => {
    vi.useFakeTimers()
    const store = useDiscoveryListStore()
    store.setClientId('client-99')

    searchDiscoveryItemsMock.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
      latencyMs: 0,
    })

    const event = {
      eventType: 'discovery.search.completed',
      clientId: 'client-99',
      payload: {
        degraded: true,
        degradeReason: 'latency' as const,
        latencyMs: 420,
        total: 500,
      },
    }

    store.handleTelemetryEvent(event)

    expect(store.degradeActive).toBe(true)
    expect(store.degradeReason).toBe('latency')
    expect(store.pollingActive).toBe(true)

    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('loads filter metadata from client endpoints', async () => {
    const store = useDiscoveryListStore()
    store.setClientId('client-123')

    const fetchMock = vi.fn()
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              { id: 's-1', identifier: 'Blog Feed', sourceType: 'rss' },
              { id: 's-1', identifier: 'Blog Feed', sourceType: 'rss' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              { keyword: 'AI' },
              { keyword: 'ai' },
              { keyword: 'Marketing' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )

    vi.stubGlobal('fetch', fetchMock)

    await store.loadFilterMetadata()

    expect(store.sourceOptions).toHaveLength(1)
    expect(store.topicOptions).toEqual([
      { value: 'ai', label: 'AI' },
      { value: 'marketing', label: 'Marketing' },
    ])

    vi.unstubAllGlobals()
  })

  it('calculates minimum search length constant', () => {
    expect(DISCOVERY_MIN_SEARCH_LENGTH).toBeGreaterThanOrEqual(2)
  })
})
