import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import vuetify from '@/plugins/vuetify'
import PostVisualInputGallery from '@/components/flex-tasks/widgets/PostVisualInputGallery.vue'
import { useFlexTasksStore, type PostVisualInputFacetAssetRecord } from '@/stores/flexTasks'
import type { FlexEventWithId } from '@/lib/flex-sse'

const BASE_TIMESTAMP = '2025-01-01T00:00:00.000Z'

function createPostVisualTaskEvent(): FlexEventWithId {
  return {
    type: 'node_start',
    timestamp: BASE_TIMESTAMP,
    runId: 'run_visual_input',
    nodeId: 'node_visual_input',
    payload: {
      executorType: 'human',
      assignment: {
        assignmentId: 'task_visual_input',
        runId: 'run_visual_input',
        nodeId: 'node_visual_input',
        label: 'Visual review',
        status: 'awaiting_submission',
        metadata: {
          currentInputs: {
            post_visual: [
              {
                url: 'https://cdn.example.com/assets/a.png',
                assetId: 'asset_a',
                ordering: 0,
                originalName: 'a.png',
                mimeType: 'image/png'
              },
              {
                url: 'https://cdn.example.com/assets/b.pdf',
                assetId: 'asset_b',
                ordering: 1,
                originalName: 'b.pdf',
                mimeType: 'application/pdf'
              }
            ]
          }
        }
      },
      facets: { input: ['post_visual'] },
      contracts: { input: ['post_visual'] }
    }
  } as FlexEventWithId
}

describe('PostVisualInputGallery', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const store = useFlexTasksStore()
    store.handleNodeStart(createPostVisualTaskEvent())
  })

  it('renders managed assets with featured highlighting and download links', async () => {
    const store = useFlexTasksStore()
    const sanitized = store.normalizeInputFacetValue('post_visual', [
      {
        url: 'https://cdn.example.com/assets/a.png',
        assetId: 'asset_a',
        ordering: 0,
        originalName: 'Hero visual',
        mimeType: 'image/png'
      },
      {
        url: 'https://cdn.example.com/assets/b.pdf',
        assetId: 'asset_b',
        ordering: 1,
        originalName: 'Brief',
        mimeType: 'application/pdf'
      }
    ]) as PostVisualInputFacetAssetRecord[]

    const listSpy = vi.spyOn(store, 'listFlexAssets').mockResolvedValue([
      {
        assetId: 'asset_a',
        url: 'https://cdn.example.com/assets/a.png',
        ordering: 0,
        originalName: 'Hero visual',
        mimeType: 'image/png'
      },
      {
        assetId: 'asset_b',
        url: 'https://cdn.example.com/assets/b.pdf',
        ordering: 1,
        originalName: 'Brief',
        mimeType: 'application/pdf'
      }
    ])

    const wrapper = mount(PostVisualInputGallery, {
      props: {
        modelValue: sanitized,
        definition: {
          title: 'Post visual input',
          description: 'Review designer visuals.'
        } as any,
        schema: { type: 'array' }
      },
      global: { plugins: [vuetify] }
    })

    await flushPromises()

    expect(listSpy).toHaveBeenCalledWith('task_visual_input', 'post_visual')

    const cards = wrapper.findAll('[data-test="post-visual-input-card"]')
    expect(cards).toHaveLength(2)

    const featuredChip = wrapper.get('[data-test="post-visual-input-featured"]')
    expect(featuredChip.text()).toContain('Featured')

    const downloadButtons = wrapper.findAll('[data-test="post-visual-input-download"]')
    expect(downloadButtons[0].attributes('href')).toBe('/api/flex/assets/asset_a/download')
    expect(downloadButtons[1].attributes('href')).toBe('/api/flex/assets/asset_b/download')

    const badge = wrapper.get('[data-test="post-visual-input-badge"]')
    expect(badge.text()).toBe('PDF')
  })

  it('falls back to external URLs and non-image placeholders', async () => {
    const store = useFlexTasksStore()
    const sanitized = store.normalizeInputFacetValue('post_visual', [
      'https://assets.example.com/docs/spec.pdf'
    ]) as PostVisualInputFacetAssetRecord[]

    const wrapper = mount(PostVisualInputGallery, {
      props: {
        modelValue: sanitized,
        definition: {
          title: 'Visual inputs'
        } as any,
        schema: { type: 'array' }
      },
      global: { plugins: [vuetify] }
    })

    await flushPromises()

    const placeholder = wrapper.get('[data-test="post-visual-input-placeholder"]')
    expect(placeholder.exists()).toBe(true)

    const download = wrapper.get('[data-test="post-visual-input-download"]')
    expect(download.attributes('href')).toBe('https://assets.example.com/docs/spec.pdf')

    const source = wrapper.get('[data-test="post-visual-input-card"]').find('.asset-source')
    expect(source.text()).toContain('External link')
  })

  it('surfaces hydration errors gracefully', async () => {
    const store = useFlexTasksStore()
    const sanitized = store.normalizeInputFacetValue('post_visual', [
      {
        url: 'https://cdn.example.com/assets/a.png',
        assetId: 'asset_a',
        ordering: 0
      }
    ]) as PostVisualInputFacetAssetRecord[]

    vi.spyOn(store, 'listFlexAssets').mockRejectedValue(new Error('Failed to load flex assets.'))

    const wrapper = mount(PostVisualInputGallery, {
      props: {
        modelValue: sanitized,
        definition: {
          title: 'Visual inputs'
        } as any,
        schema: { type: 'array' }
      },
      global: { plugins: [vuetify] }
    })

    await flushPromises()

    const alert = wrapper.get('[data-test="post-visual-input-alert"]')
    expect(alert.text()).toContain('Failed to load flex assets.')
  })

  it('resolves managed flex assets by URL when assetId is absent', async () => {
    const store = useFlexTasksStore()
    const sanitized = store.normalizeInputFacetValue('post_visual', [
      'https://cdn.example.com/assets/d.png'
    ]) as PostVisualInputFacetAssetRecord[]

    vi.spyOn(store, 'listFlexAssets').mockResolvedValue([
      {
        assetId: 'asset_d',
        url: 'https://cdn.example.com/assets/d.png',
        ordering: 0,
        originalName: 'd.png',
        mimeType: 'image/png'
      }
    ])

    const wrapper = mount(PostVisualInputGallery, {
      props: {
        modelValue: sanitized,
        definition: {
          title: 'Visual inputs'
        } as any,
        schema: { type: 'array' }
      },
      global: { plugins: [vuetify] }
    })

    await flushPromises()

    const download = wrapper.get('[data-test="post-visual-input-download"]')
    expect(download.attributes('href')).toBe('/api/flex/assets/asset_d/download')
  })
})
