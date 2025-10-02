<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

type Client = {
  id: string
  name: string
  slug: string | null
  website: string | null
  industry: string | null
  settingsJson?: Record<string, unknown>
  createdAt?: string | null
}

const loading = ref(false)
const error = ref<string | null>(null)
const items = ref<Client[]>([])
const search = ref('')
const deletingId = ref<string | null>(null)

const headers = [
  { title: 'Name', key: 'name' },
  { title: 'Website', key: 'website' },
  { title: 'Industry', key: 'industry' },
  { title: 'Created', key: 'createdAt', align: 'end' },
  { title: '', key: 'actions', align: 'end', sortable: false, width: 1 },
] as const

const formattedItems = computed(() =>
  items.value.map((c) => ({
    ...c,
    createdAt: c.createdAt ? new Date(c.createdAt).toLocaleString() : '',
  })),
)

async function load() {
  loading.value = true
  error.value = null
  try {
    const res = await fetch('/api/clients', { headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const ctype = res.headers.get('content-type') || ''
    if (!ctype.includes('application/json')) {
      // Read body to free the stream (ignore content)
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

// UI handlers (no-op for now)
function onNewClient(): void { router.push({ name: 'clients-new' }) }
function onEdit(row: Client): void { router.push({ name: 'clients-edit', params: { id: row.id } }) }
function onManageSources(row: Client): void {
  router.push({ name: 'clients-sources', params: { id: row.id } })
}
async function onDelete(row: Client) {
  if (!row?.id) return
  const confirmed = confirm('Delete this client? This will permanently remove all related data (briefs, assets, posts, tasks).')
  if (!confirmed) return
  deletingId.value = row.id
  try {
    const res = await fetch(`/api/clients/${row.id}`, {
      method: 'DELETE',
      headers: { accept: 'application/json' }
    })
    if (!res.ok) {
      const ctype = res.headers.get('content-type') || ''
      let message = `HTTP ${res.status}`
      if (ctype.includes('application/json')) {
        const data = await res.json().catch(() => ({}))
        message = (data?.statusMessage || data?.message || data?.error || message)
      } else {
        const text = await res.text().catch(() => '')
        if (text) message += `: ${text.slice(0, 120)}`
      }
      throw new Error(message)
    }
    // Drain body to free stream
    const ctypeOk = res.headers.get('content-type') || ''
    if (ctypeOk.includes('application/json')) {
      await res.json().catch(() => ({}))
    } else {
      await res.text().catch(() => '')
    }
    // Remove from local list
    items.value = items.value.filter(i => i.id !== row.id)
  } catch (e: unknown) {
    alert((e as Error)?.message || 'Failed to delete client')
  } finally {
    deletingId.value = null
  }
}
</script>

<template>
  <v-container class="py-8">
    <v-row class="align-center mb-4">
      <v-col cols="12" md="6" class="d-flex align-center">
        <v-icon icon="mdi-account-multiple-outline" class="me-2" />
        <h1 class="text-h5 text-md-h4 mb-0">Clients</h1>
      </v-col>
      <v-col cols="12" md="6" class="d-flex justify-end">
        <v-btn color="primary" prepend-icon="mdi-account-plus-outline" @click="onNewClient">
          New Client
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
            placeholder="Search clients"
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
          <template #[`item.name`]="{ item }">
            <div class="d-flex align-center">
              <v-avatar size="28" class="me-2" color="surface-variant">
                <span class="text-caption">{{ (item.name || '?').slice(0, 2).toUpperCase() }}</span>
              </v-avatar>
              <div class="text-body-2">{{ item.name }}</div>
            </div>
          </template>

          <template #[`item.website`]="{ item }">
            <a
              v-if="item.website"
              :href="item.website.startsWith('http') ? item.website : `https://${item.website}`"
              target="_blank"
              rel="noopener"
              class="text-primary text-decoration-none"
            >
              {{ item.website }}
            </a>
            <span v-else class="text-medium-emphasis">—</span>
          </template>

          <template #[`item.industry`]="{ item }">
            <span>{{ item.industry || '—' }}</span>
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
                  prepend-icon="mdi-pencil-outline"
                  title="Edit"
                  @click="onEdit(item as any)"
                />
                <v-list-item
                  prepend-icon="mdi-rss"
                  title="Discovery Sources"
                  @click="onManageSources(item as any)"
                />
                <v-list-item
                  prepend-icon="mdi-delete-outline"
                  title="Delete"
                  :disabled="deletingId === (item as any).id"
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
              No clients yet.
            </div>
          </template>
        </v-data-table>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<style scoped>
.gap-2 {
  gap: 8px;
}
</style>
