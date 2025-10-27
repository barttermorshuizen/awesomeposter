import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import vuetify from '@/plugins/vuetify'
import FlexTaskPanel from '@/components/flex-tasks/FlexTaskPanel.vue'
import ToneOfVoiceWidget from '@/components/flex-tasks/widgets/ToneOfVoiceWidget.vue'
import ClarificationResponseWidget from '@/components/flex-tasks/widgets/ClarificationResponseWidget.vue'
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

    const toneWidget = wrapper.findComponent(ToneOfVoiceWidget)
    expect(toneWidget.exists()).toBe(true)

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

    const widget = wrapper.findComponent(ClarificationResponseWidget)
    expect(widget.exists()).toBe(true)

    const addButton = wrapper.find('[data-test="clarification-response-add"]')
    expect(addButton.exists()).toBe(true)
    await addButton.trigger('click')

    const questionFields = wrapper.findAll('[data-test="clarification-response-question-id"] input')
    expect(questionFields.length).toBeGreaterThan(0)
    await questionFields[0].setValue('clarify_1')
    await nextTick()

    const responseAreas = wrapper.findAll('[data-test="clarification-response-response"] textarea')
    expect(responseAreas.length).toBeGreaterThan(0)
    await responseAreas[0].setValue('Answer for clarify_1')
    await nextTick()

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

  it('prefills clarification responses when metadata includes pending questions', async () => {
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
          status: 'awaiting_submission',
          metadata: {
            currentInputs: {
              clarificationRequest: {
                pendingQuestions: [
                  {
                    id: 'clarify_budget',
                    question: 'What is the approved budget?',
                    required: true
                  }
                ]
              }
            }
          }
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

    const questionField = wrapper.find('[data-test="clarification-response-question-id"] input')
    expect(questionField.element.value).toBe('clarify_budget')
    expect(wrapper.text()).toContain('What is the approved budget?')

    const responseArea = wrapper.find('[data-test="clarification-response-response"] textarea')
    await responseArea.setValue('$5k')
    await nextTick()

    const submitButton = wrapper.find('[data-test="flex-task-submit"]')
    await submitButton.trigger('click')

    expect(submitSpy).toHaveBeenCalledTimes(1)
    const [, payload] = submitSpy.mock.calls[0]
    expect(payload.output).toMatchObject({
      clarificationResponse: {
        responses: [
          expect.objectContaining({
            questionId: 'clarify_budget',
            response: '$5k'
          })
        ]
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

    const responseAreas = wrapper.findAll('[data-test="clarification-response-response"] textarea')
    expect(responseAreas.length).toBeGreaterThan(0)
    await responseAreas[0].setValue('Answer without question id')
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
})
