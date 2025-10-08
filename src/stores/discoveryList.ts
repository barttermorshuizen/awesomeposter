import { computed, onScopeDispose, reactive, ref } from 'vue'
import type { LocationQueryValue, RouteLocationNormalizedLoaded, Router } from 'vue-router'
import { defineStore } from 'pinia'
import type {
  DiscoverySearchCompletedEvent,
  DiscoverySearchItem,
  DiscoveryTelemetryEvent,
} from '@awesomeposter/shared'
import { DISCOVERY_SEARCH_PAGE_SIZES, normalizeDiscoveryKeyword } from '@awesomeposter/shared'
import { searchDiscoveryItems } from '@/services/discovery/search'

export type DiscoveryListFilters = {
  status: string[]
  sourceIds: string[]
  topicIds: string[]
  search: string
  dateFrom: string | null
  dateTo: string | null
}

export type DiscoveryListPagination = {
  page: number
  pageSize: number
}

export type DiscoveryDegradeReason = 'latency' | 'results' | 'other'

export type DiscoverySourceOption = {
  value: string
  label: string
  subtitle?: string | null
}

export type DiscoveryTopicOption = {
  value: string
  label: string
}

type RouteQueryRecord = Record<string, string | null>

type TelemetryHooks = {
  onSearchLatency?: (durationMs: number, context?: Record<string, unknown>) => void
  onSseDegraded?: (context?: Record<string, unknown>) => void
}

const VIRTUALIZATION_THRESHOLD = 250
const POLL_INTERVAL_MS = 60_000
export const DISCOVERY_MIN_SEARCH_LENGTH = 2

const ROUTE_KEYS = {
  status: 'status',
  sources: 'sources',
  topics: 'topics',
  search: 'search',
  page: 'page',
  pageSize: 'pageSize',
  clientId: 'clientId',
  dateFrom: 'dateFrom',
  dateTo: 'dateTo',
} as const

function computeDefaultDateFrom(): string {
  const now = new Date()
  const from = new Date(now.getTime() - 48 * 60 * 60 * 1000)
  return from.toISOString()
}

function createDefaultFilters(): DiscoveryListFilters {
  return {
    status: ['spotted'],
    sourceIds: [],
    topicIds: [],
    search: '',
    dateFrom: computeDefaultDateFrom(),
    dateTo: null,
  }
}

function parseListParam(
  value: LocationQueryValue | LocationQueryValue[] | undefined,
  fallback: string[],
): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => (typeof entry === 'string' ? entry.split(',') : []))
      .map((entry) => entry.trim())
      .filter(Boolean)
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

function parseDateParam(
  value: LocationQueryValue | LocationQueryValue[] | undefined,
  fallback: string | null,
): string | null {
  const candidate = parseOptionalString(value)
  if (!candidate) {
    return fallback
  }
  const date = new Date(candidate)
  if (Number.isNaN(date.getTime())) {
    return fallback
  }
  return date.toISOString()
}

function normalizeQueryValue(value: LocationQueryValue | LocationQueryValue[] | undefined): string | null {
  if (Array.isArray(value)) {
    const [first] = value
    return typeof first === 'string' ? first : null
  }
  return typeof value === 'string' ? value : null
}

function toUniqueLower(values: string[]): string[] {
  const seen = new Set<string>()
  values.forEach((value) => {
    const normalized = value.trim().toLowerCase()
    if (normalized.length > 0) {
      seen.add(normalized)
    }
  })
  return Array.from(seen)
}

function toUnique(values: string[]): string[] {
  const seen = new Set<string>()
  values.forEach((value) => {
    const normalized = value.trim()
    if (normalized.length > 0) {
      seen.add(normalized)
    }
  })
  return Array.from(seen)
}

function determineDatePreset(dateFrom: string | null, dateTo: string | null): 'last48h' | 'custom' {
  if (dateTo !== null) {
    return 'custom'
  }
  if (!dateFrom) {
    return 'last48h'
  }
  const defaultFrom = new Date(computeDefaultDateFrom()).getTime()
  const currentFrom = new Date(dateFrom).getTime()
  if (Number.isNaN(defaultFrom) || Number.isNaN(currentFrom)) {
    return 'custom'
  }
  const diff = Math.abs(defaultFrom - currentFrom)
  const toleranceMs = 60 * 60 * 1000 // 1 hour tolerance to allow clock drift
  return diff <= toleranceMs ? 'last48h' : 'custom'
}

