<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  deriveDuplicateKey,
  normalizeDiscoverySourceUrl,
  type DiscoverySourceType,
  type DiscoverySourceCreatedEvent,
} from '@awesomeposter/shared'
import { subscribeToDiscoveryEvents } from '@/lib/discovery-sse'

const props = defineProps<{
  clientId: string
  mode?: 'embedded' | 'standalone'
}>()

const mode = computed(() => props.mode ?? 'embedded')

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

const sources = ref<SourceItem[]>([])
let unsubscribeFromSse: (() => void) | null = null

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

watch(
  () => props.clientId,
  async (id, oldId) => {
    if (id === oldId) return
    if (!id) {
      resetState()
      destroySse()
      return
    }
    resetState()
    await loadSources()
    attachSse()
  },
)

const duplicateKeySet = computed(() => {
  const set = new Set<string>()
  for (const item of sources.value) {
    set.add(`${item.sourceType}::${item.identifier.toLowerCase()}`)
  }
  return set
})

function resetState() {
  sources.value = []
  error.value = null
  form.url = ''
  form.notes = ''
  fieldErrors.url = undefined
  fieldErrors.notes = undefined
  detectionSummary.value = null
  duplicateWarning.value = null
  submitLoading.value = false
  loading.value = false
}

async function loadSources() {
  const clientId = props.clientId
  if (!clientId) return
  loading.value = true
  error.value = null
  try {
    const res = await fetch(`/api/clients/${clientId}/sources`, { headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    sources.value = Array.isArray(data?.items) ? data.items : []
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

function attachSse() {
  detachSse()
  const clientId = props.clientId
  if (!clientId) return
  unsubscribeFromSse = subscribeToDiscoveryEvents(clientId, {
    onSourceCreated: handleSourceCreated,
  })
}

function detachSse() {
  if (unsubscribeFromSse) {
    unsubscribeFromSse()
    unsubscribeFromSse = null
  }
}

async function submit() {
  const clientId = props.clientId
  if (!clientId) return
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
    clientId,
    url: form.url,
    canonicalUrl: normalized.canonicalUrl,
    sourceType: normalized.sourceType,
    identifier: normalized.identifier,
    notes: form.notes || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pending: true,
    pendingKey: dupKey,
  }
  sources.value = [pendingItem, ...sources.value]

  try {
    const res = await fetch(`/api/clients/${clientId}/sources`, {
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

function resetForm() {
  form.url = ''
  form.notes = ''
  fieldErrors.url = undefined
  fieldErrors.notes = undefined
  detectionSummary.value = null
  duplicateWarning.value = null
}

async function onDelete(item: SourceItem) {
  const clientId = props.clientId
  if (!clientId || !item?.id) return
  if (!confirm('Remove this discovery source?')) return
  sources.value = sources.value.map((s) => (s.id === item.id ? { ...s, pending: true } : s))
  try {
    const res = await fetch(`/api/clients/${clientId}/sources/${item.id}`, {
      method: 'DELETE',
      headers: { accept: 'application/json' },
    })
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>
      const message = typeof payload?.message === 'string' ? payload.message : undefined
      throw new Error(message || `HTTP ${res.status}`)
    }
    sources.value = sources.value.filter((s) => s.id !== item.id)
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Failed to delete source')
    sources.value = sources.value.map((s) => (s.id === item.id ? { ...s, pending: false } : s))
  }
}

function handleSourceCreated(payload: DiscoverySourceCreatedEvent['payload']) {
  const clientId = props.clientId
  if (!clientId || payload.clientId !== clientId) return
  const dupKey = `${payload.sourceType}::${payload.identifier.toLowerCase()}`
  if (duplicateKeySet.value.has(dupKey)) return

  sources.value = [
    {
      id: payload.id,
      clientId: payload.clientId,
      url: payload.url,
      canonicalUrl: payload.canonicalUrl,
      sourceType: payload.sourceType,
      identifier: payload.identifier,
      notes: null,
      createdAt: payload.createdAt,
      updatedAt: payload.createdAt,
    },
    ...sources.value,
  ]
}

onMounted(() => {
  if (props.clientId) {
    loadSources()
    attachSse()
  }
})

onBeforeUnmount(() => {
  detachSse()
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

const hasSources = computed(() => sources.value.length > 0)
</script>

<template>
  <div>
    <p v-if="mode === 'embedded'" class="text-body-2 text-medium-emphasis mb-4">
      Add feeds or channels to automatically ingest discovery content for this client.
    </p>

    <v-row v-if="mode === 'standalone'" class="g-4">
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
              <v-progress-circular v-if="loading" indeterminate color="primary" size="20" />
            </div>

            <v-alert
              v-if="error"
              type="error"
              density="comfortable"
              class="mb-4"
              :text="error"
            />

            <v-list v-if="hasSources" density="comfortable" lines="two">
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
                    <v-progress-circular v-else size="18" width="2" indeterminate />
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

    <div v-else>
      <v-alert
        v-if="error"
        type="error"
        density="comfortable"
        class="mb-4"
        :text="error"
      />

      <v-form @submit.prevent="submit">
        <v-row class="align-end" dense>
          <v-col cols="12" md="6">
            <v-text-field
              v-model="form.url"
              label="Source URL"
              variant="outlined"
              density="comfortable"
              :error-messages="fieldErrors.url ? [fieldErrors.url] : []"
              prepend-inner-icon="mdi-link"
              autocomplete="off"
              required
              hide-details="auto"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-textarea
              v-model="form.notes"
              label="Notes (optional)"
              variant="outlined"
              density="comfortable"
              rows="3"
              hide-details="auto"
            />
          </v-col>
          <v-col cols="12">
            <div class="d-flex flex-wrap align-center gap-3 mb-3">
              <v-alert
                v-if="duplicateWarning"
                type="warning"
                density="comfortable"
                variant="tonal"
                class="ma-0"
                :text="duplicateWarning"
              />
              <v-chip
                v-if="detectionSummary"
                size="small"
                color="primary"
                variant="tonal"
              >
                {{ detectionSummary.sourceType }} · {{ detectionSummary.canonicalUrl }}
              </v-chip>
            </div>
            <v-btn
              type="submit"
              color="primary"
              :loading="submitLoading"
              prepend-icon="mdi-content-save"
            >
              Save Source
            </v-btn>
          </v-col>
        </v-row>
      </v-form>

      <v-divider class="my-6" />

      <div class="d-flex justify-space-between align-center mb-3">
        <h3 class="text-subtitle-1 mb-0">Existing sources</h3>
        <v-progress-circular v-if="loading" indeterminate color="primary" size="20" />
      </div>

      <v-list v-if="hasSources" density="comfortable" lines="two">
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
              <v-progress-circular v-else size="18" width="2" indeterminate />
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

      <div v-else class="text-medium-emphasis">
        No discovery sources yet.
      </div>
    </div>
  </div>
</template>

<style scoped>
.gap-3 {
  gap: 12px;
}
.g-4 {
  row-gap: 16px;
}
</style>
