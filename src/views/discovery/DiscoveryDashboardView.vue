<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'
import { useDiscoveryListStore, DISCOVERY_MIN_SEARCH_LENGTH } from '@/stores/discoveryList'
import { fetchClientFeatureFlags } from '@/lib/feature-flags'
import {
  subscribeToDiscoveryEvents,
  type DiscoveryEventHandlers,
  type DiscoveryFeatureDisabledPayload,
} from '@/lib/discovery-sse'
import { DASHBOARD_CLIENT_STORAGE_KEY } from './loadDiscoveryDashboard'

interface ClientOption {
  id: string
  name: string
  slug: string | null
}

type HighlightSegment = {
  text: string
  highlighted: boolean
}

const router = useRouter()
const route = useRoute()
const listStore = useDiscoveryListStore()
const filters = listStore.filters
const pagination = listStore.pagination

const {
  clientId,
  loading,
  error,
  items,
  total,
  latencyMs,
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
  pageSizeOptions,
  datePreset,
} = storeToRefs(listStore)

const lastSearchTerm = computed(() => listStore.lastSearchTerm)

const clients = ref<ClientOption[]>([])
const clientsLoading = ref(false)
const clientsError = ref<string | null>(null)
const featureFlagMessage = ref<string | null>(null)
const featureFlagLoading = ref(false)
const featureFlagEnabled = ref(false)

const virtualizationForcedOff = ref(false)
const customDateFrom = ref('')
const customDateTo = ref('')
const searchHasFocus = ref(false)

const statusOptions = [
  { value: 'spotted', label: 'Spotted' },
  { value: 'suppressed', label: 'Suppressed' },
  { value: 'promoted', label: 'Promoted' },
]

const selectedClientId = computed({
  get: () => clientId.value ?? '',
  set: (value: string) => {
    const normalized = value?.trim() ? value.trim() : null
    listStore.setClientId(normalized)
  },
})

const isReadyForQueries = computed(() => featureFlagEnabled.value && Boolean(clientId.value))

let previousClientId: string | null = null
let unsubscribeFromSse: (() => void) | null = null
let searchDebounceHandle: ReturnType<typeof setTimeout> | null = null
let suppressNextPageFetch = false
let hasBootstrappedOnce = false
let syncingCustomDates = false

const searchMessages = computed(() => {
  const trimmed = filters.search.trim()
  if (!trimmed.length) {
    return [`Enter at least ${DISCOVERY_MIN_SEARCH_LENGTH} characters to search titles and excerpts.`]
  }
  if (trimmed.length < DISCOVERY_MIN_SEARCH_LENGTH) {
    const remaining = DISCOVERY_MIN_SEARCH_LENGTH - trimmed.length
    return [`Enter ${remaining} more character${remaining === 1 ? '' : 's'} to run the search.`]
  }
  if (lastSearchTerm.value) {
    return [`Results highlight matches for “${lastSearchTerm.value}”.`]
  }
  return []
})

const virtualizationActive = computed(() => virtualizationEnabled.value && !virtualizationForcedOff.value)

const resultSummary = computed(() => {
  if (!isReadyForQueries.value) {
    return 'Select a client to load discovery items.'
  }
  if (loading.value) {
    return 'Loading discovery items…'
  }
  if (!total.value) {
    if (filters.search.trim().length >= DISCOVERY_MIN_SEARCH_LENGTH) {
      return `No discovery items matched “${filters.search.trim()}”.`
    }
    return 'No discovery items found in the selected window.'
  }
  const start = (pagination.page - 1) * pagination.pageSize + 1
  const end = Math.min(pagination.page * pagination.pageSize, total.value)
  if (lastSearchTerm.value) {
    return `Showing ${start}-${end} of ${total.value} results for “${lastSearchTerm.value}”.`
  }
  return `Showing ${start}-${end} of ${total.value} discovery items.`
})

const degradeBanner = computed(() => {
  if (sseDisconnected.value) {
    return {
      type: 'error' as const,
      message: 'Live updates are disconnected. We are retrying automatically; you can continue with manual refreshes.',
    }
  }
  if (degradeActive.value) {
    const reason = degradeReason.value
    let detail = 'switching to periodic polling to keep data fresh.'
    if (reason === 'latency') {
      detail = 'search latency exceeded thresholds; polling fallback is active.'
    } else if (reason === 'results') {
      detail = 'the result set is very large; virtualization and polling are active.'
    }
    return {
      type: 'warning' as const,
      message: `Discovery search is in degraded mode (${reason ?? 'load'}); ${detail}`,
    }
  }
  if (pollingActive.value) {
    return {
      type: 'info' as const,
      message: 'Polling fallback is active while realtime updates stabilise.',
    }
  }
  return null
})

