<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { normalizeDiscoveryKeyword } from '@awesomeposter/shared'
import { subscribeToDiscoveryEvents, type DiscoveryFeatureDisabledPayload } from '@/lib/discovery-sse'

const props = defineProps<{ clientId: string; disabled?: boolean }>()

type KeywordItem = {
  id: string
  clientId: string
  keyword: string
  addedBy: string | null
  createdAt: string
  updatedAt: string
  pending?: boolean
}

const keywords = ref<KeywordItem[]>([])
const loading = ref(false)
const submitLoading = ref(false)
const error = ref<string | null>(null)
const fieldError = ref<string | null>(null)
const duplicateWarning = ref<string | null>(null)
const editingId = ref<string | null>(null)
const form = reactive({ keyword: '' })
let unsubscribeFromSse: (() => void) | null = null

const limitWarning = computed(() =>
  keywords.value.length >= 20 ? 'Keyword limit reached (20). Remove an existing keyword before adding another.' : null,
)

const featureDisabled = ref(false)
const featureDisabledMessage = ref('Discovery agent is disabled for this client.')
const disabled = computed(() => Boolean(props.disabled) || featureDisabled.value)
const disabledBannerMessage = computed(() => {
  if (props.disabled) return 'Discovery agent is disabled for this client.'
  return featureDisabled.value ? featureDisabledMessage.value : null
})

function hasDuplicate(duplicateKey: string, excludeId: string | null = null) {
  return keywords.value.some((item) => {
    if (excludeId && item.id === excludeId) return false
    try {
      const normalized = normalizeDiscoveryKeyword(item.keyword)
      return normalized.duplicateKey === duplicateKey
    } catch {
      return false
    }
  })
}

function markFeatureDisabled(message?: string) {
  featureDisabled.value = true
  featureDisabledMessage.value = message || 'Discovery agent is disabled for this client.'
  resetState()
  detachSse()
}

watch(
  () => form.keyword,
  (value) => {
    if (!value.trim()) {
      fieldError.value = null
      duplicateWarning.value = null
      return
    }
    try {
      const normalized = normalizeDiscoveryKeyword(value)
      duplicateWarning.value = hasDuplicate(normalized.duplicateKey, editingId.value)
        ? 'This keyword already exists for the client.'
        : null
      fieldError.value = null
    } catch (err) {
      duplicateWarning.value = null
      fieldError.value = err instanceof Error ? err.message : 'Enter a valid keyword'
    }
  },
)

watch(
  () => props.clientId,
  async (id, oldId) => {
    if (id === oldId) return
    detachSse()
    resetState()
    featureDisabled.value = Boolean(props.disabled)
    featureDisabledMessage.value = 'Discovery agent is disabled for this client.'
    if (!id || disabled.value) return
    await loadKeywords()
    if (!disabled.value) attachSse()
  },
  { immediate: true },
)

watch(
  () => props.disabled,
  async (value, oldValue) => {
    if (value === oldValue) return
    if (value) {
      featureDisabled.value = true
      featureDisabledMessage.value = 'Discovery agent is disabled for this client.'
      detachSse()
      return
    }
    featureDisabled.value = false
    featureDisabledMessage.value = 'Discovery agent is disabled for this client.'
    resetState()
    if (!props.clientId) return
    await loadKeywords()
    if (!disabled.value) attachSse()
  },
)

function resetState() {
  keywords.value = []
  error.value = null
  fieldError.value = null
  duplicateWarning.value = null
  editingId.value = null
  form.keyword = ''
  submitLoading.value = false
}

function attachSse() {
  detachSse()
  const clientId = props.clientId
  if (!clientId || disabled.value) return
  unsubscribeFromSse = subscribeToDiscoveryEvents(clientId, {
    onKeywordUpdated: async () => {
      if (!clientId) return
      await loadKeywords()
    },
    onFeatureDisabled: handleFeatureDisabled,
  })
}

function detachSse() {
  if (unsubscribeFromSse) {
    unsubscribeFromSse()
    unsubscribeFromSse = null
  }
}

function handleFeatureDisabled(payload: DiscoveryFeatureDisabledPayload) {
  const message = typeof payload?.message === 'string' && payload.message.trim()
    ? payload.message.trim()
    : undefined
  markFeatureDisabled(message)
}

function mapKeyword(record: KeywordItem): KeywordItem {
  return {
    ...record,
    addedBy: record.addedBy ?? null,
  }
}

