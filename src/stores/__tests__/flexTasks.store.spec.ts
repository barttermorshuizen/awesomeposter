import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { FlexEventWithId } from '@/lib/flex-sse'
import { useFlexTasksStore } from '@/stores/flexTasks'
import { postFlexEventStream } from '@/lib/flex-sse'

vi.mock('@/lib/flex-event-bus', () => ({
  emitFlexEvent: vi.fn()
}))

vi.mock('@/lib/flex-sse', () => ({
  postFlexEventStream: vi.fn()
}))

const BASE_TIMESTAMP = '2025-01-01T00:00:00.000Z'

function buildNodeStartEvent(overrides: Partial<FlexEventWithId> = {}): FlexEventWithId {
  return {
    type: 'node_start',
    timestamp: BASE_TIMESTAMP,
    runId: 'run_123',
    nodeId: 'node_alpha',
    payload: {
      executorType: 'human',
      startedAt: BASE_TIMESTAMP,
      assignment: {
        assignmentId: 'task_alpha',
        runId: 'run_123',
        nodeId: 'node_alpha',
        label: 'Clarify Objective',
        status: 'awaiting_submission',
        role: 'strategist',
        assignedTo: 'operator@example.com'
      },
      facets: { output: ['toneOfVoice'] },
      contracts: { output: { mode: 'facets', facets: ['toneOfVoice'] } }
    },
    ...overrides
  }
}

function buildNodeCompleteEvent(): FlexEventWithId {
  return {
    type: 'node_complete',
    timestamp: BASE_TIMESTAMP,
    runId: 'run_123',
    nodeId: 'node_alpha'
  }
}

function buildNodeErrorEvent(message = 'validation failed'): FlexEventWithId {
  return {
    type: 'node_error',
    timestamp: BASE_TIMESTAMP,
    runId: 'run_123',
    nodeId: 'node_alpha',
    message,
    payload: {
      error: {
        message
      }
    }
  }
}

