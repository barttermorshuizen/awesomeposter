import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import FeedbackInlineDecorator from '@/components/flex-tasks/widgets/FeedbackInlineDecorator.vue'
import vuetify from '@/plugins/vuetify'

function mountDecorator(overrides?: Record<string, unknown>) {
  return mount(FeedbackInlineDecorator, {
    props: {
      facetKey: 'company_information',
      facetTitle: 'Company Information',
      path: '/company_information',
      entries: [],
      currentAuthor: 'Director',
      ...overrides
    },
    global: {
      plugins: [vuetify]
    }
  })
}

describe('FeedbackInlineDecorator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-05-10T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('hides badge when showBadge is false and still toggles panel', async () => {
    const wrapper = mountDecorator({ showBadge: false })
    expect(wrapper.find('[data-test="feedback-inline-badge"]').exists()).toBe(false)
    await wrapper.get('[data-test="feedback-inline-trigger"]').trigger('click')
    expect(wrapper.find('[data-test="feedback-inline-panel"]').exists()).toBe(true)
  })

  it('shows unresolved badge count and previews latest open message', async () => {
    const wrapper = mountDecorator({
      showBadge: true,
      entries: [
        {
          facet: 'company_information',
          path: '/company_information',
          message: 'Need more clarity on the brief.',
          severity: 'major',
          resolution: 'open',
          sourceIndex: 0
        },
        {
          facet: 'company_information',
          message: 'All good now.',
          resolution: 'addressed',
          sourceIndex: 1
        }
      ]
    })

    const badge = wrapper.get('[data-test="feedback-inline-badge"]')
    expect(badge.text()).toContain('1')
    await wrapper.get('[data-test="feedback-inline-trigger"]').trigger('click')
    const list = wrapper.get('[data-test="feedback-inline-list"]')
    expect(list.text()).toContain('Need more clarity on the brief.')
  })

  it('emits submit payload, closes panel, and resets composer', async () => {
    const wrapper = mountDecorator({
      facetKey: 'post_copy',
      facetTitle: 'Post Copy',
      path: '/post_copy'
    })

    await wrapper.get('[data-test="feedback-inline-trigger"]').trigger('click')
    const textarea = wrapper.get('[data-test="feedback-inline-message"] textarea')
    await textarea.setValue('  Tighten the CTA copy. ')
    await wrapper.get('[data-test="feedback-inline-severity-critical"]').trigger('click')
    await wrapper.get('[data-test="feedback-inline-submit"]').trigger('click')

    const emissions = wrapper.emitted('submit')
    expect(emissions).toBeTruthy()
    const payload = emissions?.[0]?.[0] as Record<string, unknown>
    expect(payload).toMatchObject({
      facet: 'post_copy',
      path: '/post_copy',
      message: 'Tighten the CTA copy.',
      severity: 'critical',
      timestamp: '2025-05-10T12:00:00.000Z'
    })
    expect(wrapper.find('[data-test="feedback-inline-panel"]').exists()).toBe(false)
  })

  it('keeps composer disabled when readonly', async () => {
    const wrapper = mountDecorator({ readonly: true })
    const trigger = wrapper.get('[data-test="feedback-inline-trigger"]')
    expect(trigger.attributes('disabled')).toBeDefined()
    await trigger.trigger('click')
    expect(wrapper.find('[data-test="feedback-inline-panel"]').exists()).toBe(false)
  })

  it('emits remove event only for entries created by current author', async () => {
    const wrapper = mountDecorator({
      currentAuthor: 'Director',
      entries: [
        {
          facet: 'company_information',
          message: 'Director note',
          severity: 'minor',
          author: 'Director',
          sourceIndex: 0
        },
        {
          facet: 'company_information',
          message: 'Copywriter note',
          severity: 'info',
          author: 'Copywriter',
          sourceIndex: 1
        }
      ]
    })

    await wrapper.get('[data-test="feedback-inline-trigger"]').trigger('click')
    const removeButtons = wrapper.findAll('[data-test="feedback-inline-entry-remove"]')
    expect(removeButtons.length).toBe(1)
    await removeButtons[0].trigger('click')

    const removeEvents = wrapper.emitted('remove')
    expect(removeEvents).toBeTruthy()
    expect(removeEvents?.[0]?.[0]).toBe(0)
  })

  it('emits set-resolution events when resolve/undo controls are used', async () => {
    const wrapper = mountDecorator({
      entries: [
        {
          facet: 'post_copy',
          message: 'Tighten CTA',
          resolution: 'open',
          sourceIndex: 0
        }
      ]
    })

    await wrapper.get('[data-test="feedback-inline-trigger"]').trigger('click')
    await wrapper.get('[data-test="feedback-inline-entry-resolve"]').trigger('click')

    const resolutionEvents = wrapper.emitted('set-resolution')
    expect(resolutionEvents).toBeTruthy()
    expect(resolutionEvents?.[0]?.[0]).toEqual({ sourceIndex: 0, resolution: 'addressed' })

    await wrapper.setProps({
      entries: [
        {
          facet: 'post_copy',
          message: 'Tighten CTA',
          resolution: 'addressed',
          sourceIndex: 0
        }
      ]
    })
    await wrapper.get('[data-test="feedback-inline-entry-reopen"]').trigger('click')
    expect(resolutionEvents?.[1]?.[0]).toEqual({ sourceIndex: 0, resolution: 'open' })
  })
})