async function loadKeywords() {
  const clientId = props.clientId
  if (!clientId || disabled.value) {
    loading.value = false
    return
  }
  loading.value = true
  error.value = null
  try {
    const res = await fetch(`/api/clients/${clientId}/keywords`, { headers: { accept: 'application/json' } })
    const contentType = res.headers.get('content-type') || ''
    let payload: any = null
    if (contentType.includes('application/json')) {
      payload = await res.json().catch(() => null)
    } else {
      payload = await res.text().catch(() => '')
    }
    if (!res.ok) {
      const disabledMessage =
        typeof payload === 'object' && payload && 'statusMessage' in payload
          ? String((payload as any).statusMessage || '')
          : undefined
      if (res.status === 403 && (payload?.code === 'feature_disabled' || payload?.statusCode === 403)) {
        markFeatureDisabled(disabledMessage || undefined)
        return
      }
      const message = typeof payload === 'string'
        ? (payload || `HTTP ${res.status}`)
        : (payload?.statusMessage || payload?.message || payload?.error || `HTTP ${res.status}`)
      throw new Error(message)
    }
    const items = Array.isArray((payload as any)?.items) ? (payload as any).items : []
    keywords.value = items.map(mapKeyword)
    featureDisabled.value = false
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

function startEditing(item: KeywordItem) {
  editingId.value = item.id
  form.keyword = item.keyword
  fieldError.value = null
  duplicateWarning.value = null
}

function cancelEditing() {
  editingId.value = null
  form.keyword = ''
  fieldError.value = null
  duplicateWarning.value = null
}

async function submit() {
  const clientId = props.clientId
  if (!clientId || disabled.value) return

  let normalized
  try {
    normalized = normalizeDiscoveryKeyword(form.keyword)
  } catch (err) {
    fieldError.value = err instanceof Error ? err.message : 'Invalid keyword'
    return
  }

  if (!editingId.value && keywords.value.length >= 20) {
    fieldError.value = 'Keyword limit reached'
    return
  }

  if (hasDuplicate(normalized.duplicateKey, editingId.value)) {
    duplicateWarning.value = 'This keyword already exists for the client.'
    fieldError.value = 'Duplicate keyword'
    return
  }

  submitLoading.value = true
  fieldError.value = null
  duplicateWarning.value = null

  const body = JSON.stringify({ keyword: normalized.cleaned })
  const requestInit: RequestInit = {
    method: editingId.value ? 'PATCH' : 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body,
  }

  const url = editingId.value
    ? `/api/clients/${clientId}/keywords/${editingId.value}`
    : `/api/clients/${clientId}/keywords`

  try {
    const res = await fetch(url, requestInit)
    if (res.status === 409) {
      duplicateWarning.value = 'This keyword already exists for the client.'
      fieldError.value = 'Duplicate keyword'
      return
    }
    if (res.status === 422) {
      fieldError.value = 'Keyword limit reached'
      return
    }
    const contentType = res.headers.get('content-type') || ''
    let payload: any = null
    if (contentType.includes('application/json')) {
      payload = await res.json().catch(() => null)
    } else {
      payload = await res.text().catch(() => '')
    }

    if (!res.ok) {
      const disabledMessage =
        typeof payload === 'object' && payload && 'statusMessage' in payload
          ? String((payload as any).statusMessage || '')
          : undefined
      if (res.status === 403 && (payload?.code === 'feature_disabled' || payload?.statusCode === 403)) {
        markFeatureDisabled(disabledMessage || undefined)
        throw new Error(disabledMessage || 'Discovery agent is disabled for this client.')
      }
      const message = typeof payload === 'string'
        ? (payload || `HTTP ${res.status}`)
        : (payload?.statusMessage || payload?.message || payload?.error || `HTTP ${res.status}`)
      throw new Error(message)
    }

    const data = payload ?? {}
    const record = (data as any)?.keyword as KeywordItem | undefined
    if (record) {
      const normalizedRecord = mapKeyword(record)
      if (editingId.value) {
        keywords.value = keywords.value.map((item) =>
          item.id === normalizedRecord.id ? { ...normalizedRecord } : item,
        )
      } else {
        keywords.value = [normalizedRecord, ...keywords.value]
      }
    }

    featureDisabled.value = false
    cancelEditing()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save keyword'
    if (featureDisabled.value) {
      error.value = message
    } else {
      alert(message)
    }
  } finally {
    submitLoading.value = false
  }
}

async function onDelete(item: KeywordItem) {
  const clientId = props.clientId
  if (!clientId || !item?.id) return
  if (!confirm('Remove this keyword?')) return

  keywords.value = keywords.value.map((keyword) =>
    keyword.id === item.id ? { ...keyword, pending: true } : keyword,
  )

  try {
    const res = await fetch(`/api/clients/${clientId}/keywords/${item.id}`, {
      method: 'DELETE',
      headers: { accept: 'application/json' },
    })
    const contentType = res.headers.get('content-type') || ''
    let payload: any = null
    if (contentType.includes('application/json')) {
      payload = await res.json().catch(() => null)
    } else {
      payload = await res.text().catch(() => '')
    }
    if (!res.ok) {
      const disabledMessage =
        typeof payload === 'object' && payload && 'statusMessage' in payload
          ? String((payload as any).statusMessage || '')
          : undefined
      if (res.status === 403 && (payload?.code === 'feature_disabled' || payload?.statusCode === 403)) {
        markFeatureDisabled(disabledMessage || undefined)
        throw new Error(disabledMessage || 'Discovery agent is disabled for this client.')
      }
      const message = typeof payload === 'string'
        ? (payload || `HTTP ${res.status}`)
        : (payload?.statusMessage || payload?.message || payload?.error || `HTTP ${res.status}`)
      throw new Error(message)
    }
    keywords.value = keywords.value.filter((keyword) => keyword.id !== item.id)
    if (editingId.value === item.id) {
      cancelEditing()
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete keyword'
    if (featureDisabled.value) {
      error.value = message
    } else {
      alert(message)
    }
    keywords.value = keywords.value.map((keyword) =>
      keyword.id === item.id ? { ...keyword, pending: false } : keyword,
    )
  }
}

onBeforeUnmount(() => {
  detachSse()
})

const limitReached = computed(() => keywords.value.length >= 20 && !editingId.value)
</script>

<template>
  <div>
    <v-card elevation="2" class="mb-6">
      <v-card-text>
        <h2 class="text-subtitle-1 mb-2">Manage keyword themes</h2>
        <p class="text-body-2 text-medium-emphasis mb-4">
          Keywords are stored in lowercase and used by the scoring service to focus relevance. Stick to ASCII characters.
        </p>

        <v-alert
          v-if="disabledBannerMessage"
          type="info"
          variant="tonal"
          density="comfortable"
          class="mb-3"
          :text="disabledBannerMessage"
        />

        <v-alert
          v-if="limitWarning"
          type="warning"
          density="comfortable"
          class="mb-3"
          :text="limitWarning"
        />

        <v-form @submit.prevent="submit">
          <v-text-field
            v-model="form.keyword"
            label="Keyword phrase"
            variant="solo-filled"
            density="comfortable"
            autocomplete="off"
            :error-messages="fieldError ? [fieldError] : []"
            :hint="editingId ? 'Updating existing keyword' : undefined"
            persistent-hint
            required
            :disabled="disabled"
          />

          <div class="d-flex flex-wrap align-center gap-3 mb-3">
            <v-alert
              v-if="duplicateWarning"
              type="warning"
              density="comfortable"
              variant="tonal"
              class="ma-0"
              :text="duplicateWarning"
            />
            <v-chip v-if="editingId" size="small" color="primary" variant="tonal">
              Editing keyword
            </v-chip>
          </div>

          <div class="d-flex align-center gap-2">
            <v-btn
              type="submit"
              color="primary"
              :loading="submitLoading"
              :disabled="disabled || (limitReached && !editingId)"
              prepend-icon="mdi-content-save"
            >
              {{ editingId ? 'Update Keyword' : 'Add Keyword' }}
            </v-btn>
            <v-btn v-if="editingId" variant="text" :disabled="disabled" @click="cancelEditing">Cancel</v-btn>
          </div>
        </v-form>
      </v-card-text>
    </v-card>

    <v-card elevation="2">
      <v-card-text>
        <div class="d-flex justify-space-between align-center mb-3">
          <h2 class="text-subtitle-1 mb-0">Current keywords</h2>
          <v-progress-circular v-if="loading" indeterminate color="primary" size="20" />
        </div>

        <v-alert
          v-if="error"
          type="error"
          density="comfortable"
          class="mb-4"
          :text="error"
        />

        <v-alert
          v-else-if="disabledBannerMessage"
          type="info"
          density="comfortable"
          variant="tonal"
          class="mb-4"
          :text="disabledBannerMessage"
        />

        <v-list v-if="keywords.length" density="comfortable">
          <v-list-item
            v-for="keyword in keywords"
            :key="keyword.id"
            :title="keyword.keyword"
            :subtitle="new Date(keyword.createdAt).toLocaleString()"
          >
            <template #append>
              <div class="d-flex align-center gap-2">
                <v-btn
                  icon="mdi-pencil"
                  size="small"
                  variant="text"
                  :disabled="disabled || (submitLoading && editingId === keyword.id)"
                  @click="startEditing(keyword)"
                />
                <v-btn
                  v-if="!keyword.pending"
                  icon="mdi-delete"
                  size="small"
                  variant="text"
                  :disabled="disabled"
                  @click="onDelete(keyword)"
                />
                <v-progress-circular v-else size="18" width="2" indeterminate />
              </div>
            </template>
          </v-list-item>
        </v-list>

        <div v-else class="text-medium-emphasis text-body-2">
          No keyword themes yet. Add your first keyword to guide scoring.
        </div>
      </v-card-text>
    </v-card>
  </div>
</template>

<style scoped>
.gap-2 {
  gap: 8px;
}
.gap-3 {
  gap: 12px;
}
</style>
