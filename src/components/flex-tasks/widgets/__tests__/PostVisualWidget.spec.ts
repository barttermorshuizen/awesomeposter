import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import vuetify from '@/plugins/vuetify'
import PostVisualWidget from '@/components/flex-tasks/widgets/PostVisualWidget.vue'
import { useFlexTasksStore } from '@/stores/flexTasks'
import type { FlexEventWithId } from '@/lib/flex-sse'

const BASE_TIMESTAMP = '2025-01-01T00:00:00.000Z'
let listFlexAssetsSpy: ReturnType<typeof vi.spyOn>

function createPostVisualTaskEvent(): FlexEventWithId {
  return {
    type: 'node_start',
    timestamp: BASE_TIMESTAMP,
    runId: 'run_visual',
    nodeId: 'node_visual',
    payload: {
      executorType: 'human',
      assignment: {
        assignmentId: 'task_visual',
        runId: 'run_visual',
        nodeId: 'node_visual',
        label: 'Designer - Visual',
        status: 'awaiting_submission',
        metadata: {
          runContextSnapshot: {
            artifacts: {
              post_visual: [
                {
                  url: 'https://cdn.example.com/visual-a.png',
                  assetId: 'asset_a',
                  ordering: 0,
                  originalName: 'visual-a.png',
                  mimeType: 'image/png'
                },
                {
                  url: 'https://cdn.example.com/visual-b.png',
                  assetId: 'asset_b',
                  ordering: 1,
                  originalName: 'visual-b.png',
                  mimeType: 'image/png'
                }
              ]
            }
          }
        }
      },
      facets: { output: ['post_visual'] },
      contracts: { output: { mode: 'facets', facets: ['post_visual'] } }
    }
  } as FlexEventWithId
}

