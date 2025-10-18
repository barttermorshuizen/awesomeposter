import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  DISCOVERY_BULK_SELECTION_LIMIT,
  type DiscoveryBulkActionResponse,
  type DiscoveryBulkFiltersSnapshot,
} from '@awesomeposter/shared'

function cloneSnapshot(snapshot: DiscoveryBulkFiltersSnapshot): DiscoveryBulkFiltersSnapshot {
  return {
    status: [...snapshot.status],
    sourceIds: [...snapshot.sourceIds],
    topicIds: [...snapshot.topicIds],
    search: snapshot.search,
    dateFrom: snapshot.dateFrom ?? null,
    dateTo: snapshot.dateTo ?? null,
    pageSize: snapshot.pageSize,
  }
}

export const useBulkSelectionStore = defineStore('discoveryBulkSelection', () => {
  const selectedIds = ref<string[]>([])
  const featureEnabled = ref(false)
  const selectionClientId = ref<string | null>(null)
  const limitWarning = ref<string | null>(null)
  const filtersSnapshot = ref<DiscoveryBulkFiltersSnapshot | null>(null)
  const lastActionResponse = ref<DiscoveryBulkActionResponse | null>(null)
  const visibleItemIds = ref<Set<string>>(new Set())

  const selectionCount = computed(() => selectedIds.value.length)
  const selectionLimit = DISCOVERY_BULK_SELECTION_LIMIT
  const limitReached = computed(() => selectionCount.value >= selectionLimit)
  const hasSelection = computed(() => selectionCount.value > 0)
  const hiddenSelectionCount = computed(() =>
    selectedIds.value.filter((id) => !visibleItemIds.value.has(id)).length,
  )
  const visibleSelectionCount = computed(() => selectionCount.value - hiddenSelectionCount.value)

  function setFeatureEnabled(enabled: boolean) {
    featureEnabled.value = enabled
    if (!enabled) {
      clearSelection()
    }
  }

  function setClientId(clientId: string | null) {
    if (selectionClientId.value && clientId !== selectionClientId.value) {
      clearSelection()
    }
    selectionClientId.value = clientId ?? null
  }

  function addItem(id: string) {
    if (!id) {
      return
    }
    if (selectedIds.value.includes(id)) {
      return
    }
    if (selectionCount.value >= selectionLimit) {
      limitWarning.value = `You can select up to ${selectionLimit} discovery items at a time.`
      return
    }
    selectedIds.value = [...selectedIds.value, id]
    limitWarning.value = null
  }

  function removeItem(id: string) {
    if (!id) {
      return
    }
    if (!selectedIds.value.includes(id)) {
      return
    }
    selectedIds.value = selectedIds.value.filter((entry) => entry !== id)
    if (selectionCount.value < selectionLimit) {
      limitWarning.value = null
    }
    if (!selectedIds.value.length) {
      filtersSnapshot.value = null
    }
  }

  function toggleItem(id: string) {
    if (selectedIds.value.includes(id)) {
      removeItem(id)
    } else {
      addItem(id)
    }
  }

  function clearSelection() {
    selectedIds.value = []
    limitWarning.value = null
    filtersSnapshot.value = null
    lastActionResponse.value = null
  }

  function isSelected(id: string) {
    return selectedIds.value.includes(id)
  }

  function captureFiltersSnapshot(snapshot: DiscoveryBulkFiltersSnapshot) {
    if (!selectedIds.value.length) {
      return
    }
    filtersSnapshot.value = cloneSnapshot(snapshot)
  }

  function ensureFiltersSnapshot(fallback: () => DiscoveryBulkFiltersSnapshot): DiscoveryBulkFiltersSnapshot {
    if (filtersSnapshot.value) {
      return cloneSnapshot(filtersSnapshot.value)
    }
    const snapshot = fallback()
    filtersSnapshot.value = cloneSnapshot(snapshot)
    return snapshot
  }

  function registerVisibleItems(ids: string[]) {
    visibleItemIds.value = new Set(ids)
  }

  function applyActionResponse(response: DiscoveryBulkActionResponse) {
    lastActionResponse.value = response
    const successfulIds = response.results
      .filter((result) => result.status === 'success')
      .map((result) => result.itemId)
    if (successfulIds.length) {
      selectedIds.value = selectedIds.value.filter((id) => !successfulIds.includes(id))
    }
    if (!selectedIds.value.length) {
      filtersSnapshot.value = null
    }
  }

  return {
    selectedIds,
    selectionCount,
    selectionLimit,
    limitReached,
    limitWarning,
    hasSelection,
    hiddenSelectionCount,
    visibleSelectionCount,
    featureEnabled,
    filtersSnapshot,
    lastActionResponse,
    setFeatureEnabled,
    setClientId,
    addItem,
    removeItem,
    toggleItem,
    clearSelection,
    isSelected,
    captureFiltersSnapshot,
    ensureFiltersSnapshot,
    registerVisibleItems,
    applyActionResponse,
  }
})
