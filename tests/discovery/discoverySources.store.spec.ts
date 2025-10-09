import { beforeEach, describe, expect, it } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDiscoverySourcesStore } from '@/stores/discoverySources'

const CLIENT_ID = '11111111-1111-4111-8111-111111111111'
const SOURCE_ID = '22222222-2222-4222-8222-222222222222'

describe('useDiscoverySourcesStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('tracks list-enabled sources and warnings', () => {
    const store = useDiscoverySourcesStore()
    store.registerSources([
      {
        id: SOURCE_ID,
        clientId: CLIENT_ID,
        url: 'https://example.com/feed',
        canonicalUrl: 'https://example.com/feed',
        sourceType: 'web-page',
        identifier: 'example.com',
        notes: null,
        configJson: {
          webList: {
            list_container_selector: '.feed',
            item_selector: '.entry',
          },
        },
        updatedAt: new Date().toISOString(),
      },
    ])

    expect(store.listEnabledSourceIds.has(SOURCE_ID)).toBe(true)

    const updatedAt = new Date().toISOString()
    store.applySourceUpdate({
      sourceId: SOURCE_ID,
      clientId: CLIENT_ID,
      updatedAt,
      webListEnabled: true,
      webListConfig: {
        listContainerSelector: '.feed',
        itemSelector: '.entry',
        fields: {},
      },
      warnings: ['Verify selector depth'],
      suggestion: {
        id: 'suggestion-1',
        config: {
          listContainerSelector: '.feed-updated',
          itemSelector: '.entry',
          fields: {},
        },
        warnings: ['Check headline selector'],
        confidence: 0.9,
        receivedAt: updatedAt,
      },
    })

    const state = store.webListById[SOURCE_ID]
    expect(state?.warnings).toContain('Verify selector depth')
    expect(state?.suggestion?.id).toBe('suggestion-1')

    store.acknowledgeSuggestion(SOURCE_ID)
    expect(store.webListById[SOURCE_ID]?.suggestion?.acknowledged).toBe(true)

    store.dismissSuggestion(SOURCE_ID)
    expect(store.webListById[SOURCE_ID]?.suggestion).toBeNull()
  })

  it('manages dialog state', () => {
    const store = useDiscoverySourcesStore()
    store.registerSource({
      id: SOURCE_ID,
      clientId: CLIENT_ID,
      url: 'https://example.com/feed',
      canonicalUrl: 'https://example.com/feed',
      sourceType: 'web-page',
      identifier: 'example.com',
      notes: null,
      configJson: null,
      updatedAt: new Date().toISOString(),
    })

    store.openDialog(SOURCE_ID)
    expect(store.dialog.open).toBe(true)
    expect(store.dialog.sourceId).toBe(SOURCE_ID)

    store.setDialogDirty(true)
    expect(store.dialog.dirty).toBe(true)
    store.setDialogSaving(true)
    expect(store.dialog.saving).toBe(true)
    store.setDialogError('Example error')
    expect(store.dialog.error).toBe('Example error')

    store.beginPreview()
    expect(store.dialog.preview.status).toBe('loading')
    store.failPreview('Preview failed')
    expect(store.dialog.preview.status).toBe('error')
    expect(store.dialog.preview.error).toBe('Preview failed')

    store.finishPreview({
      item: {
        title: 'Example',
        url: 'https://example.com/item',
        excerpt: 'Summary',
        timestamp: new Date().toISOString(),
      },
      warnings: [],
      fetchedAt: new Date().toISOString(),
    })
    expect(store.dialog.preview.status).toBe('success')

    store.closeDialog()
    expect(store.dialog.open).toBe(false)
    expect(store.dialog.sourceId).toBeNull()
  })
})
