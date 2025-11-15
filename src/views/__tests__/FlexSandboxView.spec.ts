// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, type ComponentPublicInstance } from 'vue'
import vuetify from '@/plugins/vuetify'
import { useFlexEnvelopeBuilderStore } from '@/stores/flexEnvelopeBuilder'
import type { TaskEnvelope } from '@awesomeposter/shared'
import type { FlexEventWithId } from '@/lib/flex-sse'
import type { GuardSummary } from '@/lib/postConditionUtils'

type SandboxGuardRetryState = {
  attempt: number
  maxRetries: number | null
  nodeId?: string | null
  capabilityId?: string | null
} | null

type SandboxTestVm = ComponentPublicInstance & {
  draftText: string
  updateValidation: () => void
  handleRuntimePolicyDslInput?: (index: number, value: string) => void
  handleGoalConditionDslInput?: (index: number, value: string) => void
  parsedEnvelope?: TaskEnvelope & { [key: string]: unknown }
  runtimePolicies?: unknown[]
  goalConditionDrafts?: unknown[]
  runDisabled?: boolean
  postConditionSummary?: GuardSummary
  guardRetryState?: SandboxGuardRetryState
  handleEvent: (event: FlexEventWithId) => void
}

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

    const vm = wrapper.vm as SandboxTestVm
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

    const parsedEnvelope = vm.parsedEnvelope
    expect(parsedEnvelope).not.toBeNull()
    expect(parsedEnvelope.objective).toBe('Integration test objective')
  })

  it('disables Run plan when conversation reports missing fields', async () => {
    const { wrapper } = await mountSandboxView()
    const builder = useFlexEnvelopeBuilderStore()

    builder.lastMissingFields = ['objective']
    await nextTick()

    const vm = wrapper.vm as SandboxTestVm
    expect(vm.runDisabled).toBe(true)
  })

  it('updates runtime policy JSON when DSL editor is enabled', async () => {
    const { wrapper } = await mountSandboxView({ dslEnabled: true })
    const vm = wrapper.vm as SandboxTestVm

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

    expect(vm.runtimePolicies).toHaveLength(1)

    vm.handleRuntimePolicyDslInput(
      0,
      'facets.planKnobs.hookIntensity < 0.5'
    )
    await flushPromises()
    await nextTick()
    vm.updateValidation()
    await flushPromises()
    await nextTick()

    const parsedEnvelope = vm.parsedEnvelope
    const condition = parsedEnvelope.policies.runtime[0].trigger.condition

    expect(condition.dsl).toBe('facets.planKnobs.hookIntensity < 0.5')
    expect(condition.jsonLogic).toEqual({
      '<': [{ var: 'metadata.runContextSnapshot.facets.planKnobs.value.hookIntensity' }, 0.5]
    })
  })

  it('updates goal_condition entries when DSL editor is enabled', async () => {
    const { wrapper } = await mountSandboxView({ dslEnabled: true })
    const vm = wrapper.vm as SandboxTestVm

    vm.draftText = JSON.stringify(
      {
        objective: 'Goal condition test',
        inputs: { planKnobs: { formatType: 'text', variantCount: 1 } },
        goal_condition: [
          {
            facet: 'post_copy',
            path: '/',
            condition: {
              dsl: 'facets.post_copy != ""'
            }
          }
        ],
        policies: {
          planner: { directives: { disallowStages: [] } },
          runtime: []
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

    expect(vm.goalConditionDrafts).toHaveLength(1)

    vm.handleGoalConditionDslInput(0, 'facets.post_copy == "ready"')
    await flushPromises()
    await nextTick()
    vm.updateValidation()
    await flushPromises()
    await nextTick()

    const parsedEnvelope = vm.parsedEnvelope as TaskEnvelope
    expect(parsedEnvelope.goal_condition).toBeDefined()
    expect(parsedEnvelope.goal_condition?.[0]?.condition.dsl).toBe('facets.post_copy == "ready"')
    expect(parsedEnvelope.goal_condition?.[0]?.condition.jsonLogic).toEqual({
      '==': [{ var: 'metadata.runContextSnapshot.facets.post_copy.value' }, 'ready']
    })
  })

  it('ingests aggregated post_condition_results from completion frames', async () => {
    const { wrapper } = await mountSandboxView()
    const vm = wrapper.vm as SandboxTestVm
    const timestamp = new Date().toISOString()

    await vm.handleEvent({
      type: 'plan_generated',
      timestamp,
      payload: {
        version: 1,
        nodes: [
          {
            id: 'node-agg',
            capabilityId: 'writer.v1',
            label: 'Writer',
            status: 'pending',
            kind: 'execution'
          }
        ],
        edges: []
      }
    })

    await vm.handleEvent({
      type: 'complete',
      timestamp,
      payload: {
        status: 'completed',
        post_condition_results: [
          {
            nodeId: 'node-agg',
            capabilityId: 'writer.v1',
            results: [
              {
                facet: 'copy',
                path: '/0/title',
                expression: 'output.title != ""',
                satisfied: false
              }
            ]
          }
        ]
      }
    })

    await flushPromises()
    await nextTick()

    expect(vm.postConditionSummary?.fail).toBe(1)
    expect(vm.guardRetryState).toBeNull()
  })

  it('records guard retry metadata from policy_triggered frames', async () => {
    const { wrapper } = await mountSandboxView()
    const vm = wrapper.vm as SandboxTestVm
    const timestamp = new Date().toISOString()

    await vm.handleEvent({
      type: 'policy_triggered',
      timestamp,
      payload: {
        action: 'retry',
        nodeId: 'node-retry',
        capabilityId: 'writer.v1',
        attempt: 2,
        maxRetries: 3,
        postConditionResults: [
          {
            facet: 'copy',
            path: '/headline',
            expression: 'headline != ""',
            satisfied: false
          }
        ]
      }
    })

    await flushPromises()
    await nextTick()

    expect(vm.guardRetryState?.attempt).toBe(2)
    expect(vm.guardRetryState?.maxRetries).toBe(3)
    expect(vm.guardRetryState?.nodeId).toBe('node-retry')
    expect(vm.guardRetryState?.capabilityId).toBe('writer.v1')
  })
})
