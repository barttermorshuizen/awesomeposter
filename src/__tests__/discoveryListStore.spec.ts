import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { Router, RouteLocationNormalizedLoaded } from 'vue-router'
import { useDiscoveryListStore, DISCOVERY_MIN_SEARCH_LENGTH } from '@/stores/discoveryList'
import { searchDiscoveryItems } from '@/services/discovery/search'
import { fetchDiscoveryItemDetail, promoteDiscoveryItem } from '@/services/discovery/items'
import type { DiscoveryTelemetryEvent } from '@awesomeposter/shared'

vi.mock('@/services/discovery/search', () => ({
  searchDiscoveryItems: vi.fn(),
}))

vi.mock('@/services/discovery/items', () => ({
  fetchDiscoveryItemDetail: vi.fn(),
  promoteDiscoveryItem: vi.fn(),
}))

const searchDiscoveryItemsMock = vi.mocked(searchDiscoveryItems)
const fetchDiscoveryItemDetailMock = vi.mocked(fetchDiscoveryItemDetail)
const promoteDiscoveryItemMock = vi.mocked(promoteDiscoveryItem)

describe('useDiscoveryListStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    searchDiscoveryItemsMock.mockReset()
    fetchDiscoveryItemDetailMock.mockReset()
    promoteDiscoveryItemMock.mockReset()
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

    const completedAt = new Date().toISOString()
    const event: DiscoveryTelemetryEvent = {
      schemaVersion: 1,
      eventType: 'discovery.search.completed',
      clientId: 'client-99',
      entityId: 'req-99',
      timestamp: completedAt,
      payload: {
        requestId: 'req-99',
        clientId: 'client-99',
        latencyMs: 420,
        total: 500,
        returned: 0,
        page: 1,
        pageSize: 25,
        statuses: ['spotted'],
        sourceCount: 0,
        topicCount: 0,
        searchTermLength: 0,
        degraded: true,
        degradeReason: 'latency',
        completedAt,
      },
    }

    store.handleTelemetryEvent(event)

    expect(store.degradeActive).toBe(true)
    expect(store.degradeReason).toBe('latency')
    expect(store.pollingActive).toBe(true)

    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('loads selected item detail via service and updates state', async () => {
    const store = useDiscoveryListStore()
    const iso = new Date().toISOString()
    store.items = [
      {
        id: 'item-1',
        title: 'Example',
        url: 'https://example.com',
        status: 'spotted',
        score: 0.9,
        sourceId: 'source-1',
        fetchedAt: iso,
        publishedAt: null,
        ingestedAt: iso,
        summary: 'Summary',
        topics: ['topic'],
        highlights: [],
        briefRef: undefined,
      },
    ]

    const detail = {
      id: 'item-1',
      clientId: 'client-1',
      title: 'Example',
      url: 'https://example.com',
      status: 'scored' as const,
      fetchedAt: iso,
      publishedAt: null,
      ingestedAt: iso,
      source: {
        id: 'source-1',
        name: 'Feed',
        type: 'rss' as const,
        url: 'https://feed.example.com',
      },
      summary: 'Summary',
      body: 'Body',
      topics: ['topic'],
      score: {
        total: 0.8,
        keyword: 0.5,
        recency: 0.2,
        source: 0.1,
        appliedThreshold: 0.6,
      },
      statusHistory: [],
      duplicateRefs: [],
      briefRef: null,
    }

    fetchDiscoveryItemDetailMock.mockResolvedValue(detail)

    await store.openItemDetail('item-1')

    expect(fetchDiscoveryItemDetailMock).toHaveBeenCalledWith('item-1')
    expect(store.selectedItemId).toBe('item-1')
    expect(store.selectedItemDetail).toEqual(detail)
    expect(store.items[0]?.status).toBe('spotted')
  })

  it('promotes selected item and updates list and detail state', async () => {
    const store = useDiscoveryListStore()
    const iso = new Date().toISOString()
    store.items = [
      {
        id: 'item-2',
        title: 'Another item',
        url: 'https://example.com/2',
        status: 'spotted',
        score: 0.7,
        sourceId: 'source-2',
        fetchedAt: iso,
        publishedAt: null,
        ingestedAt: iso,
        summary: null,
        topics: [],
        highlights: [],
        briefRef: undefined,
      },
    ]

    const baseDetail = {
      id: 'item-2',
      clientId: 'client-2',
      title: 'Another item',
      url: 'https://example.com/2',
      status: 'scored' as const,
      fetchedAt: iso,
      publishedAt: null,
      ingestedAt: iso,
      source: {
        id: 'source-2',
        name: 'Feed',
        type: 'rss' as const,
        url: 'https://feed.example.com/2',
      },
      summary: null,
      body: null,
      topics: [],
      score: {
        total: 0.6,
        keyword: 0.4,
        recency: 0.1,
        source: 0.1,
        appliedThreshold: 0.5,
      },
      statusHistory: [],
      duplicateRefs: [],
      briefRef: null,
    }

    store.selectedItemId = 'item-2'
    store.selectedItemDetail = baseDetail

    const promotedDetail = {
      ...baseDetail,
      status: 'promoted' as const,
      statusHistory: [
        {
          id: 'history-1',
          itemId: 'item-2',
          previousStatus: 'scored' as const,
          nextStatus: 'promoted' as const,
          note: 'Looks great',
          actorId: 'user-1',
          actorName: 'Reviewer',
          occurredAt: iso,
        },
      ],
      briefRef: {
        briefId: 'brief-2',
        editUrl: '/briefs/brief-2/edit',
      },
    }

    promoteDiscoveryItemMock.mockResolvedValue(promotedDetail)

    const result = await store.promoteSelectedItem('Looks great')

    expect(promoteDiscoveryItemMock).toHaveBeenCalledWith('item-2', 'Looks great')
    expect(result).toEqual(promotedDetail)
    expect(store.selectedItemDetail).toEqual(promotedDetail)
    expect(store.items[0]?.briefRef).toEqual(promotedDetail.briefRef)
    expect(store.items[0]?.status).toBe('promoted')
  })

  it('updates state from brief.promoted telemetry events', () => {
    const store = useDiscoveryListStore()
    store.setClientId('client-telemetry')
    const iso = new Date().toISOString()
    store.items = [
      {
        id: 'item-telemetry',
        title: 'Telemetry',
        url: 'https://example.com/t',
        status: 'spotted',
        score: 0.5,
        sourceId: 'source-telemetry',
        fetchedAt: iso,
        publishedAt: null,
        ingestedAt: iso,
        summary: null,
        topics: [],
        highlights: [],
        briefRef: undefined,
      },
    ]
    store.selectedItemId = 'item-telemetry'
    store.selectedItemDetail = {
      id: 'item-telemetry',
      clientId: 'client-telemetry',
      title: 'Telemetry',
      url: 'https://example.com/t',
      status: 'scored',
      fetchedAt: iso,
      publishedAt: null,
      ingestedAt: iso,
      source: {
        id: 'source-telemetry',
        name: 'Feed',
        type: 'rss',
        url: 'https://feed.example.com/t',
      },
      summary: null,
      body: null,
      topics: [],
      score: {
        total: 0.5,
        keyword: 0.3,
        recency: 0.1,
        source: 0.1,
        appliedThreshold: 0.4,
      },
      statusHistory: [],
      duplicateRefs: [],
      briefRef: null,
    }

    const briefEvent: DiscoveryTelemetryEvent = {
      schemaVersion: 1,
      eventType: 'brief.promoted',
      clientId: 'client-telemetry',
      entityId: 'brief-telemetry',
      timestamp: iso,
      payload: {
        clientId: 'client-telemetry',
        itemId: 'item-telemetry',
        briefId: 'brief-telemetry',
        promotedAt: iso,
        actorId: 'user-2',
        actorName: 'Auto Reviewer',
        note: 'synced',
        statusHistory: [
          {
            id: 'history-telemetry',
            itemId: 'item-telemetry',
            previousStatus: 'scored',
            nextStatus: 'promoted',
            note: 'synced',
            actorId: 'user-2',
            actorName: 'Auto Reviewer',
            occurredAt: iso,
          },
        ],
        briefRef: {
          briefId: 'brief-telemetry',
          editUrl: '/briefs/brief-telemetry/edit',
        },
      },
    }

    store.handleTelemetryEvent(briefEvent)

    expect(store.items[0]?.status).toBe('promoted')
    expect(store.items[0]?.briefRef).toEqual({ briefId: 'brief-telemetry', editUrl: '/briefs/brief-telemetry/edit' })
    expect(store.selectedItemDetail?.status).toBe('promoted')
    expect(store.selectedItemDetail?.statusHistory).toHaveLength(1)
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
