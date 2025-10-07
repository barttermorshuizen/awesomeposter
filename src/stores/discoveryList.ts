import { computed, reactive, ref } from 'vue'
import type { LocationQueryValue, RouteLocationNormalizedLoaded, Router } from 'vue-router'
import { defineStore } from 'pinia'

export type DiscoveryListSortField = 'score' | 'updatedAt'
export type DiscoveryListSortDirection = 'asc' | 'desc'

export type DiscoveryListFilters = {
  status: string[]
  sourceIds: string[]
  topicIds: string[]
  search: string
}

export type DiscoveryListPagination = {
  page: number
  pageSize: number
}

type RouteQueryRecord = Record<string, string | null>

type TelemetryHooks = {
  onSearchLatency?: (durationMs: number, context?: Record<string, unknown>) => void
  onSseDegraded?: (context?: Record<string, unknown>) => void
}

const DEFAULT_FILTERS: DiscoveryListFilters = {
  status: ['spotted'],
  sourceIds: [],
  topicIds: [],
  search: '',
}

const DEFAULT_PAGINATION: DiscoveryListPagination = {
  page: 1,
  pageSize: 25,
}

const ROUTE_KEYS = {
  status: 'status',
  sources: 'sources',
  topics: 'topics',
  search: 'search',
  page: 'page',
  pageSize: 'pageSize',
  clientId: 'clientId',
} as const

const PLACEHOLDER_ITEMS = Array.from({ length: 18 }, (_, index) => ({
  id: `stub-${index + 1}`,
  title: `Discovery nugget ${index + 1}`,
  summary: 'Future discovery item summary placeholder for virtualization scaffolding.',
  status: 'spotted',
  score: 0.83 - index * 0.01,
}))

export const useDiscoveryListStore = defineStore('discoveryList', () => {
  const clientId = ref<string | null>(null)
  const filters = reactive<DiscoveryListFilters>({ ...DEFAULT_FILTERS })
  const pagination = reactive<DiscoveryListPagination>({ ...DEFAULT_PAGINATION })
  const loading = ref(false)
  const error = ref<string | null>(null)
  const telemetry = reactive<TelemetryHooks>({})

  function parseListParam(
    value: LocationQueryValue | LocationQueryValue[] | undefined,
    fallback: string[],
  ): string[] {
    if (Array.isArray(value)) {
      return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    }
    if (typeof value === 'string' && value.length > 0) {
      return value.split(',').map((entry) => entry.trim()).filter(Boolean)
    }
    return [...fallback]
  }

  function parseStringParam(
    value: LocationQueryValue | LocationQueryValue[] | undefined,
    fallback: string,
  ): string {
    if (Array.isArray(value)) {
      const match = value.find((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      return match ?? fallback
    }
    if (typeof value === 'string') {
      return value
    }
    return fallback
  }

  function parseOptionalString(
    value: LocationQueryValue | LocationQueryValue[] | undefined,
  ): string | null {
    if (Array.isArray(value)) {
      const match = value.find((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      return match ?? null
    }
    return typeof value === 'string' && value.length > 0 ? value : null
  }

  function parseNumberParam(
    value: LocationQueryValue | LocationQueryValue[] | undefined,
    fallback: number,
  ): number {
    const raw = Array.isArray(value) ? value[0] : value
    if (typeof raw === 'string') {
      const parsed = Number.parseInt(raw, 10)
      return Number.isNaN(parsed) ? fallback : parsed
    }
    return fallback
  }

  function setClientId(nextClientId: string | null) {
    clientId.value = nextClientId
  }

  function setFilters(partial: Partial<DiscoveryListFilters>) {
    Object.assign(filters, partial)
  }

  function setPagination(partial: Partial<DiscoveryListPagination>) {
    Object.assign(pagination, partial)
  }

  function resetFilters() {
    Object.assign(filters, DEFAULT_FILTERS)
    Object.assign(pagination, DEFAULT_PAGINATION)
  }

  function initializeFromRoute(route: RouteLocationNormalizedLoaded) {
    const query = route.query
    const status = parseListParam(query[ROUTE_KEYS.status], DEFAULT_FILTERS.status)
    const sources = parseListParam(query[ROUTE_KEYS.sources], DEFAULT_FILTERS.sourceIds)
    const topics = parseListParam(query[ROUTE_KEYS.topics], DEFAULT_FILTERS.topicIds)
    const search = parseStringParam(query[ROUTE_KEYS.search], DEFAULT_FILTERS.search)

    const page = parseNumberParam(query[ROUTE_KEYS.page], DEFAULT_PAGINATION.page)
    const pageSize = parseNumberParam(query[ROUTE_KEYS.pageSize], DEFAULT_PAGINATION.pageSize)

    const parsedClientId = parseOptionalString(query[ROUTE_KEYS.clientId])

    Object.assign(filters, {
      status,
      sourceIds: sources,
      topicIds: topics,
      search,
    })

    Object.assign(pagination, {
      page,
      pageSize,
    })

    clientId.value = parsedClientId
  }

  function buildRouteQuery(): RouteQueryRecord {
    return {
      [ROUTE_KEYS.clientId]: clientId.value ?? null,
      [ROUTE_KEYS.status]: filters.status.length > 0 ? filters.status.join(',') : null,
      [ROUTE_KEYS.sources]: filters.sourceIds.length > 0 ? filters.sourceIds.join(',') : null,
      [ROUTE_KEYS.topics]: filters.topicIds.length > 0 ? filters.topicIds.join(',') : null,
      [ROUTE_KEYS.search]: filters.search.length > 0 ? filters.search : null,
      [ROUTE_KEYS.page]: pagination.page > 1 ? String(pagination.page) : null,
      [ROUTE_KEYS.pageSize]: pagination.pageSize !== DEFAULT_PAGINATION.pageSize ? String(pagination.pageSize) : null,
    }
  }

  function normalizeQueryValue(value: LocationQueryValue | LocationQueryValue[] | undefined): string | null {
    if (Array.isArray(value)) {
      const [first] = value
      return typeof first === 'string' ? first : null
    }
    return typeof value === 'string' ? value : null
  }

  function syncRoute(router: Router, route: RouteLocationNormalizedLoaded) {
    const nextQuery = buildRouteQuery()
    const currentQuery = route.query
    const changed = Object.entries(nextQuery).some(([key, value]) => {
      const current = normalizeQueryValue(currentQuery[key])
      return (value ?? null) !== current
    })

    if (changed) {
      const filteredEntries = Object.entries(nextQuery)
        .filter(([, value]) => value !== null) as Array<[string, string]>

      void router.replace({
        query: Object.fromEntries(filteredEntries),
        hash: route.hash,
      })
    }
  }

  function attachTelemetryHooks(hooks: TelemetryHooks) {
    telemetry.onSearchLatency = hooks.onSearchLatency
    telemetry.onSseDegraded = hooks.onSseDegraded
  }

  function recordSearchLatency(durationMs: number, context?: Record<string, unknown>) {
    telemetry.onSearchLatency?.(durationMs, context)
  }

  function emitSseDegraded(context?: Record<string, unknown>) {
    telemetry.onSseDegraded?.(context)
  }

  const placeholderItems = computed(() => PLACEHOLDER_ITEMS)

  return {
    clientId,
    filters,
    pagination,
    loading,
    error,
    placeholderItems,
    setClientId,
    setFilters,
    setPagination,
    resetFilters,
    initializeFromRoute,
    buildRouteQuery,
    syncRoute,
    attachTelemetryHooks,
    recordSearchLatency,
    emitSseDegraded,
  }
})
