import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive, ref } from 'vue'
import DiscoveryDashboardView from '@/views/discovery/DiscoveryDashboardView.vue'

const loadFilterMetadataMock = vi.fn()
const fetchResultsMock = vi.fn()
const refreshMock = vi.fn()

function createStubStore() {
  const filters = reactive({
    status: ['spotted'],
    sourceIds: [] as string[],
    topicIds: [] as string[],
    search: '',
    dateFrom: null as string | null,
    dateTo: null as string | null,
  })
  const pagination = reactive({ page: 1, pageSize: 25 })
  const store = {
    filters,
    pagination,
    clientId: ref<string | null>(null),
    loading: ref(false),
    error: ref<string | null>(null),
    items: ref<any[]>([]),
    total: ref(0),
    latencyMs: ref<number | null>(null),
    degradeActive: ref(false),
    degradeReason: ref<'latency' | 'results' | 'other' | null>(null),
    sseDisconnected: ref(false),
    pollingActive: ref(false),
    sourceOptions: ref<any[]>([]),
    topicOptions: ref<any[]>([]),
    filterMetaLoading: ref(false),
    filterMetaError: ref<string | null>(null),
    virtualizationEnabled: ref(false),
    hasResults: ref(false),
    isEmptyState: ref(false),
    pageSizeOptions: ref([25, 50, 100]),
    datePreset: ref<'last48h' | 'custom'>('last48h'),
    detailVisible: ref(false),
    selectedItemId: ref<string | null>(null),
    selectedItemDetail: ref<any>(null),
    detailLoading: ref(false),
    detailError: ref<string | null>(null),
    promotionLoading: ref(false),
    promotionError: ref<string | null>(null),
    lastSearchTerm: '',
    loadFilterMetadata: loadFilterMetadataMock,
    fetchResults: fetchResultsMock,
    refresh: refreshMock,
    initializeFromRoute: vi.fn(),
    syncRoute: vi.fn(),
    attachTelemetryHooks: vi.fn(),
    setClientId: vi.fn((id: string | null) => {
      store.clientId.value = id
    }),
    setFilters: vi.fn((partial: Partial<typeof filters>) => Object.assign(filters, partial)),
    setPagination: vi.fn((partial: Partial<typeof pagination>) => Object.assign(pagination, partial)),
    resetFilters: vi.fn(),
    applyDefaultDatePreset: vi.fn(),
    setDatePreset: vi.fn((preset: 'last48h' | 'custom') => {
      store.datePreset.value = preset
    }),
    setDateRange: vi.fn(),
    handleTelemetryEvent: vi.fn(),
    markSseDisconnected: vi.fn(),
    markSseRecovered: vi.fn(),
    resetRealtimeState: vi.fn(),
    openItemDetail: vi.fn(),
    reloadSelectedItemDetail: vi.fn(),
    promoteSelectedItem: vi.fn().mockResolvedValue({}),
    closeItemDetail: vi.fn(),
    clearPromotionError: vi.fn(),
  }
  return store
}

let stubStore = createStubStore()

vi.mock('@/stores/discoveryList', () => ({
  DISCOVERY_MIN_SEARCH_LENGTH: 2,
  useDiscoveryListStore: () => stubStore,
}))

vi.mock('@/lib/feature-flags', () => ({
  fetchClientFeatureFlags: vi.fn().mockResolvedValue({ discoveryFiltersV1: true }),
}))

const subscribeMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/discovery-sse', () => ({
  subscribeToDiscoveryEvents: subscribeMock,
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useRoute: () => ({ query: {}, hash: '' }),
}))

const wrapperStub = { template: '<div><slot /></div>' }
const modelStub = { props: ['modelValue'], emits: ['update:modelValue'], template: '<div><slot /></div>' }
const VVirtualScrollStub = {
  props: ['items'],
  emits: ['scroll'],
  template: '<div><slot v-for="(item, index) in items" :item="item" :index="index" /></div>',
}

const vuetifyStubs = {
  'v-container': wrapperStub,
  'v-row': wrapperStub,
  'v-col': wrapperStub,
  'v-icon': { template: '<span><slot /></span>' },
  'v-btn': { props: ['modelValue'], emits: ['update:modelValue', 'click'], template: '<button @click="$emit(\'click\')"><slot /></button>' },
  'v-select': modelStub,
  'v-list-item': wrapperStub,
  'v-alert': wrapperStub,
  'v-card': wrapperStub,
  'v-card-title': wrapperStub,
  'v-card-text': wrapperStub,
  'v-chip': wrapperStub,
  'v-chip-group': modelStub,
  'v-autocomplete': modelStub,
  'v-btn-toggle': modelStub,
  'v-text-field': modelStub,
  'v-skeleton-loader': wrapperStub,
  'v-empty-state': wrapperStub,
  'v-divider': wrapperStub,
  'v-pagination': modelStub,
  DiscoveryItemDetailDrawer: wrapperStub,
  VVirtualScroll: VVirtualScrollStub,
}

describe('DiscoveryDashboardView', () => {
  beforeEach(() => {
    stubStore = createStubStore()
    loadFilterMetadataMock.mockResolvedValue(undefined)
    fetchResultsMock.mockResolvedValue(undefined)
    refreshMock.mockResolvedValue(undefined)
    subscribeMock.mockReturnValue(() => {})
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as any
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('renders degradation banner when store flags latency issues', async () => {
    stubStore.clientId.value = 'client-1'

    const wrapper = mount(DiscoveryDashboardView, { global: { stubs: vuetifyStubs } })
    await flushPromises()

    stubStore.degradeActive.value = true
    stubStore.degradeReason.value = 'latency'
    stubStore.pollingActive.value = true
    await flushPromises()

    expect(wrapper.html()).toContain('degraded mode')
  })

  it('renders discovery items card even without virtualization toggle', async () => {
    stubStore.clientId.value = 'client-2'
    stubStore.virtualizationEnabled.value = true

    const wrapper = mount(DiscoveryDashboardView, { global: { stubs: vuetifyStubs } })
    await flushPromises()

    expect(wrapper.html()).toContain('Discovery items')
  })
})