const latencyLabel = computed(() => {
  if (typeof latencyMs.value !== 'number') {
    return 'Latency n/a'
  }
  return `${latencyMs.value} ms latency`
})

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pagination.pageSize)))

const formatStatus = (status: string) => {
  switch (status) {
    case 'spotted':
      return 'Spotted'
    case 'approved':
      return 'Approved'
    case 'suppressed':
      return 'Suppressed'
    case 'promoted':
      return 'Promoted'
    case 'archived':
      return 'Archived'
    case 'pending':
      return 'Pending'
    default:
      return status
  }
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
}

function buildHighlightSegments(snippet: string): HighlightSegment[] {
  const segments: HighlightSegment[] = []
  const regex = /<mark>(.*?)<\/mark>/gi
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(snippet)) !== null) {
    if (match.index > lastIndex) {
      const plain = snippet.slice(lastIndex, match.index)
      if (plain) {
        segments.push({ text: decodeHtmlEntities(plain), highlighted: false })
      }
    }
    const highlightedText = decodeHtmlEntities(match[1] ?? '')
    if (highlightedText) {
      segments.push({ text: highlightedText, highlighted: true })
    }
    lastIndex = match.index + match[0].length
  }

  const trailing = snippet.slice(lastIndex)
  if (trailing) {
    segments.push({ text: decodeHtmlEntities(trailing), highlighted: false })
  }

  if (!segments.length) {
    segments.push({ text: decodeHtmlEntities(snippet), highlighted: false })
  }
  return segments
}

