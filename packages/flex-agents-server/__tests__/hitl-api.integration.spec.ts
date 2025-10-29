// @vitest-environment node
import { describe, beforeEach, afterEach, afterAll, it, expect, vi } from 'vitest'
import { createApp, eventHandler, readBody as h3ReadBody, toNodeListener } from 'h3'
import { fetchNodeRequestHandler } from 'node-mock-http'
import { InMemoryOrchestratorPersistence, setOrchestratorPersistence } from '../src/services/orchestrator-persistence'
import { InMemoryHitlRepository, setHitlRepository, resetHitlRepository } from '../src/services/hitl-repository'
import { HitlService, resetHitlService } from '../src/services/hitl-service'
import { withHitlContext } from '../src/services/hitl-context'

const basePayload = {
  question: 'Need operator response?',
  kind: 'clarify',
  allowFreeForm: true,
  urgency: 'normal'
}

describe('HITL resume/remove API integration', () => {
  vi.stubGlobal('defineEventHandler', (fn: any) => eventHandler(fn))
  vi.stubGlobal('readBody', (event: any) => h3ReadBody(event as any))

  let persistence: InMemoryOrchestratorPersistence
  let repository: InMemoryHitlRepository
  let hitlService: HitlService

  beforeEach(() => {
    persistence = new InMemoryOrchestratorPersistence()
    setOrchestratorPersistence(persistence as any)
    repository = new InMemoryHitlRepository()
    setHitlRepository(repository)
    resetHitlService()
    hitlService = new HitlService(repository)
    process.env.API_KEY = 'test-key'
  })

  afterEach(() => {
    process.env.API_KEY = ''
    resetHitlService()
    resetHitlRepository()
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('resumes and removes pending HITL requests via API handlers', async () => {
    const { default: resumeHandler } = await import('../../../server/api/hitl/resume.post.ts')
    const { default: removeHandler } = await import('../../../server/api/hitl/remove.post.ts')
    const { default: pendingHandler } = await import('../../../server/api/hitl/pending.get.ts')

    const app = createApp()
    app.use('/api/hitl/resume', resumeHandler as any)
    app.use('/api/hitl/remove', removeHandler as any)
    app.use('/api/hitl/pending', pendingHandler as any)

    const nodeListener = toNodeListener(app)
    const appFetch = async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
      const method = init.method ?? 'GET'
      const headers = init.headers ?? {}
      const body = init.body
      const response = await fetchNodeRequestHandler(nodeListener, url, { method, headers, body })
      return {
        status: response.status,
        json: async () => {
          const text = await response.text()
          if (!text) return null
          try { return JSON.parse(text) } catch { return text }
        }
      }
    }

    const runId = 'run_hitl_api'
    const threadId = 'thread_hitl_api'

    let snapshot = await hitlService.loadRunState(runId)
    const limit = { current: 0, max: 3 }

    await withHitlContext(
      {
        runId,
        threadId,
        stepId: 'strategy_1',
        capabilityId: 'strategy',
        hitlService,
        limit,
        onRequest: () => {},
        onDenied: () => {},
        snapshot
      },
      async () => {
        await hitlService.raiseRequest(basePayload)
      }
    )
    snapshot = await hitlService.loadRunState(runId)
    await persistence.save(runId, {
      threadId,
      hitlState: snapshot,
      pendingRequestId: snapshot.pendingRequestId ?? null,
      status: 'awaiting_hitl'
    })
    const pendingId = snapshot.pendingRequestId!

    const pendingRes = await appFetch('http://test.local/api/hitl/pending', {
      headers: { authorization: 'Bearer test-key', accept: 'application/json' }
    })
    expect(pendingRes.status).toBe(200)
    const pendingData = await pendingRes.json()
    expect(pendingData?.ok).toBe(true)
    expect(pendingData.runs).toHaveLength(1)
    expect(pendingData.runs[0].pendingRequestId).toBe(pendingId)

    const resumeRes = await appFetch('http://test.local/api/hitl/resume', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-key',
        'Content-Type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify({
        runId,
        requestId: pendingId,
        responses: [
          {
            requestId: pendingId,
            responseType: 'approval',
            approved: true,
            responderId: 'operator-1',
            responderDisplayName: 'Operator 1'
          }
        ],
        operator: { id: 'operator-1', displayName: 'Operator 1' },
        note: 'Approved'
      })
    })
    const resumeData = await resumeRes.json()
    expect(resumeData.ok).toBe(true)
    expect(resumeData.pendingRequestId).toBeNull()

    // Raise another request to test removal
    snapshot = await hitlService.loadRunState(runId)
    await withHitlContext(
      {
        runId,
        threadId,
        stepId: 'strategy_2',
        capabilityId: 'strategy',
        hitlService,
        limit,
        onRequest: () => {},
        onDenied: () => {},
        snapshot
      },
      async () => {
        await hitlService.raiseRequest(basePayload)
      }
    )
    snapshot = await hitlService.loadRunState(runId)
    await persistence.save(runId, {
      threadId,
      hitlState: snapshot,
      pendingRequestId: snapshot.pendingRequestId ?? null,
      status: 'awaiting_hitl'
    })
    const removalId = snapshot.pendingRequestId!

    const removeRes = await appFetch('http://test.local/api/hitl/remove', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-key',
        'Content-Type': 'application/json',
        accept: 'application/json'
      },
      body: JSON.stringify({
        runId,
        requestId: removalId,
        reason: 'Cancelled by operator',
        operator: { id: 'operator-1', displayName: 'Operator 1' },
        note: 'No longer needed'
      })
    })
    const removeData = await removeRes.json()
    expect(removeData.ok).toBe(true)
    expect(removeData.status).toBe('cancelled')
    expect(removeData.pendingRequestId).toBeNull()
  })
})
