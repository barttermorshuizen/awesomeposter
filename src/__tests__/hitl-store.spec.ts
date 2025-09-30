import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useHitlStore } from '@/stores/hitl'
import { storeToRefs } from 'pinia'

const basePayload = {
  question: 'Need approval? ',
  kind: 'approval' as const,
  options: [],
  allowFreeForm: true,
  urgency: 'normal' as const
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
      threadId: 'thread-123'
    })

    const fetchMock = vi.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        runs: [
          {
            runId: 'run_abc',
            threadId: 'thread-123',
            pendingRequestId: 'req_1',
            pendingRequest: {
              id: 'req_1',
              createdAt: '2025-01-01T01:00:00.000Z',
              payload: {
                ...basePayload,
                question: 'Updated question'
              },
              originAgent: 'qa'
            }
          }
        ]
      })
    } as any)

    await store.hydrateFromPending()

    expect(fetchMock).toHaveBeenCalledWith('/api/hitl/pending', expect.any(Object))
    expect(pendingRun.value.runId).toBe('run_abc')
    expect(store.activeRequest?.createdAt?.toISOString()).toBe('2025-01-01T01:00:00.000Z')
    expect(store.activeRequest?.originAgent).toBe('qa')
    expect(store.activeRequest?.question).toBe('Updated question')
  })

  it('submits response payload to resume endpoint', async () => {
    const store = useHitlStore()
    const { pendingRun } = storeToRefs(store)
    store.startTrackingRequest({
      requestId: 'req_2',
      payload: {
        question: 'Pick option',
        kind: 'choice',
        options: [{ id: 'opt_a', label: 'A' }],
        allowFreeForm: false,
        urgency: 'normal'
      },
      originAgent: 'strategy',
      receivedAt: new Date('2025-02-01T00:00:00Z'),
      threadId: 'thread-456'
    })
    pendingRun.value.runId = 'run_xyz'

    const fetchMock = vi.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true })
    })

    await store.submitResponse({
      responseType: 'option',
      selectedOptionId: 'opt_a'
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
          responseType: 'option',
          approved: undefined,
          selectedOptionId: 'opt_a',
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
})
