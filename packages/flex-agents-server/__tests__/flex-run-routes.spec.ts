// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const loadFlexRunMock = vi.fn()
const loadPlanSnapshotMock = vi.fn()
const recordResumeAuditMock = vi.fn()
const loadFlexRunDebugMock = vi.fn()

vi.mock('../src/services/orchestrator-persistence', () => {

  class MockFlexRunPersistence {
     
    constructor() {}
    async loadFlexRun(...args: any[]) {
      return loadFlexRunMock(...args)
    }
    async loadPlanSnapshot(...args: any[]) {
      return loadPlanSnapshotMock(...args)
    }
    async recordResumeAudit(...args: any[]) {
      return recordResumeAuditMock(...args)
    }
    async loadFlexRunDebug(...args: any[]) {
      return loadFlexRunDebugMock(...args)
    }
    async updateStatus() {}
    async saveRunContext() {}
  }
  return {
    FlexRunPersistence: MockFlexRunPersistence,
    __mocks: {
      loadFlexRunMock,
      loadPlanSnapshotMock,
      recordResumeAuditMock,
      loadFlexRunDebugMock
    }
  }
})

const coordinatorRunMock = vi.fn()

vi.mock('../src/services/flex-run-coordinator', () => {
  class MockFlexRunCoordinator {
    constructor() {}
    async run(...args: any[]) {
      return coordinatorRunMock(...args)
    }
  }
  return {
    FlexRunCoordinator: MockFlexRunCoordinator,
    __mocks: {
      runMock: coordinatorRunMock
    }
  }
})

const persistenceMocks = {
  loadFlexRunMock,
  loadPlanSnapshotMock,
  recordResumeAuditMock,
  loadFlexRunDebugMock
}

const coordinatorMocks = {
  runMock: coordinatorRunMock
}

import { createApp, eventHandler, readBody as h3ReadBody, toNodeListener } from 'h3'
import { fetchNodeRequestHandler } from 'node-mock-http'
import type { TaskEnvelope } from '@awesomeposter/shared'

function makeSseRequest(handler: any) {
  const app = createApp()
  app.use('/api/v1/flex/run.resume', handler)
  const listener = toNodeListener(app) as unknown as Parameters<typeof fetchNodeRequestHandler>[0]
  return async (payload: Record<string, unknown>) => {
    const res = await fetchNodeRequestHandler(listener, 'http://test.local/api/v1/flex/run.resume', {
      method: 'POST',
      headers: {
        accept: 'text/event-stream',
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    })
    const text = await res.text()
    return { status: res.status, text }
  }
}

function makeJsonRequest(handler: any) {
  const app = createApp()
  app.use(
    '/api/v1/flex/runs',
    eventHandler((event) => {
      const segments = (event.path || '').split('/')
      const id = segments[segments.length - 1]
      event.context.params = { ...(event.context.params ?? {}), id }
      return handler(event)
    })
  )
  const listener = toNodeListener(app) as unknown as Parameters<typeof fetchNodeRequestHandler>[0]
  return async (id: string) => {
    const res = await fetchNodeRequestHandler(listener, `http://test.local/api/v1/flex/runs/${id}`, {
      method: 'GET',
      headers: { accept: 'application/json' }
    })
    const text = await res.text()
    let body: any = null
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = text
      }
    }
    return { status: res.status, body }
  }
}

