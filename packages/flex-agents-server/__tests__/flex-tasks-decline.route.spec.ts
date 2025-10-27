// @vitest-environment node
import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest'
import { createApp, eventHandler, readBody as h3ReadBody, toNodeListener } from 'h3'
import { fetchNodeRequestHandler } from 'node-mock-http'

vi.mock('../src/services/orchestrator-persistence', () => {
  const listPendingHumanTasksMock = vi.fn()
  const loadFlexRunMock = vi.fn()
  const recordResumeAuditMock = vi.fn()

  class MockFlexRunPersistence {
    constructor() {}
    async listPendingHumanTasks(...args: any[]) {
      return listPendingHumanTasksMock(...args)
    }
    async loadFlexRun(...args: any[]) {
      return loadFlexRunMock(...args)
    }
    async recordResumeAudit(...args: any[]) {
      return recordResumeAuditMock(...args)
    }
  }

  return {
    FlexRunPersistence: MockFlexRunPersistence,
    __mocks: {
      listPendingHumanTasksMock,
      loadFlexRunMock,
      recordResumeAuditMock
    }
  }
})

vi.mock('../src/services/telemetry-service', () => {
  const createRunEmitterMock = vi.fn((_base, sink) => async (frame: any) => {
    await sink(frame)
  })
  return {
    getTelemetryService: () => ({
      createRunEmitter: createRunEmitterMock
    }),
    __mocks: {
      createRunEmitterMock
    }
  }
})

vi.mock('../src/services/flex-run-coordinator', () => {
  const runMock = vi.fn()
  class MockFlexRunCoordinator {
    constructor() {}
    async run(...args: any[]) {
      return runMock(...args)
    }
  }
  return {
    FlexRunCoordinator: MockFlexRunCoordinator,
    __mocks: {
      runMock
    }
  }
})

vi.mock('../src/services/logger', () => {
  const info = vi.fn()
  const warn = vi.fn()
  const error = vi.fn()
  return {
    genCorrelationId: () => 'corr_test_decline',
    getLogger: () => ({ info, warn, error })
  }
})

import { __mocks as persistenceMocks } from '../src/services/orchestrator-persistence'
import { __mocks as telemetryMocks } from '../src/services/telemetry-service'
import { __mocks as coordinatorMocks } from '../src/services/flex-run-coordinator'

function makeDeclineRequest(handler: any) {
  const app = createApp()
  app.use(
    '/api/v1/flex/tasks',
    eventHandler((event) => {
      const segments = (event.path || '').split('/')
      const taskIdSegment = segments.length >= 2 ? segments[segments.length - 2] : ''
      event.context.params = { ...(event.context.params ?? {}), taskId: taskIdSegment }
      return handler(event)
    })
  )
  const listener = toNodeListener(app)
  return async (taskId: string, body: Record<string, unknown>) => {
    const res = await fetchNodeRequestHandler(
      listener,
      `http://test.local/api/v1/flex/tasks/${taskId}/decline`,
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json'
        },
        body: JSON.stringify(body)
      }
    )
    const text = await res.text()
    const responseBody = text ? JSON.parse(text) : null
    return { status: res.status, body: responseBody, headers: res.headers }
  }
}