async function parseJsonResponse(response: Response): Promise<any> {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      return await response.json()
    } catch {
      return null
    }
  }
  try {
    return await response.text()
  } catch {
    return ''
  }
}

function deriveErrorMessage(status: number, payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const data = payload as Record<string, unknown>
    const candidates = [
      data.statusMessage,
      data.message,
      data.error,
      (Array.isArray(data.issues) && data.issues.length > 0 && typeof data.issues[0]?.message === 'string'
        ? data.issues[0]?.message
        : null),
    ]
    const match = candidates.find((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0)
    if (match) {
      return match
    }
  }
  if (typeof payload === 'string' && payload.length > 0) {
    return payload
  }
  return `Request failed (HTTP ${status})`
}

export const useDiscoveryListStore = defineStore('discoveryList', () => {
  const clientId = ref<string | null>(null)
  const filters = reactive<DiscoveryListFilters>(createDefaultFilters())
  const pagination = reactive<DiscoveryListPagination>({ page: 1, pageSize: DISCOVERY_SEARCH_PAGE_SIZES[0] })
  const datePreset = ref<'last48h' | 'custom'>('last48h')

  const loading = ref(false)
  const error = ref<string | null>(null)

  const telemetry = reactive<TelemetryHooks>({})

  const items = ref<DiscoverySearchItem[]>([])
  const total = ref(0)
  const latencyMs = ref<number | null>(null)
  const lastFetchedAt = ref<string | null>(null)
  const lastSearchTerm = ref<string>('')

  const degradeActive = ref(false)
  const degradeReason = ref<DiscoveryDegradeReason | null>(null)
  const sseDisconnected = ref(false)
  const pollingActive = ref(false)

  const sourceOptions = ref<DiscoverySourceOption[]>([])
  const topicOptions = ref<DiscoveryTopicOption[]>([])
  const topicDictionary = ref<Record<string, string>>({})
  const filterMetaLoading = ref(false)
  const filterMetaError = ref<string | null>(null)

  let activeController: AbortController | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null

  const virtualizationEnabled = computed(() => total.value >= VIRTUALIZATION_THRESHOLD)
  const hasResults = computed(() => items.value.length > 0)
  const isEmptyState = computed(() => !loading.value && !items.value.length && !error.value)
  const hasSearchTerm = computed(() => filters.search.trim().length >= DISCOVERY_MIN_SEARCH_LENGTH)
  const pageSizeOptions = DISCOVERY_SEARCH_PAGE_SIZES.slice()

  function setClientId(nextClientId: string | null) {
    if (clientId.value === nextClientId) {
      return
    }
    clientId.value = nextClientId
    stopPolling()
    degradeActive.value = false
    degradeReason.value = null
    sseDisconnected.value = false
  }

  function setFilters(partial: Partial<DiscoveryListFilters>) {
    Object.assign(filters, partial)
    if ('dateFrom' in partial || 'dateTo' in partial) {
      datePreset.value = determineDatePreset(filters.dateFrom, filters.dateTo)
    }
  }

  function setPagination(partial: Partial<DiscoveryListPagination>) {
    Object.assign(pagination, partial)
  }

  function resetFilters(options: { keepSearch?: boolean } = {}) {
    const defaults = createDefaultFilters()
    filters.status = [...defaults.status]
    filters.sourceIds = []
    filters.topicIds = []
    filters.dateFrom = defaults.dateFrom
    filters.dateTo = defaults.dateTo
    datePreset.value = 'last48h'
    if (!options.keepSearch) {
      filters.search = ''
    }
    pagination.page = 1
    pagination.pageSize = DISCOVERY_SEARCH_PAGE_SIZES[0]
  }

  function applyDefaultDatePreset() {
    filters.dateFrom = computeDefaultDateFrom()
    filters.dateTo = null
    datePreset.value = 'last48h'
  }

  function setDateRange(from: string | null, to: string | null) {
    filters.dateFrom = from
    filters.dateTo = to
    datePreset.value = determineDatePreset(from, to)
  }

  function setDatePreset(preset: 'last48h' | 'custom') {
    if (preset === 'last48h') {
      applyDefaultDatePreset()
      return
    }
    datePreset.value = 'custom'
    filters.dateFrom = null
    filters.dateTo = null
  }

  function initializeFromRoute(route: RouteLocationNormalizedLoaded) {
    const defaults = createDefaultFilters()
    const query = route.query
    const status = parseListParam(query[ROUTE_KEYS.status], defaults.status)
    const sources = parseListParam(query[ROUTE_KEYS.sources], defaults.sourceIds)
    const topics = parseListParam(query[ROUTE_KEYS.topics], defaults.topicIds)
    const search = parseStringParam(query[ROUTE_KEYS.search], defaults.search)
    const dateFrom = parseDateParam(query[ROUTE_KEYS.dateFrom], defaults.dateFrom)
    const dateTo = parseDateParam(query[ROUTE_KEYS.dateTo], defaults.dateTo)

    const page = parseNumberParam(query[ROUTE_KEYS.page], pagination.page)
    const pageSize = parseNumberParam(query[ROUTE_KEYS.pageSize], pagination.pageSize)

    const parsedClientId = parseOptionalString(query[ROUTE_KEYS.clientId])

    Object.assign(filters, {
      status,
      sourceIds: sources,
      topicIds: topics,
      search,
      dateFrom,
      dateTo,
    })
    pagination.page = page
    pagination.pageSize = pageSize
    datePreset.value = determineDatePreset(dateFrom, dateTo)
    clientId.value = parsedClientId
  }

  function buildRouteQuery(): RouteQueryRecord {
    return {
      [ROUTE_KEYS.clientId]: clientId.value ?? null,
      [ROUTE_KEYS.status]: filters.status.length > 0 ? filters.status.join(',') : null,
      [ROUTE_KEYS.sources]: filters.sourceIds.length > 0 ? filters.sourceIds.join(',') : null,
      [ROUTE_KEYS.topics]: filters.topicIds.length > 0 ? filters.topicIds.join(',') : null,
      [ROUTE_KEYS.search]: filters.search.length > 0 ? filters.search : null,
      [ROUTE_KEYS.dateFrom]: filters.dateFrom,
      [ROUTE_KEYS.dateTo]: filters.dateTo,
      [ROUTE_KEYS.page]: pagination.page > 1 ? String(pagination.page) : null,
      [ROUTE_KEYS.pageSize]: pagination.pageSize !== DISCOVERY_SEARCH_PAGE_SIZES[0] ? String(pagination.pageSize) : null,
    }
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

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    pollingActive.value = false
  }

  function startPolling() {
    if (pollingActive.value || typeof window === 'undefined') {
      return
    }
    pollingActive.value = true
    pollTimer = window.setInterval(() => {
      void fetchResults('poll')
    }, POLL_INTERVAL_MS)
  }

  function resetRealtimeState() {
    stopPolling()
    sseDisconnected.value = false
    degradeActive.value = false
    degradeReason.value = null
  }

  function markSseDisconnected() {
    if (!sseDisconnected.value) {
      sseDisconnected.value = true
      startPolling()
    }
  }

  function markSseRecovered() {
    if (!sseDisconnected.value) {
      return
    }
    sseDisconnected.value = false
    if (!degradeActive.value) {
      stopPolling()
    }
  }

  function handleTelemetryEvent(event: DiscoveryTelemetryEvent) {
    if (event.eventType !== 'discovery.search.completed') {
      return
    }
    if (event.clientId !== clientId.value) {
      return
    }
    const payload = event.payload as DiscoverySearchCompletedEvent['payload']
    if (payload.degraded) {
      degradeActive.value = true
      degradeReason.value = (payload.degradeReason ?? 'other') as DiscoveryDegradeReason
      startPolling()
    } else {
      degradeActive.value = false
      degradeReason.value = null
      if (!sseDisconnected.value) {
        stopPolling()
      }
    }
    emitSseDegraded({
      degraded: payload.degraded,
      reason: payload.degradeReason ?? null,
      latencyMs: payload.latencyMs,
      total: payload.total,
    })
  }

  async function fetchClientSources(client: string): Promise<DiscoverySourceOption[]> {
    const response = await fetch(`/api/clients/${client}/sources`, { headers: { accept: 'application/json' } })
    const payload = await parseJsonResponse(response)
    if (!response.ok) {
      throw new Error(deriveErrorMessage(response.status, payload))
    }
    const items = Array.isArray(payload?.items) ? payload.items : []
    const options: DiscoverySourceOption[] = []
    const seen = new Set<string>()
    items.forEach((item: any) => {
      const id = typeof item?.id === 'string' && item.id.length > 0
        ? item.id
        : (item?.id !== undefined ? String(item.id) : null)
      if (!id || seen.has(id)) {
        return
      }
      seen.add(id)
      const identifier = typeof item?.identifier === 'string' && item.identifier.length > 0 ? item.identifier : null
      const url = typeof item?.url === 'string' && item.url.length > 0 ? item.url : null
      const label = identifier ?? url ?? 'Source'
      const sourceType = typeof item?.sourceType === 'string' ? item.sourceType : null
      const subtitle = sourceType
        ? sourceType.replace(/[_-]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
        : null
      options.push({
        value: id,
        label,
        subtitle,
      })
    })
    return options
  }

  async function fetchClientTopics(client: string): Promise<DiscoveryTopicOption[]> {
    const response = await fetch(`/api/clients/${client}/keywords`, { headers: { accept: 'application/json' } })
    const payload = await parseJsonResponse(response)
    if (!response.ok) {
      throw new Error(deriveErrorMessage(response.status, payload))
    }
    const items = Array.isArray(payload?.items) ? payload.items : []
    const seen = new Set<string>()
    const options: DiscoveryTopicOption[] = []
    const dictionary: Record<string, string> = {}
    items.forEach((item: any) => {
      const rawKeyword = typeof item?.keyword === 'string' ? item.keyword : ''
      if (!rawKeyword.trim()) {
        return
      }
      try {
        const normalized = normalizeDiscoveryKeyword(rawKeyword)
        if (seen.has(normalized.duplicateKey)) {
          return
        }
        seen.add(normalized.duplicateKey)
        dictionary[normalized.canonical] = normalized.cleaned
        options.push({
          value: normalized.canonical,
          label: normalized.cleaned,
        })
      } catch (error) {
        console.warn('[DiscoveryListStore] Skipping invalid keyword option', rawKeyword, error)
      }
    })
    options.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
    topicDictionary.value = dictionary
    return options
  }

  async function loadFilterMetadata() {
    if (!clientId.value) {
      sourceOptions.value = []
      topicOptions.value = []
      filterMetaError.value = null
      topicDictionary.value = {}
      return
    }
    filterMetaLoading.value = true
    filterMetaError.value = null
    try {
      const [sourcesResult, topicsResult] = await Promise.allSettled([
        fetchClientSources(clientId.value),
        fetchClientTopics(clientId.value),
      ])

      if (sourcesResult.status === 'fulfilled') {
        sourceOptions.value = sourcesResult.value
      } else {
        sourceOptions.value = []
        filterMetaError.value = sourcesResult.reason instanceof Error ? sourcesResult.reason.message : String(sourcesResult.reason)
      }

      if (topicsResult.status === 'fulfilled') {
        topicOptions.value = topicsResult.value
      } else {
        topicOptions.value = []
        topicDictionary.value = {}
        const message = topicsResult.reason instanceof Error ? topicsResult.reason.message : String(topicsResult.reason)
        filterMetaError.value = filterMetaError.value ? `${filterMetaError.value}; ${message}` : message
      }
    } finally {
      filterMetaLoading.value = false
    }
  }

  type FetchTrigger = 'initial' | 'filters' | 'pagination' | 'search' | 'poll' | 'manual' | 'retry'

  async function fetchResults(trigger: FetchTrigger = 'manual') {
    if (!clientId.value) {
      items.value = []
      total.value = 0
      return
    }

    if (activeController) {
      activeController.abort()
    }
    const controller = new AbortController()
    activeController = controller

    const showLoading = trigger !== 'poll'
    const trackError = trigger !== 'poll'

    if (showLoading) {
      loading.value = true
      error.value = null
    }

    const statuses = toUniqueLower(filters.status)
    if (statuses.length === 0) {
      if (showLoading) {
        loading.value = false
      }
      error.value = null
      items.value = []
      total.value = 0
      latencyMs.value = null
      lastFetchedAt.value = new Date().toISOString()
      return
    }
    const sourceIds = toUnique(filters.sourceIds)
    const topics = toUnique(
      filters.topicIds.map((topic) => {
        const dictionary = topicDictionary.value
        if (dictionary[topic]) {
          return topic
        }
        try {
          return normalizeDiscoveryKeyword(topic).canonical
        } catch {
          return topic.trim().toLowerCase()
        }
      }),
    )
    const trimmedSearch = filters.search.trim()
    const effectiveSearch = trimmedSearch.length >= DISCOVERY_MIN_SEARCH_LENGTH ? trimmedSearch : ''

    try {
      const response = await searchDiscoveryItems(
        {
          clientId: clientId.value,
          statuses,
          sourceIds,
          topics,
          dateFrom: filters.dateFrom ?? undefined,
          dateTo: filters.dateTo ?? undefined,
          page: pagination.page,
          pageSize: pagination.pageSize,
          searchTerm: effectiveSearch || undefined,
        },
        { signal: controller.signal },
      )

      items.value = response.items
      total.value = response.total
      latencyMs.value = typeof response.latencyMs === 'number' ? response.latencyMs : null
      lastFetchedAt.value = new Date().toISOString()
      lastSearchTerm.value = effectiveSearch

      if (typeof response.latencyMs === 'number') {
        recordSearchLatency(response.latencyMs, {
          trigger,
          total: response.total,
          page: pagination.page,
          pageSize: pagination.pageSize,
          hasSearchTerm: Boolean(effectiveSearch),
        })
      }

      if (!response.total) {
        // Reset degrade warnings when API reports healthy state and SSE is connected.
        if (!sseDisconnected.value) {
          degradeActive.value = false
          degradeReason.value = null
          stopPolling()
        }
      }
    } catch (err) {
      if (controller.signal.aborted) {
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      if (trackError) {
        error.value = message
        items.value = []
        total.value = 0
      } else {
        // Keep existing data for background polling failures.
        console.warn('[DiscoveryListStore] Polling refresh failed:', message)
      }
    } finally {
      if (activeController === controller) {
        activeController = null
      }
      if (showLoading) {
        loading.value = false
      }
    }
  }

  function refresh() {
    return fetchResults('manual')
  }

  onScopeDispose(() => {
    if (activeController) {
      activeController.abort()
    }
    stopPolling()
  })

  return {
    clientId,
    filters,
    pagination,
    datePreset,
    loading,
    error,
    items,
    total,
    latencyMs,
    lastFetchedAt,
    lastSearchTerm,
    degradeActive,
    degradeReason,
    sseDisconnected,
    pollingActive,
    sourceOptions,
    topicOptions,
    filterMetaLoading,
    filterMetaError,
    virtualizationEnabled,
    hasResults,
    isEmptyState,
    hasSearchTerm,
    pageSizeOptions,
    setClientId,
    setFilters,
    setPagination,
    setDateRange,
    setDatePreset,
    applyDefaultDatePreset,
    resetFilters,
    initializeFromRoute,
    buildRouteQuery,
    syncRoute,
    attachTelemetryHooks,
    recordSearchLatency,
    emitSseDegraded,
    loadFilterMetadata,
    fetchResults,
    refresh,
    handleTelemetryEvent,
    markSseDisconnected,
    markSseRecovered,
    resetRealtimeState,
  }
})