function highlightFieldLabel(field: string): string {
  switch (field) {
    case 'title':
      return 'Title match'
    case 'excerpt':
      return 'Excerpt match'
    case 'body':
      return 'Body match'
    default:
      return 'Match'
  }
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function formatTimestamp(iso: string | null): string {
  if (!iso) {
    return 'Unknown time'
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return 'Unknown time'
  }
  return dateFormatter.format(date)
}

function computeScoreLabel(score: number | null): string {
  if (score === null || Number.isNaN(score)) {
    return 'Score n/a'
  }
  return `${(score * 100).toFixed(1)}% score`
}

function toDateInputValue(iso: string | null): string {
  if (!iso) {
    return ''
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const offset = date.getTimezoneOffset()
  const local = new Date(date.getTime() - offset * 60_000)
  return local.toISOString().slice(0, 10)
}

function fromDateInputValue(value: string | null, options?: { endOfDay?: boolean }): string | null {
  if (!value) {
    return null
  }
  const time = options?.endOfDay ? '23:59:59' : '00:00:00'
  const date = new Date(`${value}T${time}Z`)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  return date.toISOString()
}

function attachSse(client: string) {
  detachSse()
  if (!client) {
    return
  }
  listStore.resetRealtimeState()
  const handlers: DiscoveryEventHandlers = {
    onEvent: (event) => {
      listStore.handleTelemetryEvent(event)
      listStore.markSseRecovered()
    },
    onDisconnect: () => {
      listStore.markSseDisconnected()
    },
    onFeatureDisabled: handleFeatureDisabled,
  }
  unsubscribeFromSse = subscribeToDiscoveryEvents(client, handlers)
}

function detachSse() {
  if (unsubscribeFromSse) {
    unsubscribeFromSse()
    unsubscribeFromSse = null
  }
  listStore.resetRealtimeState()
}

function handleFeatureDisabled(payload: DiscoveryFeatureDisabledPayload) {
  const message = typeof payload?.message === 'string' && payload.message.trim().length
    ? payload.message.trim()
    : 'Discovery filters are disabled for this client.'
  featureFlagEnabled.value = false
  featureFlagMessage.value = message
  detachSse()
}

async function loadClients() {
  clientsLoading.value = true
  clientsError.value = null
  try {
    const res = await fetch('/api/clients', { headers: { accept: 'application/json' } })
    if (!res.ok) {
      throw new Error(`Failed to load clients (HTTP ${res.status})`)
    }
    const payload = await res.json().catch(() => ({}))
    const items = Array.isArray(payload?.items) ? payload.items : []
    clients.value = items.map((item: any) => ({
      id: String(item.id),
      name: String(item.name ?? 'Unnamed client'),
      slug: item.slug ?? null,
    }))
  } catch (err) {
    clientsError.value = err instanceof Error ? err.message : String(err)
  } finally {
    clientsLoading.value = false
  }
}

async function ensureFeatureFlag(client: string | null, reason: 'initial' | 'client-change' | 'flag-change') {
  featureFlagEnabled.value = false
  if (!client) {
    featureFlagMessage.value = 'Select a client to enable discovery filters.'
    detachSse()
    return
  }
  featureFlagLoading.value = true
  featureFlagMessage.value = null
  try {
    const flags = await fetchClientFeatureFlags(client)
    featureFlagEnabled.value = Boolean(flags.discoveryFiltersV1)
    if (!featureFlagEnabled.value) {
      featureFlagMessage.value =
        'Discovery filters v1 flag is disabled for this client. Enable it in Settings → Feature Flags to access the dashboard.'
      detachSse()
      hasBootstrappedOnce = false
      return
    }
    featureFlagMessage.value = null
    await bootstrapForClient(reason)
  } catch (err) {
    featureFlagMessage.value = err instanceof Error ? err.message : String(err)
    detachSse()
    hasBootstrappedOnce = false
  } finally {
    featureFlagLoading.value = false
  }
}

async function bootstrapForClient(reason: 'initial' | 'client-change' | 'flag-change') {
  if (!featureFlagEnabled.value || !clientId.value) {
    detachSse()
    hasBootstrappedOnce = false
    return
  }
  virtualizationForcedOff.value = false
  try {
    await listStore.loadFilterMetadata()
  } catch (err) {
    console.error('[DiscoveryDashboard] Failed to load filter metadata', err)
  }
  if (reason === 'client-change') {
    suppressNextPageFetch = true
    pagination.page = 1
  }
  const trigger = hasBootstrappedOnce && reason !== 'client-change' ? 'manual' : 'initial'
  await listStore.fetchResults(trigger)
  attachSse(clientId.value)
  hasBootstrappedOnce = true
}

function onResetFilters() {
  listStore.resetFilters()
  virtualizationForcedOff.value = false
  if (isReadyForQueries.value) {
    suppressNextPageFetch = true
    pagination.page = 1
    void listStore.fetchResults('filters')
  }
}

function refreshResults() {
  void listStore.refresh()
}

function toggleVirtualization() {
  virtualizationForcedOff.value = !virtualizationForcedOff.value
}

function onSearchInputChanged() {
  if (!isReadyForQueries.value || !hasBootstrappedOnce) {
    return
  }
  if (typeof window === 'undefined') {
    return
  }
  if (searchDebounceHandle) {
    clearTimeout(searchDebounceHandle)
  }
  const delay = filters.search.trim().length >= DISCOVERY_MIN_SEARCH_LENGTH ? 250 : 0
  searchDebounceHandle = window.setTimeout(async () => {
    if (pagination.page !== 1) {
      suppressNextPageFetch = true
      pagination.page = 1
    }
    await listStore.fetchResults('search')
  }, delay)
}

watch(
  () => filters.search,
  () => {
    onSearchInputChanged()
  },
)

watch(
  () => [
    filters.status.join(','),
    filters.sourceIds.join(','),
    filters.topicIds.join(','),
    filters.dateFrom ?? '',
    filters.dateTo ?? '',
  ],
  async (current, previous) => {
    if (!isReadyForQueries.value || !hasBootstrappedOnce || current === previous) {
      return
    }
    if (pagination.page !== 1) {
      suppressNextPageFetch = true
      pagination.page = 1
    }
    await listStore.fetchResults('filters')
  },
)

watch(
  () => pagination.page,
  async (value, oldValue) => {
    if (!isReadyForQueries.value || !hasBootstrappedOnce || value === oldValue) {
      return
    }
    if (suppressNextPageFetch) {
      suppressNextPageFetch = false
      return
    }
    await listStore.fetchResults('pagination')
  },
)

watch(
  () => pagination.pageSize,
  async (value, oldValue) => {
    if (!isReadyForQueries.value || !hasBootstrappedOnce || value === oldValue) {
      return
    }
    suppressNextPageFetch = true
    pagination.page = 1
    await listStore.fetchResults('pagination')
  },
)

watch(
  virtualizationEnabled,
  (enabled) => {
    if (!enabled) {
      virtualizationForcedOff.value = false
    }
  },
)

watch(
  () => [filters.dateFrom, filters.dateTo],
  ([from, to]) => {
    if (syncingCustomDates) {
      return
    }
    syncingCustomDates = true
    customDateFrom.value = toDateInputValue(from ?? null)
    customDateTo.value = toDateInputValue(to ?? null)
    syncingCustomDates = false
  },
  { immediate: true },
)

watch(
  () => [customDateFrom.value, customDateTo.value],
  ([fromValue, toValue]) => {
    if (syncingCustomDates) {
      return
    }
    if (datePreset.value !== 'custom') {
      return
    }
    const fromIso = fromDateInputValue(fromValue || null, { endOfDay: false })
    const toIso = fromDateInputValue(toValue || null, { endOfDay: true })
    listStore.setDateRange(fromIso, toIso)
  },
)

watch(clientId, (id) => {
  if (typeof window !== 'undefined') {
    if (id) {
      window.localStorage.setItem(DASHBOARD_CLIENT_STORAGE_KEY, id)
    } else {
      window.localStorage.removeItem(DASHBOARD_CLIENT_STORAGE_KEY)
    }
  }

  if (!id) {
    detachSse()
    featureFlagEnabled.value = false
    hasBootstrappedOnce = false
    featureFlagMessage.value = 'Select a client to enable discovery filters.'
    previousClientId = id
    return
  }

  if (previousClientId === null) {
    // first client selection
    virtualizationForcedOff.value = false
    hasBootstrappedOnce = false
    void ensureFeatureFlag(id, 'client-change')
  } else if (id !== previousClientId) {
    listStore.resetFilters()
    virtualizationForcedOff.value = false
    hasBootstrappedOnce = false
    void ensureFeatureFlag(id, 'client-change')
  } else {
    void ensureFeatureFlag(id, 'flag-change')
  }

  previousClientId = id
})

watch(
  () => ({
    client: clientId.value,
    status: [...filters.status],
    sources: [...filters.sourceIds],
    topics: [...filters.topicIds],
    search: filters.search,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    page: pagination.page,
    pageSize: pagination.pageSize,
  }),
  () => {
    listStore.syncRoute(router, route)
  },
  { deep: true },
)

listStore.attachTelemetryHooks({
  onSearchLatency: (durationMs, context) => {
    console.debug('[DiscoveryDashboard] search latency', durationMs, context)
  },
  onSseDegraded: (context) => {
    console.debug('[DiscoveryDashboard] realtime degraded', context)
  },
})

onMounted(() => {
  listStore.initializeFromRoute(route)
  void loadClients()
  if (clientId.value) {
    void ensureFeatureFlag(clientId.value, 'initial')
  } else {
    featureFlagMessage.value = 'Select a client to enable discovery filters.'
  }
})

onBeforeUnmount(() => {
  if (searchDebounceHandle) {
    clearTimeout(searchDebounceHandle)
    searchDebounceHandle = null
  }
  detachSse()
})

watch(datePreset, (preset) => {
  if (preset === 'last48h') {
    customDateFrom.value = ''
    customDateTo.value = ''
  }
})

const datePresetSelection = computed({
  get: () => datePreset.value,
  set: (value: 'last48h' | 'custom') => {
    listStore.setDatePreset(value)
    if (value === 'last48h') {
      suppressNextPageFetch = true
      pagination.page = 1
      if (isReadyForQueries.value) {
        void listStore.fetchResults('filters')
      }
    }
  },
})
</script>

<template>
  <v-container class="py-8 discovery-dashboard-view">
    <v-row class="align-center mb-6">
      <v-col cols="12" md="7" class="d-flex align-center gap-3">
        <v-icon icon="mdi-view-dashboard-edit-outline" size="36" />
        <div>
          <h1 class="text-h5 text-md-h4 mb-1">Discovery dashboard</h1>
          <p class="text-body-2 text-medium-emphasis mb-0">
            Review discovery nuggets with rich filters, keyword search, and realtime fallbacks.
          </p>
        </div>
      </v-col>
      <v-col cols="12" md="5" class="d-flex justify-end">
        <v-btn
          color="primary"
          variant="tonal"
          class="text-none"
          :disabled="loading"
          @click="refreshResults"
        >
          Refresh results
        </v-btn>
      </v-col>
    </v-row>

    <v-row class="mb-4" dense>
      <v-col cols="12" md="6" lg="4">
        <v-select
          v-model="selectedClientId"
          :items="clients"
          :loading="clientsLoading"
          :disabled="clientsLoading"
          :error="Boolean(clientsError)"
          :error-messages="clientsError ? [clientsError] : []"
          item-title="name"
          item-value="id"
          label="Review client"
          placeholder="Choose a client"
          density="comfortable"
          variant="outlined"
          hide-details="auto"
        >
          <template #item="{ props, item }">
            <v-list-item
              v-bind="props"
              :title="item.raw.name"
              :subtitle="item.raw.slug || undefined"
            />
          </template>
        </v-select>
      </v-col>
      <v-col cols="12" md="6" lg="4" class="d-flex align-end">
        <div class="text-caption text-medium-emphasis">
          Client selection persists locally so the dashboard restores your context on reload.
        </div>
      </v-col>
    </v-row>

    <v-alert
      v-if="featureFlagMessage"
      :type="featureFlagLoading ? 'info' : 'warning'"
      variant="tonal"
      class="mb-4"
      density="comfortable"
    >
      {{ featureFlagMessage }}
    </v-alert>

    <v-alert
      v-if="degradeBanner"
      :type="degradeBanner.type"
      variant="tonal"
      class="mb-4"
      density="comfortable"
    >
      {{ degradeBanner.message }}
    </v-alert>

    <v-row v-if="featureFlagEnabled" class="g-4">
      <v-col cols="12" md="4">
        <v-card elevation="2" class="h-100 discovery-filters-card">
          <v-card-title class="text-subtitle-1">Filters</v-card-title>
          <v-card-text>
            <div class="mb-4">
              <div class="text-caption text-medium-emphasis mb-2">Statuses</div>
              <v-chip-group
                v-model="filters.status"
                multiple
                column
                filter
                selected-class="bg-primary text-white"
              >
                <v-chip
                  v-for="option in statusOptions"
                  :key="option.value"
                  :value="option.value"
                  variant="outlined"
                  size="small"
                >
                  {{ option.label }}
                </v-chip>
              </v-chip-group>
            </div>

            <div class="mb-4">
              <v-autocomplete
                v-model="filters.sourceIds"
                :items="sourceOptions"
                item-title="label"
                item-value="value"
                label="Sources"
                multiple
                chips
                closable-chips
                clearable
                density="comfortable"
                :loading="filterMetaLoading"
                :hint="filterMetaLoading ? 'Refreshing source list…' : undefined"
              >
                <template #chip="{ props, item }">
                  <v-chip v-bind="props" :text="item.raw.label" size="small" />
                </template>
                <template #item="{ props, item }">
                  <v-list-item v-bind="props" :title="item.raw.label" :subtitle="item.raw.subtitle || undefined" />
                </template>
              </v-autocomplete>
            </div>

            <div class="mb-4">
              <v-autocomplete
                v-model="filters.topicIds"
                :items="topicOptions"
                item-title="label"
                item-value="value"
                label="Keywords"
                multiple
                chips
                closable-chips
                clearable
                density="comfortable"
                :loading="filterMetaLoading"
              />
            </div>

            <div class="mb-4">
              <div class="text-caption text-medium-emphasis mb-2">Date range</div>
              <v-btn-toggle
                v-model="datePresetSelection"
                color="primary"
                density="comfortable"
                rounded="lg"
              >
                <v-btn value="last48h">Last 48 hours</v-btn>
                <v-btn value="custom">Custom</v-btn>
              </v-btn-toggle>
              <div v-if="datePreset === 'custom'" class="d-flex flex-column gap-3 mt-3">
                <v-text-field
                  v-model="customDateFrom"
                  type="date"
                  label="From"
                  density="comfortable"
                  hide-details="auto"
                />
                <v-text-field
                  v-model="customDateTo"
                  type="date"
                  label="To"
                  density="comfortable"
                  hide-details="auto"
                />
              </div>
            </div>

            <v-alert
              v-if="filterMetaError"
              type="warning"
              variant="tonal"
              density="compact"
              class="mb-4"
            >
              {{ filterMetaError }}
            </v-alert>

            <div class="d-flex justify-space-between align-center flex-wrap gap-3 mt-6">
              <span class="text-caption text-medium-emphasis">
                Filters persist in the URL for easy sharing.
              </span>
              <v-btn
                variant="text"
                color="primary"
                size="small"
                class="text-none"
                @click="onResetFilters"
              >
                Reset filters
              </v-btn>
            </div>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" md="8">
        <v-card elevation="2" class="h-100 d-flex flex-column discovery-results-card">
          <v-card-title class="d-flex justify-space-between align-center flex-wrap gap-3">
            <div>
              <div class="text-subtitle-1">Discovery items</div>
              <div class="text-caption text-medium-emphasis">{{ latencyLabel }}</div>
            </div>
            <div class="d-flex align-center gap-2">
              <v-select
                v-model="pagination.pageSize"
                :items="pageSizeOptions"
                label="Page size"
                density="comfortable"
                variant="outlined"
                hide-details
                style="width: 120px"
              />
              <v-btn
                variant="text"
                size="small"
                class="text-none"
                data-testid="virtualization-toggle"
                @click="toggleVirtualization"
              >
                {{ virtualizationActive ? 'Use standard list' : 'Enable virtual list' }}
              </v-btn>
            </div>
          </v-card-title>

          <v-card-text class="pt-0 flex-grow-1 d-flex flex-column">
            <v-text-field
              v-model="filters.search"
              label="Keyword search"
              prepend-inner-icon="mdi-magnify"
              density="comfortable"
              variant="outlined"
              :messages="searchHasFocus ? searchMessages : []"
              @focus="searchHasFocus = true"
              @blur="searchHasFocus = false"
            />

            <div v-if="virtualizationEnabled" class="text-caption text-medium-emphasis mb-3">
              Virtual scroll {{ virtualizationActive ? 'is active for large datasets.' : 'disabled; rendering standard list.' }}
            </div>

            <div class="text-body-2 mb-4">{{ resultSummary }}</div>

            <div v-if="loading" class="my-4">
              <v-skeleton-loader type="list-item-three-line@3" />
            </div>

            <div v-else-if="error" class="my-4">
              <v-alert type="error" variant="tonal" class="mb-3">
                {{ error }}
              </v-alert>
              <v-btn color="primary" variant="tonal" class="text-none" @click="refreshResults">
                Retry search
              </v-btn>
            </div>

            <div v-else-if="isEmptyState" class="my-4">
              <v-empty-state
                headline="No discovery items yet"
                text="Adjust your filters or expand the date range. Polling fallback will surface new items automatically."
                icon="mdi-database-search"
              >
                <template #actions>
                  <v-btn color="primary" variant="text" class="text-none" @click="refreshResults">
                    Check again
                  </v-btn>
                </template>
              </v-empty-state>
            </div>

            <div
              v-else
              class="flex-grow-1"
            >
              <VVirtualScroll
                v-if="virtualizationActive"
                class="flex-grow-1"
                :items="items"
                height="520"
                :item-height="164"
              >
                <template #default="{ item }">
                  <div class="discovery-item" :key="item.id">
                    <div class="d-flex justify-space-between align-start flex-wrap gap-3 mb-2">
                      <div>
                        <a :href="item.url" target="_blank" rel="noopener" class="discovery-item__title">
                          {{ item.title }}
                        </a>
                        <div class="text-caption text-medium-emphasis">
                          Ingested {{ formatTimestamp(item.ingestedAt) }}
                        </div>
                      </div>
                      <div class="d-flex align-center gap-2">
                        <v-chip
                          v-if="item.score !== null"
                          size="small"
                          color="primary"
                          variant="tonal"
                        >
                          {{ computeScoreLabel(item.score) }}
                        </v-chip>
                        <v-chip size="small" variant="outlined">
                          {{ formatStatus(item.status) }}
                        </v-chip>
                      </div>
                    </div>

                    <div class="text-body-2 text-medium-emphasis mb-3">
                      {{ item.summary || 'No summary available for this item.' }}
                    </div>

                    <div v-if="item.topics.length" class="d-flex flex-wrap gap-2 mb-3">
                      <v-chip
                        v-for="topic in item.topics"
                        :key="`${item.id}-topic-${topic}`"
                        size="x-small"
                        color="secondary"
                        variant="tonal"
                      >
                        {{ topic }}
                      </v-chip>
                    </div>

                    <div
                      v-for="(highlight, index) in item.highlights"
                      :key="`${item.id}-highlight-${index}`"
                      class="discovery-item__highlight"
                    >
                      <span class="discovery-item__highlight-label">{{ highlightFieldLabel(highlight.field) }}</span>
                      <span class="discovery-item__highlight-snippet">
                        <template
                          v-for="(segment, segmentIndex) in buildHighlightSegments(highlight.snippets[0] ?? '')"
                          :key="`${item.id}-segment-${index}-${segmentIndex}`"
                        >
                          <mark v-if="segment.highlighted">{{ segment.text }}</mark>
                          <span v-else>{{ segment.text }}</span>
                        </template>
                      </span>
                    </div>
                  </div>
                  <v-divider class="my-2" />
                </template>
              </VVirtualScroll>

              <div v-else class="standard-results-list">
                <div
                  v-for="item in items"
                  :key="item.id"
                  class="discovery-item"
                >
                  <div class="d-flex justify-space-between align-start flex-wrap gap-3 mb-2">
                    <div>
                      <a :href="item.url" target="_blank" rel="noopener" class="discovery-item__title">
                        {{ item.title }}
                      </a>
                      <div class="text-caption text-medium-emphasis">
                        Ingested {{ formatTimestamp(item.ingestedAt) }}
                      </div>
                    </div>
                    <div class="d-flex align-center gap-2">
                      <v-chip
                        v-if="item.score !== null"
                        size="small"
                        color="primary"
                        variant="tonal"
                      >
                        {{ computeScoreLabel(item.score) }}
                      </v-chip>
                      <v-chip size="small" variant="outlined">
                        {{ formatStatus(item.status) }}
                      </v-chip>
                    </div>
                  </div>

                  <div class="text-body-2 text-medium-emphasis mb-3">
                    {{ item.summary || 'No summary available for this item.' }}
                  </div>

                  <div v-if="item.topics.length" class="d-flex flex-wrap gap-2 mb-3">
                    <v-chip
                      v-for="topic in item.topics"
                      :key="`${item.id}-topic-${topic}`"
                      size="x-small"
                      color="secondary"
                      variant="tonal"
                    >
                      {{ topic }}
                    </v-chip>
                  </div>

                  <div
                    v-for="(highlight, highlightIndex) in item.highlights"
                    :key="`${item.id}-manual-highlight-${highlightIndex}`"
                    class="discovery-item__highlight"
                  >
                    <span class="discovery-item__highlight-label">{{ highlightFieldLabel(highlight.field) }}</span>
                    <span class="discovery-item__highlight-snippet">
                      <template
                        v-for="(segment, segmentIndex) in buildHighlightSegments(highlight.snippets[0] ?? '')"
                        :key="`${item.id}-manual-segment-${highlightIndex}-${segmentIndex}`"
                      >
                        <mark v-if="segment.highlighted">{{ segment.text }}</mark>
                        <span v-else>{{ segment.text }}</span>
                      </template>
                    </span>
                  </div>

                  <v-divider class="my-4" />
                </div>
              </div>
            </div>

            <v-pagination
              v-if="totalPages > 1"
              v-model="pagination.page"
              :length="totalPages"
              class="mt-4"
            />
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<style scoped>
.discovery-dashboard-view {
  min-height: 100%;
}

.discovery-filters-card,
.discovery-results-card {
  border-radius: 16px;
}

.discovery-item {
  padding: 16px 0;
}

.discovery-item__title {
  color: inherit;
  font-weight: 600;
  text-decoration: none;
}

.discovery-item__title:hover,
.discovery-item__title:focus {
  text-decoration: underline;
}

.discovery-item__highlight {
  display: flex;
  gap: 12px;
  margin-bottom: 8px;
  align-items: baseline;
}

.discovery-item__highlight-label {
  min-width: 120px;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgb(var(--v-theme-primary));
}

.discovery-item__highlight-snippet {
  font-size: 0.9rem;
}

.discovery-item__highlight mark {
  background-color: rgba(var(--v-theme-secondary), 0.2);
  padding: 0 2px;
}

.standard-results-list .discovery-item:not(:last-child) {
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

@media (max-width: 959px) {
  .discovery-dashboard-view .v-card-text {
    padding-bottom: 16px;
  }
  .discovery-item__highlight {
    flex-direction: column;
  }
  .discovery-item__highlight-label {
    min-width: auto;
  }
}
</style>
