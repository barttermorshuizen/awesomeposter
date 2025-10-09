import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { createVuetify } from 'vuetify'
import * as vuetifyComponents from 'vuetify/components'
import * as vuetifyDirectives from 'vuetify/directives'
import SourceListConfigDialog from '@/components/discovery/SourceListConfigDialog.vue'
import { useDiscoverySourcesStore } from '@/stores/discoverySources'

const CLIENT_ID = '11111111-1111-4111-8111-111111111111'
const SOURCE_ID = '22222222-2222-4222-8222-222222222222'

const mockUpdate = vi.fn()
const mockCheck = vi.fn()
const originalVisualViewport = globalThis.visualViewport

vi.mock('@/services/discovery/sources', () => ({
  updateDiscoverySourceWebListConfig: (...args: unknown[]) => mockUpdate(...args),
  checkWebListConfig: (...args: unknown[]) => mockCheck(...args),
}))

vi.mock('@/components/discovery/SourceListConfigForm.vue', () => ({
  default: defineComponent({
    name: 'SourceListConfigFormStub',
    props: {
      form: { type: Object, required: true },
      errors: { type: Object, required: true },
      disabled: { type: Boolean, default: false },
      suggestion: { type: Object, default: null },
      appliedSuggestionId: { type: String, default: null },
      previewStatus: { type: String, default: 'idle' },
      previewResult: { type: Object, default: null },
      previewError: { type: String, default: null },
      warnings: { type: Array, default: () => [] },
    },
    emits: ['check', 'apply-suggestion', 'discard-suggestion'],
    setup(props, { emit }) {
      return () => h('div', { class: 'config-form-stub' }, [
        h('button', {
          'data-testid': 'emit-check',
          onClick: () => emit('check'),
        }, 'Emit Check'),
      ])
    },
  }),
}))

describe('SourceListConfigDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockUpdate.mockReset()
    mockCheck.mockReset()
    ;(globalThis as any).visualViewport = {
      width: 1024,
      height: 768,
      scale: 1,
      addEventListener: () => {},
      removeEventListener: () => {},
    }
  })

  afterEach(() => {
    if (originalVisualViewport) {
      ;(globalThis as any).visualViewport = originalVisualViewport
    } else {
      delete (globalThis as any).visualViewport
    }
  })

  function mountDialog() {
    const vuetify = createVuetify({
      components: vuetifyComponents,
      directives: vuetifyDirectives,
    })

    return mount(SourceListConfigDialog, {
      props: {
        clientId: CLIENT_ID,
      },
      global: {
        plugins: [vuetify],
        stubs: {
          transition: false,
          'transition-group': false,
        },
      },
    })
  }

  function seedStoreWithSource() {
    const store = useDiscoverySourcesStore()
    store.registerSource({
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
    })
    store.openDialog(SOURCE_ID)
    return store
  }

  it('saves configuration changes', async () => {
    const store = seedStoreWithSource()
    const updatedAt = new Date().toISOString()
    mockUpdate.mockResolvedValue({
      warnings: ['Check pagination'],
      suggestionAcknowledged: false,
      source: {
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
        updatedAt,
      },
    })

    const wrapper = mountDialog()
    await flushPromises()

    const saveButton = document.querySelector('[data-testid="save-config"]') as HTMLButtonElement
    expect(saveButton).toBeTruthy()
    saveButton.click()
    await flushPromises()

    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(store.dialog.open).toBe(false)
    expect(store.webListById[SOURCE_ID]?.warnings).toContain('Check pagination')

    wrapper.unmount()
  })

  it('runs preview when check is emitted', async () => {
    seedStoreWithSource()
    mockCheck.mockResolvedValue({
      ok: true,
      result: {
        item: {
          title: 'Example',
          url: 'https://example.com/article',
          excerpt: 'Summary',
          timestamp: new Date().toISOString(),
        },
        warnings: [],
        fetchedAt: new Date().toISOString(),
      },
    })

    const wrapper = mountDialog()
    await flushPromises()

    const emitCheck = document.querySelector('[data-testid="emit-check"]') as HTMLButtonElement
    expect(emitCheck).toBeTruthy()
    emitCheck.click()
    await flushPromises()

    expect(mockCheck).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('surfaces service errors', async () => {
    const store = seedStoreWithSource()
    mockUpdate.mockRejectedValue(new Error('Request failed'))

    const wrapper = mountDialog()
    await flushPromises()

    const saveButton = document.querySelector('[data-testid="save-config"]') as HTMLButtonElement
    expect(saveButton).toBeTruthy()
    saveButton.click()
    await flushPromises()

    expect(store.dialog.error).toBe('Request failed')
    wrapper.unmount()
  })
})
