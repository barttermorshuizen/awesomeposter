// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { getHitlService } from '../src/services/hitl-service'
import { withHitlContext } from '../src/services/hitl-context'
import { resetHitlRepository } from '../src/services/hitl-repository'

const basePayload = {
  question: 'Need a human decision?',
  kind: 'question',
  options: [],
  allowFreeForm: true,
  urgency: 'normal'
} as const

describe('HitlService', () => {
  beforeEach(() => {
    resetHitlRepository()
  })

  it('creates HITL requests up to the configured limit and then denies with reason', async () => {
    const service = getHitlService()
    const runId = 'run_hitl_service'
    let snapshot = await service.loadRunState(runId)
    const limit = { current: 0, max: 3 }
    const onRequest = vi.fn((_, state) => {
      snapshot = state
      limit.current = state.requests.filter((r) => r.status !== 'denied').length
    })
    const onDenied = vi.fn((_, state) => {
      snapshot = state
      limit.current = state.requests.filter((r) => r.status !== 'denied').length
    })

    const raise = async () => {
      let result: any
      await withHitlContext(
        {
          runId,
          threadId: 'thread-hitl',
          stepId: 'strategy_1',
          capabilityId: 'strategy',
          hitlService: service,
          limit,
          onRequest,
          onDenied,
          snapshot
        },
        async () => {
          result = await service.raiseRequest({ ...basePayload })
        }
      )
      snapshot = await service.loadRunState(runId)
      limit.current = snapshot.requests.filter((r) => r.status !== 'denied').length
      return result
    }

    const first = await raise()
    expect(first.status).toBe('pending')
    expect(onRequest).toHaveBeenCalledTimes(1)

    const second = await raise()
    expect(second.status).toBe('pending')

    const third = await raise()
    expect(third.status).toBe('pending')

    const fourth = await raise()
    expect(fourth.status).toBe('denied')
    expect(fourth.reason).toBe('Too many HITL requests')
    expect(onDenied).toHaveBeenCalledWith('Too many HITL requests', expect.any(Object))

    const state = await service.loadRunState(runId)
    expect(state.requests).toHaveLength(4)
    const denied = state.requests.filter((r) => r.status === 'denied')
    expect(denied).toHaveLength(1)
    expect(state.deniedCount).toBe(1)
  })

  it('persists pending node metadata and operator guidance on HITL requests', async () => {
    const service = getHitlService()
    const runId = 'run_hitl_metadata'
    let snapshot = await service.loadRunState(runId)
    const metadata = {
      pendingNodeId: 'node_42',
      operatorPrompt: 'Review node_42 output before resuming.',
      contractSummary: {
        nodeId: 'node_42',
        capabilityLabel: 'Strategy Manager',
        planVersion: 7,
        contract: {
          output: {
            mode: 'freeform',
            instructions: 'Confirm the generated brief is complete.'
          }
        },
        facets: {
          output: [
            {
              facet: 'writerBrief',
              title: 'Writer Brief',
              direction: 'output',
              pointer: '/writerBrief'
            }
          ]
        }
      }
    }

    await withHitlContext(
      {
        runId,
        threadId: 'thread-hitl',
        stepId: 'strategy_1',
        capabilityId: 'strategy',
        hitlService: service,
        limit: { current: 0, max: 5 },
        onRequest: () => {},
        onDenied: () => {},
        snapshot
      },
      async () => {
        await service.raiseRequest({ ...basePayload }, metadata)
      }
    )

    const state = await service.loadRunState(runId)
    expect(state.requests).toHaveLength(1)
    const [record] = state.requests
    expect(record.pendingNodeId).toBe('node_42')
    expect(record.operatorPrompt).toBe('Review node_42 output before resuming.')
    expect(record.contractSummary?.nodeId).toBe('node_42')
    expect(record.contractSummary?.planVersion).toBe(7)
    expect(record.contractSummary?.contract?.output?.mode).toBe('freeform')
    expect(record.contractSummary?.facets?.output?.[0]?.facet).toBe('writerBrief')
  })
})
