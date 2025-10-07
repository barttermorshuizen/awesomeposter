import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import 'vuetify/styles'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import HitlPromptPanel from '@/components/HitlPromptPanel.vue'
import { useHitlStore } from '@/stores/hitl'

describe('HitlPromptPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('enforces approval selection before submission', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useHitlStore()

    store.startTrackingRequest({
      requestId: 'req-approval',
      payload: {
        question: 'Approve publishing?',
        kind: 'approval',
        options: [],
        allowFreeForm: true,
        urgency: 'normal'
      },
      originAgent: 'strategy',
      receivedAt: new Date('2025-03-01T10:00:00Z'),
      threadId: 'thread-approval'
    })

    const submitSpy = vi.spyOn(store, 'submitResponse').mockResolvedValue()

    const vuetify = createVuetify({ components, directives })
    const wrapper = mount(HitlPromptPanel, {
      global: {
        plugins: [pinia, vuetify]
      }
    })

    const submitButton = wrapper.get('button')
    await submitButton.trigger('click')

    expect(wrapper.text()).toContain('Select approve or reject')
    expect(submitSpy).not.toHaveBeenCalled()

    await wrapper.get('input[value="approve"]').setValue(true)
    await wrapper.get('textarea').setValue('Looks good')
    await submitButton.trigger('click')

    expect(submitSpy).toHaveBeenCalledExactlyOnceWith({
      responseType: 'approval',
      approved: true,
      selectedOptionId: undefined,
      freeformText: 'Looks good'
    })
  })
})
