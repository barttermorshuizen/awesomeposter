// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import vuetify from '@/plugins/vuetify'
import { useFlexEnvelopeBuilderStore } from '@/stores/flexEnvelopeBuilder'

async function mountSandboxView(options: { dslEnabled?: boolean } = {}) {
  vi.resetModules()

  if (options.dslEnabled) {
    window.localStorage.setItem('feature:flex.dslPolicies', 'true')
  } else {
    window.localStorage.removeItem('feature:flex.dslPolicies')
  }

  const { default: FlexSandboxView } = await import('../FlexSandboxView.vue')

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
    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ runs: [] })
    } as Response)
  })

  it('renders JSON tree preview when TaskEnvelope parses successfully', async () => {
    const { wrapper } = await mountSandboxView()

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

    const parsedEnvelope = (wrapper.vm as any).parsedEnvelope
    expect(parsedEnvelope).not.toBeNull()
    expect(parsedEnvelope.objective).toBe('Integration test objective')
  })

  it('disables Run plan when conversation reports missing fields', async () => {
    const { wrapper } = await mountSandboxView()
    const builder = useFlexEnvelopeBuilderStore()

    builder.lastMissingFields = ['objective']
    await nextTick()

    expect((wrapper.vm as any).runDisabled).toBe(true)
  })

  it('updates runtime policy JSON when DSL editor is enabled', async () => {
    const { wrapper } = await mountSandboxView({ dslEnabled: true })
    const vm = wrapper.vm as unknown as { draftText: string; updateValidation: () => void; handleRuntimePolicyDslInput: (index: number, value: string) => void }

    vm.draftText = JSON.stringify(
      {
        objective: 'DSL policy test',
        inputs: { planKnobs: { formatType: 'text', variantCount: 1 } },
        policies: {
          planner: { directives: { disallowStages: [] } },
          runtime: [
          {
            id: 'qa_gate',
            trigger: {
              kind: 'onNodeComplete',
              condition: {
                  dsl: 'facets.planKnobs.hookIntensity < 0.7'
                }
              },
              action: { type: 'replan', rationale: 'Guardrail for QA score' }
            }
          ]
        },
        specialInstructions: [],
        outputContract: { mode: 'json_schema', schema: { type: 'object', additionalProperties: true } }
      },
      null,
      2
    )

    vm.updateValidation()
    await flushPromises()
    await nextTick()

    expect((wrapper.vm as any).runtimePolicies).toHaveLength(1)

    vm.handleRuntimePolicyDslInput(
      0,
      'facets.planKnobs.hookIntensity < 0.5'
    )
    await flushPromises()
    await nextTick()
    vm.updateValidation()
    await flushPromises()
    await nextTick()

    const parsedEnvelope = (wrapper.vm as any).parsedEnvelope
    const condition = parsedEnvelope.policies.runtime[0].trigger.condition

    expect(condition.dsl).toBe('facets.planKnobs.hookIntensity < 0.5')
    expect(condition.jsonLogic).toEqual({
      '<': [{ var: 'metadata.runContextSnapshot.facets.planKnobs.value.hookIntensity' }, 0.5]
    })
  })
})
