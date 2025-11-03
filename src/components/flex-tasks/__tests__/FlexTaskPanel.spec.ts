import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import vuetify from '@/plugins/vuetify'
import FlexTaskPanel from '@/components/flex-tasks/FlexTaskPanel.vue'
import DefaultFacetWidget from '@/components/flex-tasks/widgets/DefaultFacetWidget.vue'
import { useFlexTasksStore } from '@/stores/flexTasks'
import type { FlexEventWithId } from '@/lib/flex-sse'

const BASE_TIMESTAMP = '2025-01-01T00:00:00.000Z'

function nodeStartEvent(): FlexEventWithId {
  return {
    type: 'node_start',
    timestamp: BASE_TIMESTAMP,
    runId: 'run_component',
    nodeId: 'node_component',
    payload: {
      executorType: 'human',
      startedAt: BASE_TIMESTAMP,
      assignment: {
        assignmentId: 'task_component',
        runId: 'run_component',
        nodeId: 'node_component',
        label: 'Provide tone of voice',
        status: 'awaiting_submission',
        role: 'copywriter'
      },
      facets: { output: ['toneOfVoice'] },
      contracts: { output: { mode: 'facets', facets: ['toneOfVoice'] } }
    }
  }
}

describe('FlexTaskPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders facet widgets and submits resume payloads', async () => {
    const store = useFlexTasksStore()
    store.handleNodeStart(nodeStartEvent())

    const submitSpy = vi.spyOn(store, 'submitTask').mockResolvedValue()

    const wrapper = mount(FlexTaskPanel, {
      global: {
        plugins: [vuetify]
      }
    })

    await nextTick()

    const fallbackPanel = wrapper.get('[data-test="fallback-output-panel"]')
    if (!fallbackPanel.classes().includes('v-expansion-panel--active')) {
      await fallbackPanel.find('.v-expansion-panel-title').trigger('click')
      await nextTick()
    }

    const toneWidget = wrapper.findComponent(DefaultFacetWidget)
    expect(toneWidget.exists()).toBe(true)
    expect(toneWidget.props('definition')?.name).toBe('toneOfVoice')

    toneWidget.vm.$emit('update:modelValue', 'Warm & Friendly')
    await nextTick()

    const submitButton = wrapper.find('[data-test="flex-task-submit"]')
    expect(submitButton.exists()).toBe(true)
    await submitButton.trigger('click')

    expect(submitSpy).toHaveBeenCalledTimes(1)
    const [taskId, payload] = submitSpy.mock.calls[0]
    expect(taskId).toBe('task_component')
    expect(payload.output).toEqual({ toneOfVoice: 'Warm & Friendly' })
  })

  it('supports clarification response widget workflow', async () => {
    const store = useFlexTasksStore()
    store.handleNodeStart({
      type: 'node_start',
      timestamp: BASE_TIMESTAMP,
      runId: 'run_clarify',
      nodeId: 'node_clarify',
      payload: {
        executorType: 'human',
        assignment: {
          assignmentId: 'task_clarify',
          runId: 'run_clarify',
          nodeId: 'node_clarify',
          label: 'Clarify questions',
          status: 'awaiting_submission'
        },
        facets: { output: ['clarificationResponse'] },
        contracts: { output: { mode: 'facets', facets: ['clarificationResponse'] } }
      }
    } as FlexEventWithId)

    const submitSpy = vi.spyOn(store, 'submitTask').mockResolvedValue()

    const wrapper = mount(FlexTaskPanel, {
      global: { plugins: [vuetify] }
    })
    await nextTick()

    const panel = wrapper.get('[data-test="fallback-output-panel"]')
    if (!panel.classes().includes('v-expansion-panel--active')) {
      await panel.find('.v-expansion-panel-title').trigger('click')
      await nextTick()
    }

    const widget = panel.findComponent(DefaultFacetWidget)
    expect(widget.exists()).toBe(true)
    expect(widget.props('definition')?.name).toBe('clarificationResponse')

    widget.vm.$emit('update:modelValue', {
      responses: [
        {
          questionId: 'clarify_1',
          status: 'answered',
          response: 'Answer for clarify_1'
        }
      ]
    })

    const submitButton = wrapper.find('[data-test="flex-task-submit"]')
    await submitButton.trigger('click')

    expect(submitSpy).toHaveBeenCalledTimes(1)
    const [, payload] = submitSpy.mock.calls[0]
    expect(payload.output).toMatchObject({
      clarificationResponse: {
        responses: expect.arrayContaining([
          expect.objectContaining({
            questionId: 'clarify_1'
          })
        ])
      }
    })
  })

  it('prevents submission when clarification responses are empty', async () => {
    const store = useFlexTasksStore()
    store.handleNodeStart({
      type: 'node_start',
      timestamp: BASE_TIMESTAMP,
      runId: 'run_clarify',
      nodeId: 'node_clarify',
      payload: {
        executorType: 'human',
        assignment: {
          assignmentId: 'task_clarify',
          runId: 'run_clarify',
          nodeId: 'node_clarify',
          label: 'Clarify questions',
          status: 'awaiting_submission'
        },
        facets: { output: ['clarificationResponse'] },
        contracts: { output: { mode: 'facets', facets: ['clarificationResponse'] } }
      }
    } as FlexEventWithId)

    const submitSpy = vi.spyOn(store, 'submitTask').mockResolvedValue()

    const wrapper = mount(FlexTaskPanel, {
      global: { plugins: [vuetify] }
    })
    await nextTick()

    const panel = wrapper.get('[data-test="fallback-output-panel"]')
    if (!panel.classes().includes('v-expansion-panel--active')) {
      await panel.find('.v-expansion-panel-title').trigger('click')
      await nextTick()
    }

    const widget = panel.findComponent(DefaultFacetWidget)
    widget.vm.$emit('update:modelValue', {
      responses: [
        {
          status: 'answered',
          response: 'Answer without question id'
        }
      ]
    })
    await nextTick()

    const submitButton = wrapper.find('[data-test="flex-task-submit"]')
    await submitButton.trigger('click')
    await nextTick()

    expect(submitSpy).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Add at least one response with a question ID before submitting.')
  })

  it('renders fallback JSON panels when no facet-specific widget exists', async () => {
    const store = useFlexTasksStore()
    store.handleNodeStart({
      type: 'node_start',
      timestamp: BASE_TIMESTAMP,
      runId: 'run_fallback',
      nodeId: 'node_fallback',
      payload: {
        executorType: 'human',
        assignment: {
          assignmentId: 'task_fallback',
          runId: 'run_fallback',
          nodeId: 'node_fallback',
          label: 'General review',
          status: 'awaiting_submission',
          metadata: {
            currentInputs: {
              audienceProfile: {
                persona: 'Flex Operators',
                segments: ['Ops', 'Support']
              }
            }
          }
        },
        facets: { input: ['audienceProfile'], output: ['strategicRationale'] },
        contracts: {
          input: { mode: 'facets', facets: ['audienceProfile'] },
          output: { mode: 'facets', facets: ['strategicRationale'] }
        }
      }
    } as FlexEventWithId)

    const wrapper = mount(FlexTaskPanel, {
      global: { plugins: [vuetify] }
    })
    await nextTick()

    const submitSpy = vi.spyOn(store, 'submitTask').mockResolvedValue()

    const inputPanel = wrapper.get('[data-test="input-facet-panel"]')
    expect(inputPanel.classes()).not.toContain('v-expansion-panel--active')
    await inputPanel.find('.v-expansion-panel-title').trigger('click')
    await nextTick()
    expect(inputPanel.classes()).toContain('v-expansion-panel--active')

    const inputJson = wrapper.get('[data-test="input-facet-json"]')
    expect(inputJson.text()).toContain('Flex Operators')
    expect(inputJson.text().trim().startsWith('{')).toBe(true)

    const fallbackPanel = wrapper.get('[data-test="fallback-output-panel"]')
    expect(fallbackPanel.classes()).toContain('v-expansion-panel--active')

    const textarea = fallbackPanel.find('textarea')
    expect(textarea.exists()).toBe(true)
    await textarea.setValue('Strategic response for operators')
    await nextTick()

    const submitButton = wrapper.get('[data-test="flex-task-submit"]')
    await submitButton.trigger('click')

    expect(submitSpy).toHaveBeenCalledTimes(1)
    expect(submitSpy).toHaveBeenCalledWith(
      'task_fallback',
      expect.objectContaining({
        output: expect.objectContaining({ strategicRationale: 'Strategic response for operators' })
      })
    )
  })

  it('displays contract-defined output facets when facet list omits entries', async () => {
    const store = useFlexTasksStore()
    store.handleNodeStart({
      type: 'node_start',
      timestamp: BASE_TIMESTAMP,
      runId: 'run_visual',
      nodeId: 'node_visual',
      facetProvenance: {
        output: [
          { facet: 'handoff_summary', pointer: '/artifacts/handoff_summary' },
          { facet: 'post_visual', pointer: '/artifacts/post_visual' }
        ]
      },
      payload: {
        executorType: 'human',
        assignment: {
          assignmentId: 'task_visual',
          runId: 'run_visual',
          nodeId: 'node_visual',
          label: 'Design social visual',
          status: 'awaiting_submission',
          capabilityId: 'designer.VisualDesign'
        },
        facets: { output: ['handoff_summary'] },
        contracts: { output: { mode: 'facets', facets: ['handoff_summary', 'post_visual'] } }
      }
    } as FlexEventWithId)

    const wrapper = mount(FlexTaskPanel, {
      global: { plugins: [vuetify] }
    })
    await nextTick()

    const titles = wrapper.findAll('.v-expansion-panel-title')
    const titlesText = titles.map((title) => title.text())
    expect(titlesText).toContain('Post Visual')
    expect(titlesText).toContain('Handoff Summary')
  })

  it('falls back to capability catalog facets when contracts are absent', async () => {
    const store = useFlexTasksStore()
    store.handleNodeStart({
      type: 'node_start',
      timestamp: BASE_TIMESTAMP,
      runId: 'run_visual_capability',
      nodeId: 'node_visual_capability',
      payload: {
        executorType: 'human',
        assignment: {
          assignmentId: 'task_visual_capability',
          runId: 'run_visual_capability',
          nodeId: 'node_visual_capability',
          label: 'Design social visual',
          status: 'awaiting_submission',
          capabilityId: 'designer.VisualDesign'
        },
        facets: { output: ['handoff_summary'] }
      }
    } as FlexEventWithId)

    const wrapper = mount(FlexTaskPanel, {
      global: { plugins: [vuetify] }
    })
    await nextTick()

    const titles = wrapper.findAll('.v-expansion-panel-title')
    const titlesText = titles.map((title) => title.text())
    expect(titlesText).toContain('Post Visual')
    expect(titlesText).toContain('Handoff Summary')
  })

  it('filters out facets not declared by contracts or capability', async () => {
    const store = useFlexTasksStore()
    store.handleNodeStart({
      type: 'node_start',
      timestamp: BASE_TIMESTAMP,
      runId: 'run_director',
      nodeId: 'node_director',
      payload: {
        executorType: 'human',
        assignment: {
          assignmentId: 'task_director',
          runId: 'run_director',
          nodeId: 'node_director',
          capabilityId: 'director.SocialPostingReview',
          label: 'Review social post',
          status: 'awaiting_submission'
        },
        facets: { output: ['feedback', 'strategic_rationale'] }
      }
    } as FlexEventWithId)

    const wrapper = mount(FlexTaskPanel, {
      global: { plugins: [vuetify] }
    })
    await nextTick()

    const titles = wrapper.findAll('.v-expansion-panel-title')
    const titlesText = titles.map((title) => title.text())
    expect(titlesText).toContain('Feedback')
    expect(titlesText).toContain('Social Post')
    expect(titlesText).not.toContain('Strategic Rationale')
  })

  it('wraps feedback JSON objects into arrays for convenience', async () => {
    const store = useFlexTasksStore()
    store.handleNodeStart({
      type: 'node_start',
      timestamp: BASE_TIMESTAMP,
      runId: 'run_director_feedback',
      nodeId: 'node_director_feedback',
      payload: {
        executorType: 'human',
        assignment: {
          assignmentId: 'task_director_feedback',
          runId: 'run_director_feedback',
          nodeId: 'node_director_feedback',
          capabilityId: 'director.SocialPostingReview',
          label: 'Review social post',
          status: 'awaiting_submission'
        },
        facets: { output: ['feedback'] }
      }
    } as FlexEventWithId)

    const wrapper = mount(FlexTaskPanel, {
      global: { plugins: [vuetify] }
    })
    await nextTick()

    const textarea = wrapper.get('textarea')
    await textarea.setValue(
      JSON.stringify(
        { facet: 'post', message: 'Looks good', author: 'Director' },
        null,
        2
      )
    )
    await textarea.trigger('blur')
    await nextTick()

    expect(textarea.element.value).toContain('[')
    expect(textarea.element.value).toContain('"Looks good"')
  })

  it('prefills handoff summary from metadata currentOutput', async () => {
    const store = useFlexTasksStore()
    store.handleNodeStart({
      type: 'node_start',
      timestamp: BASE_TIMESTAMP,
      runId: 'run_handoff_metadata',
      nodeId: 'node_handoff_metadata',
      payload: {
        executorType: 'human',
        assignment: {
          assignmentId: 'task_handoff_metadata',
          runId: 'run_handoff_metadata',
          nodeId: 'node_handoff_metadata',
          label: 'Design social visual',
          status: 'awaiting_submission',
          capabilityId: 'designer.VisualDesign',
          metadata: {
            currentInputs: {
              creative_brief: { objective: 'Test objective' }
            },
            currentOutput: {
              handoff_summary: ['Existing entry A', 'Existing entry B', 'Existing entry C']
            }
          }
        },
        facets: { output: ['handoff_summary'] }
      }
    } as FlexEventWithId)

    const wrapper = mount(FlexTaskPanel, {
      global: { plugins: [vuetify] }
    })
    await nextTick()

    const panel = wrapper.get('[data-test="fallback-output-panel"]')
    await panel.find('.v-expansion-panel-title').trigger('click')
    await nextTick()

    const widget = panel.findComponent(DefaultFacetWidget)
    expect(widget.props('modelValue')).toEqual([
      'Existing entry A',
      'Existing entry B',
      'Existing entry C'
    ])
  })

  it('prefills handoff summary from input when output payload is missing', async () => {
    const store = useFlexTasksStore()
    store.handleNodeStart({
      type: 'node_start',
      timestamp: BASE_TIMESTAMP,
      runId: 'run_handoff_input',
      nodeId: 'node_handoff_input',
      payload: {
        executorType: 'human',
        assignment: {
          assignmentId: 'task_handoff_input',
          runId: 'run_handoff_input',
          nodeId: 'node_handoff_input',
          label: 'Design social visual',
          status: 'awaiting_submission',
          capabilityId: 'designer.VisualDesign',
          metadata: {
            currentInputs: {
              handoff_summary: ['Carry-over entry 1', 'Carry-over entry 2']
            }
          }
        },
        facets: { input: ['handoff_summary'], output: ['handoff_summary'] }
      }
    } as FlexEventWithId)

    const wrapper = mount(FlexTaskPanel, {
      global: { plugins: [vuetify] }
    })
    await nextTick()

    const panel = wrapper.get('[data-test="fallback-output-panel"]')
    await panel.find('.v-expansion-panel-title').trigger('click')
    await nextTick()

    const widget = panel.findComponent(DefaultFacetWidget)
    expect(widget.props('modelValue')).toEqual(['Carry-over entry 1', 'Carry-over entry 2'])
  })

  it('prefills existing arrays when provenance points to nested paths', async () => {
    const store = useFlexTasksStore()
    store.handleNodeStart({
      type: 'node_start',
      timestamp: BASE_TIMESTAMP,
      runId: 'run_handoff_pointer',
      nodeId: 'node_handoff_pointer',
      facetProvenance: {
        output: [{ facet: 'handoff_summary', pointer: '/artifacts/handoff_summary' }]
      },
      payload: {
        executorType: 'human',
        assignment: {
          assignmentId: 'task_handoff_pointer',
          runId: 'run_handoff_pointer',
          nodeId: 'node_handoff_pointer',
          capabilityId: 'copywriter.SocialpostDrafting',
          label: 'Update handoff summary',
          status: 'awaiting_submission',
          metadata: {
            currentOutput: {
              handoff_summary: ['Existing summary entry']
            }
          }
        },
        facets: { output: ['handoff_summary'] }
      }
    } as FlexEventWithId)

    const activeTask = store.activeTask
    expect(((activeTask?.metadata as Record<string, unknown> | undefined)?.currentOutput as Record<string, unknown> | undefined)?.handoff_summary).toEqual([
      'Existing summary entry'
    ])
    expect(activeTask?.facetProvenance?.output?.[0]?.pointer).toBe('/artifacts/handoff_summary')

    const wrapper = mount(FlexTaskPanel, {
      global: { plugins: [vuetify] }
    })
    await nextTick()

    const fallbackPanel = wrapper.get('[data-test="fallback-output-panel"]')
    await fallbackPanel.find('.v-expansion-panel-title').trigger('click')
    await nextTick()

    const vm = wrapper.vm as unknown as { facetValue?: (pointer: string) => unknown }
    if (vm.facetValue) {
      expect(vm.facetValue('/artifacts/handoff_summary')).toEqual(['Existing summary entry'])
    }

    const widget = fallbackPanel.findComponent(DefaultFacetWidget)
    expect(widget.props('modelValue')).toEqual(['Existing summary entry'])
  })
})
