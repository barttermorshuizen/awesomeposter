import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { Router, RouteLocationNormalizedLoaded } from 'vue-router'
import { useDiscoveryListStore } from '@/stores/discoveryList'

describe('useDiscoveryListStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('initialises from route query strings', () => {
    const store = useDiscoveryListStore()
    const route = {
      query: {
        status: 'spotted,approved',
        sources: 'rss-1',
        topics: 'summer',
        search: 'headline',
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
    expect(store.pagination.page).toBe(2)
    expect(store.pagination.pageSize).toBe(50)
  })

  it('builds router query params from current state', () => {
    const store = useDiscoveryListStore()
    store.setClientId('client-7')
    store.setFilters({
      status: ['spotted'],
      sourceIds: ['rss-21'],
      topicIds: [],
      search: 'breaking',
    })
    store.setPagination({ page: 3, pageSize: 100 })

    const query = store.buildRouteQuery()
    expect(query.clientId).toBe('client-7')
    expect(query.status).toBe('spotted')
    expect(query.sources).toBe('rss-21')
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

    expect(replace).toHaveBeenCalledExactlyOnceWith({
      query: {
        clientId: 'client-55',
        search: 'virtualization',
        status: 'spotted',
      },
      hash: '',
    })
  })

  it('exposes placeholder items for virtualization scaffolding', () => {
    const store = useDiscoveryListStore()
    const items = store.placeholderItems
    expect(items).toBeTruthy()
    expect(items).toHaveLength(18)
    expect(items?.[0]).toHaveProperty('title')
  })
})