describe('Flex run routes', () => {
  const envelope: TaskEnvelope = {
    objective: 'Resume flex run',
    outputContract: {
      mode: 'json_schema',
      schema: { type: 'object', additionalProperties: true }
    }
  }

  beforeEach(() => {
    vi.stubGlobal('defineEventHandler', (fn: any) => eventHandler(fn))
    vi.stubGlobal('readBody', (event: any) => h3ReadBody(event as any))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    loadFlexRunMock.mockReset()
    loadPlanSnapshotMock.mockReset()
    recordResumeAuditMock.mockReset()
    loadFlexRunDebugMock.mockReset()
    coordinatorRunMock.mockReset()
  })

  it('streams resume events when run resumes successfully', async () => {
    const runRecord = {
      runId: 'flex_resume_1',
      status: 'awaiting_hitl' as const,
      threadId: 'thread_1',
      envelope,
      schemaHash: null,
      metadata: { existing: true },
      result: { final: true },
      planVersion: 3,
      contextSnapshot: null,
      createdAt: new Date('2025-01-01T00:00:00Z'),
      updatedAt: new Date('2025-01-01T00:01:00Z')
    }

    persistenceMocks.loadFlexRunMock.mockResolvedValue({
      run: runRecord,
      nodes: []
    })
    persistenceMocks.loadPlanSnapshotMock.mockResolvedValue({
      runId: 'flex_resume_1',
      planVersion: 3,
      snapshot: { nodes: [], edges: [], metadata: {} },
      facets: null,
      schemaHash: null,
      pendingNodeIds: [],
      createdAt: null,
      updatedAt: null
    })
    persistenceMocks.recordResumeAuditMock.mockResolvedValue()

    coordinatorMocks.runMock.mockImplementation(async (_envelope, opts) => {
      await opts.onEvent({ type: 'log', message: 'resumed', runId: 'flex_resume_1' } as any)
      await opts.onEvent({ type: 'complete', payload: { output: { ok: true } }, runId: 'flex_resume_1' } as any)
      return { runId: 'flex_resume_1', status: 'completed', output: { ok: true } }
    })

    const { default: handler } = await import('../routes/api/v1/flex/run.resume.post')
    const request = makeSseRequest(handler as any)

    const res = await request({ runId: 'flex_resume_1', expectedPlanVersion: 3 })

    expect(persistenceMocks.loadFlexRunMock).toHaveBeenCalledWith('flex_resume_1')
    expect(res.status).toBe(200)
    expect(res.text).toContain('event: log')
    expect(res.text).toContain('event: complete')
    expect(persistenceMocks.recordResumeAuditMock).toHaveBeenCalledWith(runRecord, { operator: null, note: null })
    expect(coordinatorMocks.runMock).toHaveBeenCalled()
  })

  it('rejects stale plan versions before streaming', async () => {
    persistenceMocks.loadFlexRunMock.mockResolvedValue({
      run: {
        runId: 'flex_resume_2',
        status: 'awaiting_hitl',
        threadId: 'thread_2',
        envelope,
        schemaHash: null,
        metadata: null,
        result: null,
        planVersion: 2,
        contextSnapshot: null,
        createdAt: null,
        updatedAt: null
      },
      nodes: []
    })
    persistenceMocks.loadPlanSnapshotMock.mockResolvedValue({
      runId: 'flex_resume_2',
      planVersion: 2,
      snapshot: { nodes: [], metadata: {} },
      facets: null,
      schemaHash: null,
      pendingNodeIds: [],
      createdAt: null,
      updatedAt: null
    })
    persistenceMocks.recordResumeAuditMock.mockResolvedValue()

    const { default: handler } = await import('../routes/api/v1/flex/run.resume.post')
    const request = makeSseRequest(handler as any)

    const res = await request({ runId: 'flex_resume_2', expectedPlanVersion: 4 })

    expect(res.status).toBe(409)
    expect(res.text).toContain('stale_plan_version')
  })

  it('rejects runs that are not awaiting HITL', async () => {
    persistenceMocks.loadFlexRunMock.mockResolvedValue({
      run: {
        runId: 'flex_resume_3',
        status: 'completed',
        threadId: 'thread_3',
        envelope,
        schemaHash: null,
        metadata: null,
        result: null,
        planVersion: 1,
        contextSnapshot: null,
        createdAt: null,
        updatedAt: null
      },
      nodes: []
    })
    const { default: handler } = await import('../routes/api/v1/flex/run.resume.post')
    const request = makeSseRequest(handler as any)

    const res = await request({ runId: 'flex_resume_3' })

    expect(res.status).toBe(409)
    expect(res.text).toContain('invalid_run_state')
  })

  it('returns redacted debug payloads', async () => {
    const debugView = {
      run: {
        runId: 'flex_debug_1',
        status: 'completed' as const,
        envelope,
        threadId: 'thread_debug',
        objective: 'Inspect',
        schemaHash: 'hash-debug',
        metadata: { secretToken: 'abc', safe: 'ok' },
        result: { answer: true },
        planVersion: 2,
        contextSnapshot: { foo: { value: 'bar', secret: 'hidden' } },
        createdAt: new Date('2025-01-01T00:00:00Z'),
        updatedAt: new Date('2025-01-01T00:10:00Z')
      },
      nodes: [
        {
          nodeId: 'node_1',
          capabilityId: 'strategy',
          label: 'Strategy Node',
          status: 'completed',
          context: { input: 'value', secretKey: 'hide-me' },
          output: { data: 1 },
          error: null,
          facets: { input: ['a'], output: ['b'] },
          contracts: { output: { mode: 'json_schema', schema: {} } },
          provenance: null,
          metadata: { token: 'abc' },
          rationale: ['first pass'],
          startedAt: new Date('2025-01-01T00:00:00Z'),
          completedAt: new Date('2025-01-01T00:05:00Z')
        }
      ],
      snapshots: [
        {
          runId: 'flex_debug_1',
          planVersion: 1,
          snapshot: { nodes: [], metadata: { token: 'abc' } },
          facets: null,
          schemaHash: null,
          pendingNodeIds: [],
          createdAt: new Date('2025-01-01T00:00:00Z'),
          updatedAt: new Date('2025-01-01T00:01:00Z'),
          metadata: { token: 'abc' }
        },
        {
          runId: 'flex_debug_1',
          planVersion: 2,
          snapshot: { nodes: [], metadata: {} },
          facets: { foo: { value: 'bar', secret: 'hide' } },
          schemaHash: 'hash-debug',
          pendingNodeIds: ['node_pending'],
          createdAt: new Date('2025-01-01T00:02:00Z'),
          updatedAt: new Date('2025-01-01T00:03:00Z'),
          metadata: null
        }
      ],
      output: {
        runId: 'flex_debug_1',
        planVersion: 2,
        schemaHash: 'hash-debug',
        status: 'completed' as const,
        output: { token: 'secret', safe: 'value' },
        facets: { foo: { value: 'bar', secret: 'hide' } },
        provenance: { foo: { secret: 'hide' } },
        recordedAt: new Date('2025-01-01T00:04:00Z'),
        updatedAt: new Date('2025-01-01T00:05:00Z')
      }
    }

    persistenceMocks.loadFlexRunDebugMock.mockResolvedValue(debugView as any)

    const { default: handler } = await import('../routes/api/v1/flex/runs/[id].get')
    const request = makeJsonRequest(handler as any)
    const res = await request('flex_debug_1')

    expect(persistenceMocks.loadFlexRunDebugMock).toHaveBeenCalledWith('flex_debug_1')
    expect(res.status).toBe(200)
    expect(res.body?.run?.metadata?.secretToken).toBe('[redacted]')
    expect(res.body?.output?.facets?.foo?.secret).toBe('[redacted]')
    expect(res.body?.nodes?.[0]?.context?.secretKey).toBe('[redacted]')
    expect(Array.isArray(res.body?.planVersions)).toBe(true)
  })
})