describe('useFlexTasksStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(postFlexEventStream).mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('registers human assignments from node_start frames', () => {
    const store = useFlexTasksStore()
    store.handleNodeStart(buildNodeStartEvent())
    expect(store.pendingTasks).toHaveLength(1)
    const task = store.pendingTasks[0]
    expect(task.taskId).toBe('task_alpha')
    expect(task.facets?.output).toEqual(['toneOfVoice'])
    expect(task.status).toBe('awaiting_submission')
  })

  it('removes assignments when node completes', () => {
    const store = useFlexTasksStore()
    store.handleNodeStart(buildNodeStartEvent())
    store.handleNodeComplete(buildNodeCompleteEvent())
    expect(store.pendingTasks).toHaveLength(0)
  })

  it('marks submission error when node errors after submission', () => {
    const store = useFlexTasksStore()
    store.handleNodeStart(buildNodeStartEvent())
    store.handleNodeError(buildNodeErrorEvent('invalid payload'))
    expect(store.pendingTasks[0]?.submissionState).toBe('error')
    expect(store.pendingTasks[0]?.submissionError).toContain('invalid payload')
  })

  it('hydrates tasks from backlog endpoint', async () => {
    const store = useFlexTasksStore()
    const fetchMock = vi.spyOn(global, 'fetch' as typeof fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        tasks: [
          {
            taskId: 'task_beta',
            assignmentId: 'task_beta',
            runId: 'run_backlog',
            nodeId: 'node_beta',
            label: 'Backlog task',
            status: 'awaiting_submission',
            facets: { output: ['toneOfVoice'] }
          }
        ]
      })
    } as unknown as Response)

    await store.hydrateFromBacklog({ syncLegacyHitl: false })
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3003/api/v1/flex/tasks', expect.any(Object))
    expect(store.pendingTasks).toHaveLength(1)
    expect(store.pendingTasks[0]?.taskId).toBe('task_beta')
  })

  it('submits resume payload to flex run.resume endpoint', async () => {
    const store = useFlexTasksStore()
    store.handleNodeStart(buildNodeStartEvent())
    const fetchMock = vi.spyOn(global, 'fetch' as typeof fetch)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, tasks: [] })
    } as unknown as Response)
    const streamOptions: any[] = []
    vi.mocked(postFlexEventStream).mockImplementation((options) => {
      streamOptions.push(options)
      const { onEvent } = options
      onEvent({
        type: 'node_complete',
        timestamp: BASE_TIMESTAMP,
        runId: 'run_123',
        nodeId: 'node_alpha'
      })
      return {
        abort: vi.fn(),
        done: Promise.resolve()
      }
    })

    await store.submitTask('task_alpha', {
      output: { toneOfVoice: 'Warm & Friendly' },
      note: 'Ready to resume'
    })

    expect(postFlexEventStream).toHaveBeenCalledTimes(1)
    const { url, body } = streamOptions[0]
    expect(url).toBe('http://localhost:3003/api/v1/flex/run.resume')
    const parsed = body as Record<string, unknown>
    expect(parsed).toMatchObject({
      runId: 'run_123',
      payload: {
        nodeId: 'node_alpha',
        output: { toneOfVoice: 'Warm & Friendly' },
        note: 'Ready to resume'
      }
    })
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3003/api/v1/flex/tasks', expect.any(Object))
    expect(store.pendingTasks).toHaveLength(0)
  })

  it('hides tasks that are awaiting orchestrator confirmation', async () => {
    const store = useFlexTasksStore()
    store.handleNodeStart(buildNodeStartEvent())

    const fetchMock = vi.spyOn(global, 'fetch' as typeof fetch).mockRejectedValue(new Error('network failure'))
    vi.mocked(postFlexEventStream).mockReturnValue({
      abort: vi.fn(),
      done: Promise.resolve()
    })

    await store.submitTask('task_alpha', {
      output: { toneOfVoice: 'Calm' }
    })

    expect(store.pendingTasks).toHaveLength(0)
    expect(store.hasPendingTasks).toBe(false)
    const storedTask = store.tasks.find((task) => task.taskId === 'task_alpha')
    expect(storedTask?.awaitingConfirmation).toBe(true)
    fetchMock.mockRestore()
  })

  it('declines tasks via flex tasks decline endpoint', async () => {
    const store = useFlexTasksStore()
    store.handleNodeStart(buildNodeStartEvent())
    const fetchMock = vi.spyOn(global, 'fetch' as typeof fetch)
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, tasks: [] })
    } as unknown as Response)

    const streamOptions: any[] = []
    vi.mocked(postFlexEventStream).mockImplementation((options) => {
      streamOptions.push(options)
      const { onEvent } = options
      onEvent({
        type: 'node_complete',
        timestamp: BASE_TIMESTAMP,
        runId: 'run_123',
        nodeId: 'node_alpha',
        payload: {
          outcome: 'declined',
          decline: {
            reason: 'Out of scope',
            action: 'fail_run'
          }
        }
      })
      onEvent({
        type: 'complete',
        timestamp: BASE_TIMESTAMP,
        runId: 'run_123',
        payload: {
          status: 'failed',
          error: 'Out of scope'
        }
      })
      return {
        abort: vi.fn(),
        done: Promise.resolve()
      }
    })

    await store.declineTask('task_alpha', { reason: 'Out of scope' })

    expect(postFlexEventStream).toHaveBeenCalledTimes(1)
    const { url, body } = streamOptions[0]
    expect(url).toBe('http://localhost:3003/api/v1/flex/run.resume')
    expect(body).toMatchObject({
      runId: 'run_123',
      payload: {
        nodeId: 'node_alpha',
        decline: {
          reason: 'Out of scope'
        }
      }
    })
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3003/api/v1/flex/tasks', expect.any(Object))
    expect(store.pendingTasks).toHaveLength(0)
  })

  it('preserves colon-delimited identifiers when declining tasks', async () => {
    const store = useFlexTasksStore()
    const nodeStart = buildNodeStartEvent()
    nodeStart.payload.assignment.assignmentId = 'flex_task_alpha:HumanAgent_clarifyBrief_1'
    store.handleNodeStart(nodeStart)

    vi.mocked(postFlexEventStream).mockImplementation((options) => {
      const { onEvent } = options
      onEvent({
        type: 'node_complete',
        timestamp: BASE_TIMESTAMP,
        runId: 'run_123',
        nodeId: 'node_alpha',
        payload: {
          outcome: 'declined',
          decline: {
            reason: 'Not appropriate',
            action: 'fail_run'
          }
        }
      })
      onEvent({
        type: 'complete',
        timestamp: BASE_TIMESTAMP,
        runId: 'run_123',
        payload: {
          status: 'failed'
        }
      })
      return {
        abort: vi.fn(),
        done: Promise.resolve()
      }
    })
    const fetchMock = vi.spyOn(global, 'fetch' as typeof fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, tasks: [] })
    } as unknown as Response)

    await store.declineTask('flex_task_alpha:HumanAgent_clarifyBrief_1', { reason: 'Not appropriate' })
    expect(postFlexEventStream).toHaveBeenCalledTimes(1)
    const options = vi.mocked(postFlexEventStream).mock.calls[0]?.[0]
    expect(options?.url).toBe('http://localhost:3003/api/v1/flex/run.resume')
    expect(options?.body).toMatchObject({
      runId: 'run_123',
      payload: {
        nodeId: 'node_alpha',
        decline: {
          reason: 'Not appropriate'
        }
      }
    })
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3003/api/v1/flex/tasks', expect.any(Object))
  })

})
