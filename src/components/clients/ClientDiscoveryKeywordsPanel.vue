<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { normalizeDiscoveryKeyword } from '@awesomeposter/shared'
import { subscribeToDiscoveryEvents } from '@/lib/discovery-sse'

const props = defineProps<{ clientId: string }>()

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
    resetState()
    detachSse()
    if (!id) return
    await loadKeywords()
    attachSse()
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
  if (!clientId) return
  unsubscribeFromSse = subscribeToDiscoveryEvents(clientId, {
    onKeywordUpdated: async () => {
      if (!clientId) return
      await loadKeywords()
    },
  })
}

function detachSse() {
  if (unsubscribeFromSse) {
    unsubscribeFromSse()
    unsubscribeFromSse = null
  }
}

function mapKeyword(record: KeywordItem): KeywordItem {
  return {
    ...record,
    addedBy: record.addedBy ?? null,
  }
}

async function loadKeywords() {
  const clientId = props.clientId
  if (!clientId) return
  loading.value = true
  error.value = null
  try {
    const res = await fetch(`/api/clients/${clientId}/keywords`, { headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const items = Array.isArray(data?.items) ? data.items : []
    keywords.value = items.map(mapKeyword)
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
  if (!clientId) return

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
    if (!res.ok) {
      const message = await res.text().catch(() => `HTTP ${res.status}`)
      throw new Error(message || `HTTP ${res.status}`)
    }

    const data = await res.json()
    const record = data?.keyword as KeywordItem | undefined
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

    cancelEditing()
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Failed to save keyword')
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
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>
      const message = typeof payload?.message === 'string' ? payload.message : undefined
      throw new Error(message || `HTTP ${res.status}`)
    }
    keywords.value = keywords.value.filter((keyword) => keyword.id !== item.id)
    if (editingId.value === item.id) {
      cancelEditing()
    }
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Failed to delete keyword')
    keywords.value = keywords.value.map((keyword) =>
      keyword.id === item.id ? { ...keyword, pending: false } : keyword,
    )
  }
}

onMounted(() => {
  if (props.clientId) {
    loadKeywords()
    attachSse()
  }
})

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
              :disabled="limitReached && !editingId"
              prepend-icon="mdi-content-save"
            >
              {{ editingId ? 'Update Keyword' : 'Add Keyword' }}
            </v-btn>
            <v-btn v-if="editingId" variant="text" @click="cancelEditing">Cancel</v-btn>
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
                  :disabled="submitLoading && editingId === keyword.id"
                  @click="startEditing(keyword)"
                />
                <v-btn
                  v-if="!keyword.pending"
                  icon="mdi-delete"
                  size="small"
                  variant="text"
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
