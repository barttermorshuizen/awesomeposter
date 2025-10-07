<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useDiscoveryListStore } from '@/stores/discoveryList'
import { fetchClientFeatureFlags } from '@/lib/feature-flags'
import { DASHBOARD_CLIENT_STORAGE_KEY } from './loadDiscoveryDashboard'

interface ClientOption {
  id: string
  name: string
  slug: string | null
}

const router = useRouter()
const route = useRoute()
const listStore = useDiscoveryListStore()
const { clientId, placeholderItems } = storeToRefs(listStore)

const clients = ref<ClientOption[]>([])
const clientsLoading = ref(false)
const clientsError = ref<string | null>(null)
const featureFlagMessage = ref<string | null>(null)
const featureFlagLoading = ref(false)
const featureFlagEnabled = ref(false)

const selectedClientId = computed({
  get: () => clientId.value ?? '',
  set: (value: string) => {
    const normalized = value?.trim() ? value.trim() : null
    listStore.setClientId(normalized)
  },
})

listStore.attachTelemetryHooks({
  onSearchLatency: (durationMs, context) => {
    // Placeholder for Story 5.2 telemetry wiring.
    console.debug('[DiscoveryDashboard] search latency hook (noop)', { durationMs, context })
  },
  onSseDegraded: (context) => {
    // Placeholder for Story 5.2 SSE degradation handling.
    console.debug('[DiscoveryDashboard] SSE degraded hook (noop)', context)
  },
})

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
  } catch (error) {
    clientsError.value = error instanceof Error ? error.message : String(error)
  } finally {
    clientsLoading.value = false
  }
}

async function ensureFeatureFlag(client: string | null) {
  featureFlagEnabled.value = false
  if (!client) {
    featureFlagMessage.value = 'Select a client to enable discovery filters.'
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
    } else {
      featureFlagMessage.value = null
    }
  } catch (error) {
    featureFlagMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    featureFlagLoading.value = false
  }
}

onMounted(() => {
  listStore.initializeFromRoute(route)
  void loadClients()
  void ensureFeatureFlag(clientId.value ?? null)
})

watch(clientId, (id) => {
  if (typeof window !== 'undefined') {
    if (id) {
      window.localStorage.setItem(DASHBOARD_CLIENT_STORAGE_KEY, id)
    } else {
      window.localStorage.removeItem(DASHBOARD_CLIENT_STORAGE_KEY)
    }
  }
  void ensureFeatureFlag(id ?? null)
})

watch(
  () => ({
    client: listStore.clientId,
    status: [...listStore.filters.status],
    sources: [...listStore.filters.sourceIds],
    topics: [...listStore.filters.topicIds],
    search: listStore.filters.search,
    page: listStore.pagination.page,
    pageSize: listStore.pagination.pageSize,
  }),
  () => {
    listStore.syncRoute(router, route)
  },
  { deep: true },
)

function simulateRefreshLatency() {
  // Placeholder load timer to prove telemetry hook wiring without backend calls.
  const durationMs = 120
  listStore.recordSearchLatency(durationMs, { reason: 'scaffold-refresh' })
}

const virtualizationItems = computed(() => placeholderItems.value)
</script>

<template>
  <v-container class="py-8 discovery-dashboard-view">
    <v-row class="align-center mb-6">
      <v-col cols="12" md="7" class="d-flex align-center gap-3">
        <v-icon icon="mdi-view-dashboard-edit-outline" size="36" />
        <div>
          <h1 class="text-h5 text-md-h4 mb-1">Discovery dashboard</h1>
          <p class="text-body-2 text-medium-emphasis mb-0">
            Foundation shell for filters, list virtualization, and client-scoped review workspace.
          </p>
        </div>
      </v-col>
      <v-col cols="12" md="5" class="d-flex justify-end">
        <v-btn
          color="primary"
          variant="tonal"
          class="text-none"
          :disabled="featureFlagLoading"
          @click="simulateRefreshLatency"
        >
          Simulate refresh telemetry
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
          Selection persists locally; gating checks reuse this client on reload.
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

    <v-row v-if="featureFlagEnabled" class="g-4">
      <v-col cols="12" md="4">
        <v-card elevation="2" class="h-100">
          <v-card-title class="text-subtitle-1">Filter scaffolding</v-card-title>
          <v-card-text>
            <v-skeleton-loader
              type="chip@3"
              class="mb-4"
              :loading="false"
            />
            <div class="text-body-2 text-medium-emphasis mb-2">
              Filters (status, topics, sources) will mount here in Story 5.1.
            </div>
            <v-divider class="my-4" />
            <v-skeleton-loader type="text" class="mb-2" />
            <v-skeleton-loader type="text" class="mb-2" />
            <v-skeleton-loader type="text" />
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" md="8">
        <v-card elevation="2" class="h-100 d-flex flex-column">
          <v-card-title class="d-flex justify-space-between align-center flex-wrap gap-3">
            <span class="text-subtitle-1">Virtualized list placeholder</span>
            <v-chip color="primary" label size="small" variant="tonal">
              VVirtualScroll scaffold
            </v-chip>
          </v-card-title>
          <v-card-text class="pt-0 flex-grow-1 d-flex flex-column">
            <VVirtualScroll
              class="flex-grow-1"
              :items="virtualizationItems"
              height="460"
              :item-height="96"
            >
              <template #default="{ item }">
                <v-card variant="tonal" class="mb-2" :key="item.id">
                  <v-card-title class="text-subtitle-2 d-flex justify-space-between align-center">
                    <span>{{ item.title }}</span>
                    <v-chip size="x-small" color="secondary" variant="tonal">
                      Score {{ item.score.toFixed(2) }}
                    </v-chip>
                  </v-card-title>
                  <v-card-text class="text-body-2 text-medium-emphasis">
                    {{ item.summary }}
                  </v-card-text>
                </v-card>
              </template>
            </VVirtualScroll>
            <div class="text-caption text-medium-emphasis mt-3">
              Virtual scroll integrates with discovery list store; Story 5.1 will replace placeholder items with API data.
            </div>
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

@media (max-width: 959px) {
  .discovery-dashboard-view .v-card-text {
    padding-bottom: 16px;
  }
}
</style>