describe('Flex task decline route', () => {
  beforeEach(() => {
    vi.stubGlobal('defineEventHandler', (fn: any) => eventHandler(fn))
    vi.stubGlobal('readBody', (event: any) => h3ReadBody(event as any))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    persistenceMocks.listPendingHumanTasksMock.mockReset()
    persistenceMocks.loadFlexRunMock.mockReset()
    persistenceMocks.recordResumeAuditMock.mockReset()
    telemetryMocks.createRunEmitterMock.mockReset()
    coordinatorMocks.runMock.mockReset()
  })

  it('marks the task as declined and fails the run', async () => {
    const taskId = 'flex_run_123:HumanAgent_clarifyBrief_1'
    persistenceMocks.listPendingHumanTasksMock.mockResolvedValue([
      {
        taskId,
        runId: 'flex_run_123',
        nodeId: 'clarify_node_1',
        capabilityId: 'HumanAgent.clarifyBrief',
        label: 'Clarify Brief',
        status: 'awaiting_submission',
        assignedTo: 'operator@example.com',
        role: 'Strategist',
        dueAt: null,
        priority: 'normal',
        instructions: 'Please clarify',
        defaults: null,
        metadata: null,
        timeoutSeconds: null,
        maxNotifications: null,
        notifyChannels: ['in_app'],
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:05:00.000Z',
        contracts: null,
        facets: null,
        facetProvenance: null,
        runStatus: 'awaiting_human',
        runUpdatedAt: '2025-01-01T00:05:00.000Z'
      }
    ])
    persistenceMocks.loadFlexRunMock.mockResolvedValue({
      run: {
        runId: 'flex_run_123',
        status: 'awaiting_human',
        threadId: 'thread_123',
        envelope: {
          objective: 'Clarify brief',
          outputContract: {
            mode: 'json_schema',
            schema: { type: 'object' }
          }
        },
        schemaHash: null,
        metadata: {},
        result: null,
        planVersion: 2,
        contextSnapshot: null
      },
      nodes: [
        {
          nodeId: 'clarify_node_1',
          status: 'awaiting_human',
          capabilityId: 'HumanAgent.clarifyBrief',
          label: 'Clarify Brief',
          context: {
            assignment: {
              assignmentId: taskId,
              status: 'awaiting_submission',
              updatedAt: '2025-01-01T00:05:00.000Z'
            }
          }
        }
      ]
    })
    coordinatorMocks.runMock.mockResolvedValue({
      runId: 'flex_run_123',
      status: 'failed',
      output: null
    })

    const { default: handler } = await import('../routes/api/v1/flex/tasks/[taskId]/decline.post')
    const request = makeDeclineRequest(handler as any)

    const res = await request(taskId, { reason: 'Details missing', note: 'Need additional info' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      ok: true,
      status: 'failed',
      runId: 'flex_run_123',
      nodeId: 'clarify_node_1'
    })

    expect(persistenceMocks.listPendingHumanTasksMock).toHaveBeenCalledTimes(1)
    expect(persistenceMocks.loadFlexRunMock).toHaveBeenCalledWith('flex_run_123')

    expect(persistenceMocks.recordResumeAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'flex_run_123' }),
      { operator: null, note: 'Need additional info' }
    )
    expect(telemetryMocks.createRunEmitterMock).toHaveBeenCalledTimes(1)
    expect(coordinatorMocks.runMock).toHaveBeenCalledWith(
      expect.objectContaining({ objective: 'Clarify brief' }),
      expect.objectContaining({
        correlationId: 'corr_test_decline',
        resumeSubmission: expect.objectContaining({
          nodeId: 'clarify_node_1',
          decline: {
            reason: 'Details missing',
            note: 'Need additional info'
          }
        })
      })
    )
    expect(res.headers.get('x-correlation-id')).toBe('corr_test_decline')
  })

  it('returns 404 when the task is unknown', async () => {
    persistenceMocks.listPendingHumanTasksMock.mockResolvedValue([])

    const { default: handler } = await import('../routes/api/v1/flex/tasks/[taskId]/decline.post')
    const request = makeDeclineRequest(handler as any)

    const res = await request('flex_missing_task', { reason: 'No task' })

    expect(res.status).toBe(404)
    expect(res.body).toMatchObject({
      statusCode: 404,
      statusMessage: 'Task not found',
      data: { code: 'task_not_found' }
    })
    expect(persistenceMocks.loadFlexRunMock).not.toHaveBeenCalled()
  })

  it('returns 409 when task is no longer awaiting human input', async () => {
    const taskId = 'flex_run_456:HumanAgent_clarifyBrief_2'
    persistenceMocks.listPendingHumanTasksMock.mockResolvedValue([
      {
        taskId,
        runId: 'flex_run_456',
        nodeId: 'clarify_node_2'
      }
    ])
    persistenceMocks.loadFlexRunMock.mockResolvedValue({
      run: {
        runId: 'flex_run_456',
        status: 'completed',
        threadId: 'thread_456',
        envelope: {},
        schemaHash: null,
        metadata: null,
        result: null,
        planVersion: 1,
        contextSnapshot: null
      },
      nodes: [
        {
          nodeId: 'clarify_node_2',
          status: 'completed',
          context: {}
        }
      ]
    })

    const { default: handler } = await import('../routes/api/v1/flex/tasks/[taskId]/decline.post')
    const request = makeDeclineRequest(handler as any)

    const res = await request(taskId, { reason: 'Too late' })

    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({
      statusCode: 409,
      statusMessage: 'Run is not awaiting human input',
      data: { code: 'invalid_run_state', status: 'completed' }
    })
    expect(coordinatorMocks.runMock).not.toHaveBeenCalled()
  })
})
