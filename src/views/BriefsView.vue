<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import AgentResultsPopup from '@/components/AgentResultsPopup.vue'

type Brief = {
  id: string
  title: string | null
  clientId: string
  clientName: string | null
  objective: string | null
  status: 'draft' | 'approved' | 'sent' | 'published' | null
  audienceId?: string | null
  deadlineAt?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

const loading = ref(false)
const error = ref<string | null>(null)
const items = ref<Brief[]>([])
const search = ref('')
const router = useRouter()
const approvingId = ref<string | null>(null)
const deletingId = ref<string | null>(null)

const createPostOpen = ref(false)
const selectedBrief = ref<Brief | null>(null)
function onCreatePost(row: Brief): void { selectedBrief.value = row; createPostOpen.value = true }

const headers = [
  { title: 'Title', key: 'title' },
  { title: 'Client', key: 'clientName' },
  { title: 'Objective', key: 'objective' },
  { title: 'Status', key: 'status' },
  { title: 'Deadline', key: 'deadlineAt' },
  { title: 'Created', key: 'createdAt', align: 'end' },
  { title: '', key: 'actions', align: 'end', sortable: false, width: 1 },
] as const

const formattedItems = computed(() =>
  items.value.map((b) => ({
    ...b,
    title: b.title || '(untitled)',
    objective: b.objective || '',
    status: b.status || 'draft',
    deadlineAt: b.deadlineAt ? new Date(b.deadlineAt).toLocaleString() : '',
    createdAt: b.createdAt ? new Date(b.createdAt).toLocaleString() : '',
  })),
)

async function load() {
  loading.value = true
  error.value = null
  try {
    const res = await fetch('/api/briefs', { headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const ctype = res.headers.get('content-type') || ''
    if (!ctype.includes('application/json')) {
      await res.text().catch(() => '')
      throw new Error('API returned non-JSON (likely HTML). Ensure the API server is running: npm run dev:api')
    }
    const data = await res.json()
    items.value = Array.isArray(data?.items) ? data.items : []
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

onMounted(load)

// No-op handlers for now
function onNewBrief(): void { router.push({ name: 'briefs-new' }) }
function onEdit(row: Brief): void { router.push({ name: 'briefs-edit', params: { id: row.id } }) }
async function onDelete(row: Brief): Promise<void> {
  if (deletingId.value) return
  const confirmed = confirm('Delete this brief? This permanently removes the brief and any uploaded assets tied to it.')
  if (!confirmed) return

  deletingId.value = row.id
  try {
    const res = await fetch(`/api/briefs/${row.id}`, {
      method: 'DELETE',
      headers: { accept: 'application/json' }
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data?.ok !== true) {
      throw new Error(data?.statusMessage || data?.error || 'Failed to delete brief')
    }

    items.value = items.value.filter((b) => b.id !== row.id)
    if (selectedBrief.value?.id === row.id) {
      selectedBrief.value = null
      createPostOpen.value = false
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error deleting brief'
    alert(message)
  } finally {
    deletingId.value = null
  }
}

async function onApprove(row: Brief): Promise<void> {
  if (row.status !== 'draft') return
  approvingId.value = row.id
  try {
    const res = await fetch(`/api/briefs/${row.id}/approve`, {
      method: 'POST',
      headers: { accept: 'application/json' }
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data?.ok !== true) {
      throw new Error(data?.statusMessage || data?.error || 'Failed to approve brief')
    }
    // Update local row status without refetching all items
    items.value = items.value.map((b) =>
      b.id === row.id ? { ...b, status: 'approved', updatedAt: new Date().toISOString() } : b
    )
  } catch (e: unknown) {
    alert((e as Error)?.message || 'Unknown error approving brief')
  } finally {
    approvingId.value = null
  }
}

function statusColor(status?: string | null): string {
  switch (status) {
    case 'approved': return 'success'
    case 'sent': return 'info'
    case 'published': return 'indigo'
    case 'draft':
    default: return 'grey'
  }
}
</script>

<template>
  <v-container class="py-8">
    <v-row class="align-center mb-4">
      <v-col cols="12" md="6" class="d-flex align-center">
        <v-icon icon="mdi-file-document-edit-outline" class="me-2" />
        <h1 class="text-h5 text-md-h4 mb-0">Briefs</h1>
      </v-col>
      <v-col cols="12" md="6" class="d-flex justify-end">
        <v-btn color="primary" prepend-icon="mdi-file-plus-outline" @click="onNewBrief">
          New Brief
        </v-btn>
      </v-col>
    </v-row>

    <v-card elevation="2">
      <v-card-text>
        <div class="d-flex flex-wrap gap-2 mb-4">
          <v-text-field
            v-model="search"
            density="comfortable"
            variant="solo-filled"
            flat
            rounded
            prepend-inner-icon="mdi-magnify"
            placeholder="Search briefs"
            hide-details
          />
          <v-spacer />
        </div>

        <v-alert v-if="error" type="error" density="comfortable" class="mb-4" :text="error" />

        <v-data-table
          :headers="headers as any"
          :items="formattedItems"
          :search="search"
          :loading="loading"
          item-key="id"
          density="comfortable"
          class="elevation-0"
        >
          <template #[`item.title`]="{ item }">
            <div class="d-flex align-center">
              <v-avatar size="28" class="me-2" color="surface-variant">
                <span class="text-caption">{{ (item.title || '?').slice(0, 2).toUpperCase() }}</span>
              </v-avatar>
              <div class="text-body-2">{{ item.title }}</div>
            </div>
          </template>

          <template #[`item.clientName`]="{ item }">
            <span>{{ item.clientName || '—' }}</span>
          </template>

          <template #[`item.objective`]="{ item }">
            <span class="text-truncate">{{ item.objective || '—' }}</span>
          </template>

          <template #[`item.status`]="{ item }">
            <v-chip size="small" :color="statusColor(item.status)" variant="flat" class="text-capitalize">
              {{ (item.status || 'draft') }}
            </v-chip>
          </template>

          <template #[`item.deadlineAt`]="{ item }">
            <span class="text-no-wrap">{{ item.deadlineAt || '—' }}</span>
          </template>

          <template #[`item.createdAt`]="{ item }">
            <span class="text-no-wrap">{{ item.createdAt || '—' }}</span>
          </template>

          <template #[`item.actions`]="{ item }">
            <v-menu>
              <template #activator="{ props }">
                <v-btn v-bind="props" icon variant="text" size="small">
                  <v-icon icon="mdi-dots-vertical" />
                </v-btn>
              </template>
              <v-list density="comfortable">
                <v-list-item
                  prepend-icon="mdi-robot-outline"
                  title="Create post"
                  @click="onCreatePost(item as any)"
                />
                <v-list-item
                  prepend-icon="mdi-pencil-outline"
                  title="Edit"
                  @click="onEdit(item as any)"
                />
                <v-list-item
                  prepend-icon="mdi-check-circle-outline"
                  title="Approve"
                  :disabled="(item as any).status !== 'draft' || approvingId === (item as any).id"
                  @click="onApprove(item as any)"
                />
                <v-list-item
                  :prepend-icon="deletingId === (item as any).id ? 'mdi-progress-clock' : 'mdi-delete-outline'"
                  :title="deletingId === (item as any).id ? 'Deleting...' : 'Delete'"
                  :disabled="!!deletingId"
                  @click="onDelete(item as any)"
                />
              </v-list>
            </v-menu>
          </template>

          <template #loading>
            <div class="pa-6 w-100">
              <v-progress-linear indeterminate color="primary" />
            </div>
          </template>

          <template #no-data>
            <div class="pa-6 text-center text-medium-emphasis">
              No briefs yet.
            </div>
          </template>
        </v-data-table>
      </v-card-text>
    </v-card>

    <AgentResultsPopup
      v-model="createPostOpen"
      :brief="selectedBrief ? { id: selectedBrief.id, clientId: selectedBrief.clientId, title: selectedBrief.title, objective: selectedBrief.objective, audienceId: selectedBrief.audienceId ?? null } : null"
    />
  </v-container>
</template>

<style scoped>
.gap-2 {
  gap: 8px;
}
.text-truncate {
  max-width: 420px;
  display: inline-block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
