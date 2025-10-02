# State Management
Each store follows the `defineStore` composition pattern already in use (`hitl`). Stores expose derived state, loading flags, optimistic queues, and SSE application hooks. Example:

```ts
// src/stores/discoveryBriefs.ts
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  DiscoveryBrief,
  DiscoveryBriefFilters,
  DiscoverySseEvent,
  DiscoveryBulkAction,
} from '@awesomeposter/shared'
import { fetchBriefs, promoteBriefs, archiveBriefs } from '@/services/discovery/briefs'

export const useDiscoveryBriefsStore = defineStore('discoveryBriefs', () => {
  const filters = ref<DiscoveryBriefFilters>({
    status: ['spotted'],
    sourceIds: [],
    topics: [],
    query: '',
    sort: { field: 'score', direction: 'desc' },
    page: 1,
    pageSize: 25,
  })
  const briefs = ref<DiscoveryBrief[]>([])
  const total = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const selectedIds = ref<Set<string>>(new Set())

  const hasSelection = computed(() => selectedIds.value.size > 0)

  async function load(force = false) {
    if (loading.value && !force) return
    loading.value = true
    error.value = null
    try {
      const response = await fetchBriefs(filters.value)
      briefs.value = response.items
      total.value = response.total
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Unable to load briefs.'
    } finally {
      loading.value = false
    }
  }

  function applySse(event: DiscoverySseEvent) {
    switch (event.type) {
      case 'brief-updated':
        upsertBrief(event.payload)
        break
      case 'brief-removed':
        briefs.value = briefs.value.filter(b => b.id !== event.payload.id)
        selectedIds.value.delete(event.payload.id)
        break
      case 'note-appended':
        updateNotes(event.payload)
        break
    }
  }

  async function runBulk(action: DiscoveryBulkAction) {
    const ids = Array.from(selectedIds.value)
    if (ids.length === 0) return
    try {
      if (action.kind === 'promote') {
        await promoteBriefs(ids, action.note)
      } else if (action.kind === 'archive') {
        await archiveBriefs(ids, action.reason)
      }
      selectedIds.value.clear()
    } finally {
      await load(true)
    }
  }

  return { filters, briefs, total, loading, error, selectedIds, hasSelection, load, applySse, runBulk }
})
```

- `discoverySources` mirrors the pattern with optimistic updates and background refresh for source health.
- `discoveryTelemetry` keeps rolling windows of aggregates and raw events for charting/export.
- Stores accept SSE frames so reconnect logic lives in one place rather than per component.
