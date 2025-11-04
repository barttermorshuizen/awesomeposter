// @vitest-environment jsdom
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
    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ runs: [] })
    } as Response)
  })

  it('renders JSON tree preview when TaskEnvelope parses successfully', async () => {
    const { wrapper } = mountSandboxView()

    const vm = wrapper.vm as unknown as { draftText: string; updateValidation: () => void }
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

    vm.updateValidation()
    await flushPromises()
    await nextTick()

    expect((wrapper.vm as any).parsedEnvelope).not.toBeNull()
    expect((wrapper.vm as any).parsedEnvelope.objective).toBe('Integration test objective')
  })

  it('disables Run plan when conversation reports missing fields', async () => {
    const { wrapper } = mountSandboxView()
    const builder = useFlexEnvelopeBuilderStore()

    builder.lastMissingFields = ['objective']
    await nextTick()

    expect((wrapper.vm as any).runDisabled).toBe(true)
  })
})
