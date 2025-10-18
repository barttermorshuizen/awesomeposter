import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useBulkSelectionStore } from '@/stores/discovery/bulkSelection'
import { DISCOVERY_BULK_SELECTION_LIMIT } from '@awesomeposter/shared'

function buildSnapshot() {
  return {
    status: ['spotted'],
    sourceIds: ['source-1'],
    topicIds: ['topic-1'],
    search: 'analysis',
    dateFrom: null,
    dateTo: null,
    pageSize: 25,
  }
}

describe('useBulkSelectionStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('enforces the selection cap and surfaces warning when limit exceeded', () => {
    const store = useBulkSelectionStore()
    for (let index = 0; index < DISCOVERY_BULK_SELECTION_LIMIT; index += 1) {
      store.addItem(`item-${index}`)
    }
    expect(store.selectionCount).toBe(DISCOVERY_BULK_SELECTION_LIMIT)
    store.addItem('overflow-item')
    expect(store.selectionCount).toBe(DISCOVERY_BULK_SELECTION_LIMIT)
    expect(store.limitWarning).toContain('select up to')
  })

  it('captures filter snapshot only when a selection exists', () => {
    const store = useBulkSelectionStore()
    store.captureFiltersSnapshot(buildSnapshot())
    expect(store.filtersSnapshot).toBeNull()
    store.addItem('item-1')
    store.captureFiltersSnapshot(buildSnapshot())
    expect(store.filtersSnapshot).not.toBeNull()
    expect(store.filtersSnapshot?.status).toEqual(['spotted'])
  })

  it('retains conflicts after applying bulk action results', () => {
    const store = useBulkSelectionStore()
    store.addItem('item-success')
    store.addItem('item-conflict')

    store.applyActionResponse({
      actionId: '11111111-1111-1111-1111-111111111111',
      summary: {
        success: 1,
        conflict: 1,
        failed: 0,
        durationMs: 42,
      },
      results: [
        { itemId: 'item-success', status: 'success' },
        { itemId: 'item-conflict', status: 'conflict', message: 'Already processed elsewhere' },
      ],
    })

    expect(store.selectedIds).toEqual(['item-conflict'])
    expect(store.lastActionResponse?.summary.conflict).toBe(1)
  })
})
