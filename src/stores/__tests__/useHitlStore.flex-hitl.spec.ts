import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useHitlStore } from '@/stores/hitl'
import { storeToRefs } from 'pinia'

const basePayload = {
  question: 'Need approval? ',
  kind: 'approval' as const,
  allowFreeForm: true,
  urgency: 'normal' as const
}

const baseContractSummary = {
  nodeId: 'node_alpha',
  capabilityLabel: 'Strategy Manager',
  contract: {
    output: {
      mode: 'freeform' as const,
      instructions: 'Confirm approval outcome.'
    }
  },
  facets: {
    output: [
      {
        facet: 'copyVariants',
        title: 'Copy Variants',
        direction: 'output' as const,
        pointer: '/copyVariants'
      }
    ]
  }
}

describe('useHitlStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('hydrates metadata from pending endpoint', async () => {
    const store = useHitlStore()
    const { pendingRun } = storeToRefs(store)
    const receivedAt = new Date('2025-01-01T00:00:00Z')

    store.startTrackingRequest({
      requestId: 'req_1',
      payload: basePayload,
      originAgent: 'strategy',
      receivedAt,
      threadId: 'thread-123',
      pendingNodeId: 'node_alpha',
      operatorPrompt: 'Initial prompt',
      contractSummary: baseContractSummary
    })

    const fetchMock = vi.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        runs: [
          {
            runId: 'run_abc',
            threadId: 'thread-123',
            briefId: 'brief-789',
            pendingRequestId: 'req_1',
            status: 'awaiting_hitl',
            updatedAt: '2025-01-01T01:30:00.000Z',
            pendingRequest: {
              id: 'req_1',
              createdAt: '2025-01-01T01:00:00.000Z',
              payload: {
                ...basePayload,
                question: 'Updated question'
              },
              originAgent: 'qa',
              pendingNodeId: 'node_pending',
              operatorPrompt: 'Review node details before approving.',
              contractSummary: {
                nodeId: 'node_pending',
                capabilityLabel: 'Quality Assurance',
                planVersion: 3,
                contract: {
                  output: {
                    mode: 'json_schema',
                    schema: {
                      type: 'object',
                      properties: {
                        qaFindings: { type: 'array' }
                      }
                    }
                  }
                },
                facets: {
                  output: [
                    {
                      facet: 'qaFindings',
                      title: 'QA Findings',
                      direction: 'output',
                      pointer: '/qaFindings'
                    }
                  ]
                }
              }
            }
          }
        ]
      })
    } as any)

    await store.hydrateFromPending()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toMatch(/\/api\/hitl\/pending$/)
    expect(pendingRun.value.runId).toBe('run_abc')
    expect(pendingRun.value.threadId).toBe('thread-123')
    expect(pendingRun.value.briefId).toBe('brief-789')
    expect(pendingRun.value.status).toBe('awaiting_hitl')
    expect(pendingRun.value.isSuspended).toBe(true)
    expect(store.isPendingForBrief('brief-789')).toBe(true)
    expect(store.isPendingForBrief('thread-123')).toBe(true)
    expect(store.isPendingForBrief('brief-other')).toBe(false)
    expect(store.activeRequest?.createdAt?.toISOString()).toBe('2025-01-01T01:00:00.000Z')
    expect(store.activeRequest?.originAgent).toBe('qa')
    expect(store.activeRequest?.question).toBe('Updated question')
    expect(store.activeRequest?.pendingNodeId).toBe('node_pending')
    expect(store.activeRequest?.operatorPrompt).toBe('Review node details before approving.')
    expect(store.activeRequest?.contractSummary?.nodeId).toBe('node_pending')
    expect(store.activeRequest?.contractSummary?.planVersion).toBe(3)
  })

  it('submits response payload to resume endpoint', async () => {
    const store = useHitlStore()
    const { pendingRun } = storeToRefs(store)
    store.startTrackingRequest({
      requestId: 'req_2',
      payload: {
        question: 'Approve draft?',
        kind: 'approval',
        allowFreeForm: false,
        urgency: 'normal'
      },
      originAgent: 'strategy',
      receivedAt: new Date('2025-02-01T00:00:00Z'),
      threadId: 'thread-456',
      pendingNodeId: null,
      operatorPrompt: null,
      contractSummary: null
    })
    pendingRun.value.runId = 'run_xyz'

    const fetchMock = vi.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true })
    })

    await store.submitResponse({
      responseType: 'approval',
      approved: true
    })

    expect(fetchMock).toHaveBeenCalled()
    const [, requestInit] = fetchMock.mock.calls[0]
    expect(fetchMock.mock.calls[0][0]).toBe('/api/hitl/resume')
    expect(JSON.parse((requestInit as RequestInit).body as string)).toEqual({
      requestId: 'req_2',
      runId: 'run_xyz',
      threadId: 'thread-456',
      responses: [
        {
          requestId: 'req_2',
          responseType: 'approval',
          approved: true,
          selectedOptionId: undefined,
          freeformText: undefined,
          metadata: undefined,
          responderId: undefined,
          responderDisplayName: undefined
        }
      ]
    })
    expect(store.submissionState).toBe('success')
    expect(store.submissionNotice).toContain('Response submitted')
  })

  it('forces hydrate with thread identifier when no pending data cached', async () => {
    const store = useHitlStore()
    const { pendingRun } = storeToRefs(store)

    const fetchMock = vi.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        runs: [
          {
            runId: 'run_force',
            threadId: 'thread-force',
            pendingRequestId: 'req_force',
            status: 'awaiting_hitl'
          }
        ]
      })
    } as any)

    await store.hydrateFromPending({ threadId: 'thread-force', force: true })

    expect(fetchMock).toHaveBeenCalled()
    expect(pendingRun.value.runId).toBe('run_force')
    expect(pendingRun.value.threadId).toBe('thread-force')
    expect(pendingRun.value.pendingRequestId).toBe('req_force')
    expect(pendingRun.value.isSuspended).toBe(true)
  })

  it('removes a pending run with operator metadata', async () => {
    const store = useHitlStore()
    const { pendingRun } = storeToRefs(store)
    store.setThreadId('thread-remove')
    store.setBriefId('brief-remove')
    store.setRunId('run-remove')
    store.startTrackingRequest({
      requestId: 'req-remove',
      payload: basePayload,
      originAgent: 'strategy',
      receivedAt: new Date('2025-04-01T00:00:00Z'),
      threadId: 'thread-remove'
    })
    store.setOperatorProfile({ id: 'op-1', displayName: 'Operator One', email: 'op@example.com' })

    const fetchMock = vi.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true })
    })

    await store.removePendingRun({ reason: 'Stale run after restart', note: 'Cleared during QA' })

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/hitl/remove', expect.objectContaining({
      method: 'POST'
    }))
    const requestInit = fetchMock.mock.calls[0][1] as RequestInit
    const parsed = JSON.parse(requestInit.body as string)
    expect(parsed).toEqual({
      runId: 'run-remove',
      threadId: 'thread-remove',
      requestId: 'req-remove',
      reason: 'Stale run after restart',
      note: 'Cleared during QA',
      operator: {
        id: 'op-1',
        displayName: 'Operator One',
        email: 'op@example.com'
      }
    })
    expect(pendingRun.value.pendingRequestId).toBeNull()
  })

  it('matches pending runs by assigned brief id or thread id', () => {
    const store = useHitlStore()
    store.setThreadId('thread-alpha')
    store.setBriefId('brief-alpha')
    const { pendingRun } = storeToRefs(store)
    pendingRun.value.isSuspended = true
    pendingRun.value.pendingRequestId = 'req-alpha'

    expect(store.isPendingForBrief('thread-alpha')).toBe(true)
    expect(store.isPendingForBrief('brief-alpha')).toBe(true)

    pendingRun.value.isSuspended = false
    pendingRun.value.pendingRequestId = null

    expect(store.isPendingForBrief('thread-alpha')).toBe(false)
    expect(store.isPendingForBrief('brief-beta')).toBe(false)
    expect(store.isPendingForBrief(null)).toBe(false)
  })

  it('preserves submitted state when hydrating same request after success', async () => {
    const store = useHitlStore()
    store.startTrackingRequest({
      requestId: 'req_keep',
      payload: basePayload,
      originAgent: 'strategy',
      receivedAt: new Date('2025-05-01T00:00:00Z'),
      threadId: 'thread-keep'
    })

    store.submissionState = 'success'
    store.submissionNotice = 'Response submitted. Waiting for orchestrator to resume.'
    store.activeRequest!.status = 'submitted'

    vi.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        runs: [
          {
            runId: 'run-keep',
            threadId: 'thread-keep',
            pendingRequestId: 'req_keep',
            status: 'awaiting_hitl',
            pendingRequest: {
              id: 'req_keep',
              payload: basePayload,
              originAgent: 'strategy'
            }
          }
        ]
      })
    } as any)

    await store.hydrateFromPending({ threadId: 'thread-keep', force: true })

    expect(store.submissionState).toBe('success')
    expect(store.submissionNotice).toContain('Response submitted')
    expect(store.activeRequest?.status).toBe('submitted')
  })
})
