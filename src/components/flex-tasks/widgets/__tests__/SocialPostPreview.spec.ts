import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import SocialPostPreview from '@/components/flex-tasks/widgets/SocialPostPreview.vue'
import vuetify from '@/plugins/vuetify'

describe('SocialPostPreview', () => {
  beforeEach(() => {
    // no-op placeholder for potential shared setup
  })

  it('renders copy and fallback when no visuals provided', async () => {
    const wrapper = mount(SocialPostPreview, {
      props: {
        modelValue: null,
        definition: { title: 'Social Post Preview' } as any,
        schema: {},
        taskContext: {
          runContextSnapshot: {
            facets: {
              post_copy: { value: 'Launch announcement goes live tomorrow.' },
              post_visual: { value: [] }
            }
          }
        }
      },
      global: { plugins: [vuetify] }
    })

    await flushPromises()

    const copy = wrapper.get('[data-test="social-post-preview-copy"]').text()
    expect(copy).toContain('Launch announcement goes live tomorrow.')
    expect(wrapper.get('[data-test="social-post-preview-no-visuals"]').text()).toBe('No visuals provided')
    expect(wrapper.find('[data-test="social-post-preview-visuals"]').exists()).toBe(false)
  })

  it('renders single image when context provides post_visual assets', async () => {
    const wrapper = mount(SocialPostPreview, {
      props: {
        modelValue: null,
        definition: { title: 'Preview' } as any,
        schema: {},
        taskContext: {
          runContextSnapshot: {
            facets: {
              post_copy: { value: 'Welcome Quinn to the QA team!' },
              post_visual: { value: ['https://cdn.example.com/post-quinn.png'] }
            }
          }
        }
      },
      global: { plugins: [vuetify] }
    })

    await flushPromises()

    const primary = wrapper.get('[data-test="social-post-preview-visual"] img')
    expect(primary.attributes('src')).toBe('https://cdn.example.com/post-quinn.png')
    expect(wrapper.find('[data-test="social-post-preview-gallery"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="social-post-preview-no-visuals"]').exists()).toBe(false)
  })

  it('merges model visuals and sorts them by ordering', async () => {
    const wrapper = mount(SocialPostPreview, {
      props: {
        modelValue: {
          copy: 'Aligned messaging wins approvals.',
          visuals: [
            { url: 'https://cdn.example.com/visual-b.png', ordering: 1 },
            { url: 'https://cdn.example.com/visual-a.png', ordering: 2 },
            { url: 'https://cdn.example.com/skip-this.pdf', ordering: 0 }
          ]
        },
        definition: { title: 'Social Preview' } as any,
        schema: {},
        taskContext: {
          runContextSnapshot: {
            facets: {
              post_visual: { value: [] }
            }
          }
        }
      },
      global: { plugins: [vuetify] }
    })

    await flushPromises()

    const primary = wrapper.get('[data-test="social-post-preview-visual"] img')
    expect(primary.attributes('src')).toBe('https://cdn.example.com/visual-b.png')

    const galleryThumbs = wrapper.findAll('[data-test="social-post-preview-gallery"] img')
    expect(galleryThumbs.length).toBe(1)
    expect(galleryThumbs[0]?.attributes('src')).toBe('https://cdn.example.com/visual-a.png')
    expect(wrapper.text()).toContain('Aligned messaging wins approvals.')
  })

  it('renders nothing when no copy or visuals available', async () => {
    const wrapper = mount(SocialPostPreview, {
      props: {
        modelValue: null,
        definition: { title: 'Preview' } as any,
        schema: {},
        taskContext: {
          runContextSnapshot: {
            facets: {}
          }
        }
      },
      global: { plugins: [vuetify] }
    })

    await flushPromises()

    expect(wrapper.find('[data-test="social-post-preview"]').exists()).toBe(false)
  })

  it('reads flattened run context snapshot entries for copy', async () => {
    const wrapper = mount(SocialPostPreview, {
      props: {
        modelValue: null,
        definition: { title: 'Preview' } as any,
        schema: {},
        taskContext: {
          runContextSnapshot: {
            post_copy: { value: 'Flattened copy value.' }
          }
        }
      },
      global: { plugins: [vuetify] }
    })

    await flushPromises()

    const copy = wrapper.get('[data-test="social-post-preview-copy"]').text()
    expect(copy).toContain('Flattened copy value.')
  })
})