describe('PostVisualWidget', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const store = useFlexTasksStore()
    store.handleNodeStart(createPostVisualTaskEvent())
    listFlexAssetsSpy = vi.spyOn(store, 'listFlexAssets').mockResolvedValue([
      {
        assetId: 'asset_a',
        url: 'https://cdn.example.com/visual-a.png',
        ordering: 0,
        originalName: 'visual-a.png',
        mimeType: 'image/png'
      },
      {
        assetId: 'asset_b',
        url: 'https://cdn.example.com/visual-b.png',
        ordering: 1,
        originalName: 'visual-b.png',
        mimeType: 'image/png'
      }
    ])
  })

  it('renders image thumbnails for visual assets', async () => {
    const store = useFlexTasksStore()
    const wrapper = mount(PostVisualWidget, {
      props: {
        modelValue: [],
        definition: {
          title: 'Post Visual',
          description: 'Upload visuals for the campaign.'
        } as any,
        schema: { type: 'array' },
        taskContext: store.activeTask?.metadata ?? null
      },
      global: { plugins: [vuetify] }
    })

    await flushPromises()

    const cards = wrapper.findAll('[data-test="post-visual-card"]')
    expect(cards.length).toBe(2)
    const thumbnails = wrapper.findAll('[data-test="post-visual-thumb"]')
    expect(thumbnails.length).toBe(2)
    expect(thumbnails[0].attributes('src')).toBe('/api/flex/assets/asset_a/download')
  })

  it('uploads files and emits updated URL array', async () => {
    const store = useFlexTasksStore()
    const uploadSpy = vi
      .spyOn(store, 'uploadPostVisualAsset')
      .mockResolvedValue({
        assetId: 'asset_c',
        url: 'https://cdn.example.com/visual-c.png',
        ordering: 2,
        originalName: 'visual-c.png',
        mimeType: 'image/png'
      })
    vi.spyOn(store, 'updatePostVisualAssetOrdering').mockResolvedValue()

    const wrapper = mount(PostVisualWidget, {
      props: {
        modelValue: [],
        definition: {
          title: 'Post Visual',
          description: 'Upload visuals for the campaign.'
        } as any,
        schema: { type: 'array' },
        taskContext: store.activeTask?.metadata ?? null
      },
      global: { plugins: [vuetify] }
    })

    await flushPromises()

    const file = new File(['binary'], 'visual-c.png', { type: 'image/png' })
    const input = wrapper.get('[data-test="post-visual-file-input"]')
    const inputEl = input.element as HTMLInputElement
    Object.defineProperty(inputEl, 'files', {
      value: [file],
      configurable: true
    })
    await input.trigger('change')

    await flushPromises()

    expect(uploadSpy).toHaveBeenCalledTimes(1)
    expect(uploadSpy).toHaveBeenCalledWith('task_visual', file)

    const emissions = wrapper.emitted('update:modelValue')
    expect(emissions).toBeTruthy()
    const lastEmission = emissions![emissions!.length - 1]
    expect(Array.isArray(lastEmission?.[0])).toBe(true)
    const payload = lastEmission?.[0] as Array<{ url?: string }>
    expect(payload.length).toBe(3)
    expect(payload.map((entry) => entry?.url)).toContain('https://cdn.example.com/visual-c.png')

    const cards = wrapper.findAll('[data-test="post-visual-card"]')
    expect(cards.length).toBe(3)
    const thumbnails = wrapper.findAll('[data-test="post-visual-thumb"]')
    expect(thumbnails.length).toBe(3)
    expect(thumbnails[2].attributes('src')).toBe('/api/flex/assets/asset_c/download')
    expect(cards[0].text()).toContain('Featured')
  })

  it('reorders assets and persists ordering', async () => {
    const store = useFlexTasksStore()
    const orderingSpy = vi.spyOn(store, 'updatePostVisualAssetOrdering').mockResolvedValue()

    const wrapper = mount(PostVisualWidget, {
      props: {
        modelValue: [
          'https://cdn.example.com/visual-a.png',
          'https://cdn.example.com/visual-b.png'
        ],
        definition: {
          title: 'Post Visual',
          description: ''
        } as any,
        schema: { type: 'array' },
        taskContext: store.activeTask?.metadata ?? null
      },
      global: { plugins: [vuetify] }
    })

    await flushPromises()

    const moveDownButton = wrapper.findAll('[data-test="post-visual-move-down"]')[0]
    await moveDownButton.trigger('click')
    await flushPromises()

    const emissions = wrapper.emitted('update:modelValue')
    expect(emissions).toBeTruthy()
    const lastEmission = emissions![emissions!.length - 1]
    expect(lastEmission?.[0]).toEqual([
      'https://cdn.example.com/visual-b.png',
      'https://cdn.example.com/visual-a.png'
    ])

    expect(orderingSpy).toHaveBeenCalled()
    const [taskId, payload] = orderingSpy.mock.calls[orderingSpy.mock.calls.length - 1]
    expect(taskId).toBe('task_visual')
    expect(payload).toEqual([
      { assetId: 'asset_b', ordering: 0 },
      { assetId: 'asset_a', ordering: 1 }
    ])
  })

  it('removes assets and dispatches delete helper', async () => {
    const store = useFlexTasksStore()
    vi.spyOn(store, 'updatePostVisualAssetOrdering').mockResolvedValue()
    const deleteSpy = vi.spyOn(store, 'deletePostVisualAsset').mockResolvedValue()

    const wrapper = mount(PostVisualWidget, {
      props: {
        modelValue: [
          'https://cdn.example.com/visual-a.png',
          'https://cdn.example.com/visual-b.png'
        ],
        definition: {
          title: 'Post Visual',
          description: ''
        } as any,
        schema: { type: 'array' },
        taskContext: store.activeTask?.metadata ?? null
      },
      global: { plugins: [vuetify] }
    })

    await flushPromises()

    const removeButtons = wrapper.findAll('[data-test="post-visual-remove"]')
    expect(removeButtons.length).toBeGreaterThan(0)
    await removeButtons[0].trigger('click')
    await flushPromises()

    expect(deleteSpy).toHaveBeenCalledWith('task_visual', 'asset_a')
    const emissions = wrapper.emitted('update:modelValue')
    expect(emissions).toBeTruthy()
    const lastEmission = emissions![emissions!.length - 1]
    expect(lastEmission?.[0]).toEqual(['https://cdn.example.com/visual-b.png'])
  })

  it('uses placeholder for non-image assets', async () => {
    const store = useFlexTasksStore()
    listFlexAssetsSpy.mockResolvedValueOnce([
      {
        assetId: 'asset_doc',
        url: 'https://cdn.example.com/brochure.pdf',
        ordering: 0,
        originalName: 'brochure.pdf',
        mimeType: 'application/pdf'
      }
    ])

    const wrapper = mount(PostVisualWidget, {
      props: {
        modelValue: [],
        definition: {
          title: 'Post Visual',
          description: ''
        } as any,
        schema: { type: 'array' },
        taskContext: store.activeTask?.metadata ?? null
      },
      global: { plugins: [vuetify] }
    })

    await flushPromises()

    const card = wrapper.get('[data-test="post-visual-card"]')
    const thumb = card.get('[data-test="post-visual-thumb"]')
    await thumb.trigger('error')
    await flushPromises()

    expect(card.find('[data-test="post-visual-thumb-placeholder"]').exists()).toBe(true)
  })

  it('attempts thumbnail render for assets without mime metadata', async () => {
    const store = useFlexTasksStore()
    listFlexAssetsSpy.mockResolvedValueOnce([
      {
        assetId: 'asset_unknown',
        url: 'https://cdn.example.com/asset?id=preview123',
        ordering: 0,
        originalName: 'asset-preview.png',
        mimeType: null
      }
    ])

    const wrapper = mount(PostVisualWidget, {
      props: {
        modelValue: [],
        definition: {
          title: 'Post Visual',
          description: ''
        } as any,
        schema: { type: 'array' },
        taskContext: null
      },
      global: { plugins: [vuetify] }
    })

    await flushPromises()

    const card = wrapper.get('[data-test="post-visual-card"]')
    expect(card.find('[data-test="post-visual-thumb"]').attributes('src')).toBe(
      '/api/flex/assets/asset_unknown/download'
    )
  })

  it('attempts thumbnail render for generic binary mime types', async () => {
    const store = useFlexTasksStore()
    listFlexAssetsSpy.mockResolvedValueOnce([
      {
        assetId: 'asset_binary',
        url: 'https://cdn.example.com/binary-preview',
        ordering: 0,
        originalName: 'binary-preview',
        mimeType: 'application/octet-stream'
      }
    ])

    const wrapper = mount(PostVisualWidget, {
      props: {
        modelValue: [],
        definition: {
          title: 'Post Visual',
          description: ''
        } as any,
        schema: { type: 'array' },
        taskContext: null
      },
      global: { plugins: [vuetify] }
    })

    await flushPromises()

    const card = wrapper.get('[data-test="post-visual-card"]')
    expect(card.find('[data-test="post-visual-thumb"]').attributes('src')).toBe(
      '/api/flex/assets/asset_binary/download'
    )
  })

  it('falls back to placeholder when thumbnail fails to load', async () => {
    const store = useFlexTasksStore()

    const wrapper = mount(PostVisualWidget, {
      props: {
        modelValue: [],
        definition: {
          title: 'Post Visual',
          description: ''
        } as any,
        schema: { type: 'array' },
        taskContext: store.activeTask?.metadata ?? null
      },
      global: { plugins: [vuetify] }
    })

    await flushPromises()

    const firstCard = wrapper.get('[data-test="post-visual-card"]')
    const thumbnail = firstCard.get('[data-test="post-visual-thumb"]')
    await thumbnail.trigger('error')
    await flushPromises()

    const updatedFirstCard = wrapper.get('[data-test="post-visual-card"]')
    expect(updatedFirstCard.find('[data-test="post-visual-thumb"]').exists()).toBe(false)
    expect(updatedFirstCard.find('[data-test="post-visual-thumb-placeholder"]').exists()).toBe(true)
  })
})
