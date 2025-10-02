<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  normalizeDiscoverySourceUrl,
  deriveDuplicateKey,
  type DiscoverySourceType,
} from '@awesomeposter/shared'

type SourceItem = {
  id: string
  clientId: string
  url: string
  canonicalUrl: string
  sourceType: DiscoverySourceType
  identifier: string
  notes: string | null
  createdAt: string
  updatedAt: string
  pending?: boolean
  pendingKey?: string
}

const route = useRoute()
const clientId = computed(() => {
  const raw = route.params.id
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) return raw[0] ?? ''
  return ''
})

const loading = ref(false)
const submitLoading = ref(false)
const error = ref<string | null>(null)
const form = reactive({
  url: '',
  notes: '',
})
const fieldErrors = reactive<{ url?: string; notes?: string }>({})
const detectionSummary = ref<{ sourceType: DiscoverySourceType; canonicalUrl: string } | null>(null)
const duplicateWarning = ref<string | null>(null)
const sources = ref<SourceItem[]>([])
let sse: EventSource | null = null
let retryHandle: ReturnType<typeof setTimeout> | null = null

const duplicateKeySet = computed(() => {
  const set = new Set<string>()
  for (const item of sources.value) {
    set.add(`${item.sourceType}::${item.identifier.toLowerCase()}`)
  }
  return set
})

function resetForm() {
  form.url = ''
  form.notes = ''
  fieldErrors.url = undefined
  duplicateWarning.value = null
  detectionSummary.value = null
}

