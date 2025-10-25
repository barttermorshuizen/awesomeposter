import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import FlexSandboxView from '../FlexSandboxView.vue'
import vuetify from '@/plugins/vuetify'
import { useFlexEnvelopeBuilderStore } from '@/stores/flexEnvelopeBuilder'

function mountSandboxView() {
  const pinia = createPinia()
  setActivePinia(pinia)
  return {
    wrapper: mount(FlexSandboxView, {
      global: {
        plugins: [pinia, vuetify]
      }
    }),
    pinia
  }
}

describe('FlexSandboxView', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('renders JSON tree preview when TaskEnvelope parses successfully', async () => {
    const { wrapper } = mountSandboxView()

    const vm = wrapper.vm as unknown as { draftText: string }
    vm.draftText = JSON.stringify(
      {
        objective: 'Integration test objective',
        inputs: { planKnobs: { formatType: 'text', variantCount: 1 } },
        policies: { planner: { directives: { disallowStages: [] } }, runtime: [] },
        specialInstructions: [],
        outputContract: { mode: 'json_schema', schema: { type: 'object', additionalProperties: true } }
      },
      null,
      2
    )

    await flushPromises()

    const tree = wrapper.find('.envelope-json-tree')
    expect(tree.exists()).toBe(true)
    expect(wrapper.text()).toContain('Integration test objective')
  })

  it('disables Run plan when conversation reports missing fields', async () => {
    const { wrapper } = mountSandboxView()
    const builder = useFlexEnvelopeBuilderStore()

    builder.lastMissingFields = ['objective']
    await nextTick()

    const runButton = wrapper.find('button[data-testid="flex-run-button"]')
    expect(runButton.exists()).toBe(true)
    expect(runButton.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Missing required field')
  })
})