async function loadSources() {
  if (!clientId.value) return
  loading.value = true
  error.value = null
  try {
    const res = await fetch(`/api/clients/${clientId.value}/sources`, { headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    sources.value = Array.isArray(data?.items) ? data.items : []
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

watch(
  () => form.url,
  (value) => {
    if (!value.trim()) {
      detectionSummary.value = null
      duplicateWarning.value = null
      fieldErrors.url = undefined
      return
    }
    try {
      const normalized = normalizeDiscoverySourceUrl(value)
      detectionSummary.value = {
        sourceType: normalized.sourceType,
        canonicalUrl: normalized.canonicalUrl,
      }
      const dupKey = deriveDuplicateKey(normalized)
      duplicateWarning.value = duplicateKeySet.value.has(dupKey)
        ? 'This source already exists for the client.'
        : null
      fieldErrors.url = undefined
    } catch (err) {
      detectionSummary.value = null
      duplicateWarning.value = null
      fieldErrors.url = err instanceof Error ? err.message : 'Enter a valid URL'
    }
  },
)

async function submit() {
  if (!clientId.value) return
  fieldErrors.url = undefined
  duplicateWarning.value = null

  let normalized: ReturnType<typeof normalizeDiscoverySourceUrl>
  try {
    normalized = normalizeDiscoverySourceUrl(form.url)
  } catch (err) {
    fieldErrors.url = err instanceof Error ? err.message : 'Enter a valid URL'
    return
  }

  const dupKey = deriveDuplicateKey(normalized)
  if (duplicateKeySet.value.has(dupKey)) {
    duplicateWarning.value = 'This source already exists for the client.'
    fieldErrors.url = 'Duplicate source'
    return
  }

  submitLoading.value = true
  const optimisticId = `tmp-${Date.now()}`
  const pendingItem: SourceItem = {
    id: optimisticId,
    clientId: clientId.value,
    url: normalized.url,
    canonicalUrl: normalized.canonicalUrl,
    sourceType: normalized.sourceType,
    identifier: normalized.identifier,
    notes: form.notes.trim() ? form.notes.trim() : null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pending: true,
    pendingKey: dupKey,
  }
  sources.value = [pendingItem, ...sources.value]

  try {
    const res = await fetch(`/api/clients/${clientId.value}/sources`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        url: form.url,
        notes: form.notes.trim() ? form.notes.trim() : undefined,
      }),
    })

    if (!res.ok) {
      const message = await res.text().catch(() => `HTTP ${res.status}`)
      throw new Error(message || `HTTP ${res.status}`)
    }
    const data = await res.json()
    const record = data?.source as SourceItem | undefined
    if (record) {
      const idx = sources.value.findIndex((s) => s.pending && s.pendingKey === dupKey)
      if (idx !== -1) {
        sources.value.splice(idx, 1, {
          ...record,
          pending: false,
        })
      } else {
        sources.value = [record, ...sources.value]
      }
    }
    resetForm()
  } catch (err) {
    sources.value = sources.value.filter((s) => s.id !== optimisticId)
    alert(err instanceof Error ? err.message : 'Failed to create source')
  } finally {
    submitLoading.value = false
  }
}

async function onDelete(item: SourceItem) {
  if (!clientId.value || !item?.id) return
  const confirmed = confirm('Remove this source?')
  if (!confirmed) return
  try {
    const res = await fetch(`/api/clients/${clientId.value}/sources/${item.id}`, {
      method: 'DELETE',
      headers: { accept: 'application/json' },
    })
    if (!res.ok) {
      const message = await res.text().catch(() => `HTTP ${res.status}`)
      throw new Error(message || `HTTP ${res.status}`)
    }
    sources.value = sources.value.filter((s) => s.id !== item.id)
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Failed to delete source')
  }
}

function handleSseEvent(event: MessageEvent<string>) {
  try {
    const data = JSON.parse(event.data)
    if (data?.type !== 'source-created') return
    const payload = data.payload as Partial<SourceItem>
    if (!payload || payload.clientId !== clientId.value || !payload.id) return
    const dupKey = `${payload.sourceType}::${String(payload.identifier).toLowerCase()}`
    if (duplicateKeySet.value.has(dupKey)) return
    sources.value = [
      {
        id: payload.id,
        clientId: payload.clientId!,
        url: payload.url!,
        canonicalUrl: payload.canonicalUrl!,
        sourceType: payload.sourceType as DiscoverySourceType,
        identifier: payload.identifier!,
        notes: null,
        createdAt: payload.createdAt || new Date().toISOString(),
        updatedAt: payload.createdAt || new Date().toISOString(),
      },
      ...sources.value,
    ]
  } catch (err) {
    console.error('Failed to parse discovery SSE payload', err)
  }
}

function connectSse() {
  if (!clientId.value) return
  if (retryHandle) {
    clearTimeout(retryHandle)
    retryHandle = null
  }
  const url = new URL('/api/discovery/events.stream', window.location.origin)
  url.searchParams.set('clientId', clientId.value)
  sse = new EventSource(url.toString(), { withCredentials: true })
  sse.addEventListener('message', handleSseEvent)
  sse.addEventListener('error', () => {
    sse?.close()
    retryHandle = setTimeout(connectSse, 2000)
  })
}

onMounted(() => {
  loadSources()
  connectSse()
})

onBeforeUnmount(() => {
  if (sse) {
    sse.removeEventListener('message', handleSseEvent)
    sse.close()
    sse = null
  }
  if (retryHandle) {
    clearTimeout(retryHandle)
    retryHandle = null
  }
})

const typeIcon = (type: DiscoverySourceType) => {
  switch (type) {
    case 'rss':
      return 'mdi-rss'
    case 'youtube-channel':
      return 'mdi-youtube'
    case 'youtube-playlist':
      return 'mdi-youtube-play'
    default:
      return 'mdi-web'
  }
}
</script>

<template>
  <v-container class="py-8">
    <v-row class="mb-4 align-center">
      <v-col cols="12" md="8" class="d-flex align-center">
        <v-btn
          icon="mdi-arrow-left"
          variant="text"
          class="me-3"
          :to="{ name: 'clients-edit', params: { id: clientId } }"
        />
        <div>
          <h1 class="text-h5 text-md-h4 mb-1">Discovery Sources</h1>
          <p class="text-body-2 text-medium-emphasis mb-0">
            Add RSS feeds, YouTube channels/playlists, or websites to ingest for this client.
          </p>
        </div>
      </v-col>
    </v-row>

    <v-row>
      <v-col cols="12" md="5">
        <v-card elevation="2" class="mb-6">
          <v-card-text>
            <h2 class="text-subtitle-1 mb-4">Add Source</h2>
            <v-form @submit.prevent="submit">
              <v-text-field
                v-model="form.url"
                label="Source URL"
                variant="solo-filled"
                density="comfortable"
                :error-messages="fieldErrors.url ? [fieldErrors.url] : []"
                prepend-inner-icon="mdi-link"
                autocomplete="off"
                required
              />
              <v-textarea
                v-model="form.notes"
                label="Notes (optional)"
                variant="solo-filled"
                density="comfortable"
                rows="3"
              />

              <v-alert
                v-if="duplicateWarning"
                type="warning"
                class="mb-3"
                density="comfortable"
                :text="duplicateWarning"
              />

              <div v-if="detectionSummary" class="d-flex align-center gap-2 mb-3">
                <v-chip size="small" color="primary" variant="tonal">
                  {{ detectionSummary.sourceType }}
                </v-chip>
                <span class="text-caption text-medium-emphasis">{{ detectionSummary.canonicalUrl }}</span>
              </div>

              <v-btn
                type="submit"
                color="primary"
                :loading="submitLoading"
                block
                prepend-icon="mdi-content-save"
              >
                Save Source
              </v-btn>
            </v-form>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" md="7">
        <v-card elevation="2">
          <v-card-text>
            <div class="d-flex justify-space-between align-center mb-3">
              <h2 class="text-subtitle-1 mb-0">Existing sources</h2>
              <v-progress-circular
                v-if="loading"
                indeterminate
                color="primary"
                size="20"
              />
            </div>

            <v-alert
              v-if="error"
              type="error"
              density="comfortable"
              class="mb-4"
              :text="error"
            />

            <v-list v-if="sources.length" density="comfortable" lines="two">
              <v-list-item
                v-for="source in sources"
                :key="source.id"
                :title="source.url"
                :subtitle="new Date(source.createdAt).toLocaleString()"
              >
                <template #prepend>
                  <v-avatar size="32" :color="source.pending ? 'surface-variant' : 'surface'">
                    <v-icon :icon="typeIcon(source.sourceType)" />
                  </v-avatar>
                </template>
                <template #append>
                  <div class="d-flex align-center gap-2">
                    <v-chip size="small" variant="tonal">
                      {{ source.sourceType }}
                    </v-chip>
                    <v-btn
                      v-if="!source.pending"
                      icon="mdi-delete"
                      size="small"
                      variant="text"
                      @click="onDelete(source)"
                    />
                    <v-progress-circular
                      v-else
                      size="18"
                      width="2"
                      indeterminate
                    />
                  </div>
                </template>
                <template #subtitle>
                  <div class="text-body-2">
                    <div class="text-medium-emphasis">{{ source.canonicalUrl }}</div>
                    <div v-if="source.notes" class="text-caption">{{ source.notes }}</div>
                  </div>
                </template>
              </v-list-item>
            </v-list>

            <div v-else class="text-center py-10">
              <v-icon icon="mdi-rss" size="36" class="mb-2 text-medium-emphasis" />
              <p class="text-subtitle-2 mb-1">No sources yet</p>
              <p class="text-body-2 text-medium-emphasis mb-0">Add your first discovery source using the form.</p>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<style scoped>
.gap-2 {
  gap: 0.5rem;
}
</style>
