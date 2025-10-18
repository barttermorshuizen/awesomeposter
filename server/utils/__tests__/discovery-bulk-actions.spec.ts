import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class DiscoveryItemNotFoundError extends Error {}
class DiscoveryItemAlreadyPromotedError extends Error {}
class DiscoveryItemAlreadyArchivedError extends Error {}

const insertCalls: any[] = []
const onConflictCalls: any[] = []

vi.mock('../discovery-repository', () => ({
  promoteDiscoveryItem: vi.fn(),
  archiveDiscoveryItem: vi.fn(),
  DiscoveryItemNotFoundError,
  DiscoveryItemAlreadyPromotedError,
  DiscoveryItemAlreadyArchivedError,
}))

let emitDiscoveryEventMock: ReturnType<typeof vi.fn>

vi.mock('../discovery-events', () => {
  emitDiscoveryEventMock = vi.fn()
  return { emitDiscoveryEvent: emitDiscoveryEventMock }
})

vi.mock('@awesomeposter/db', () => ({
  getDb: () => ({
    insert: () => ({
      values: (payload: unknown) => {
        insertCalls.push(payload)
        return {
          onConflictDoUpdate: (args: unknown) => {
            onConflictCalls.push(args)
            return Promise.resolve()
          },
        }
      },
    }),
  }),
  discoveryBulkActionAudits: {
    actionId: 'action_id',
  },
}))

const { executeDiscoveryBulkAction } = await import('../discovery-bulk-actions')
const repository = await import('../discovery-repository')

const promoteDiscoveryItemMock = vi.mocked(repository.promoteDiscoveryItem)
const archiveDiscoveryItemMock = vi.mocked(repository.archiveDiscoveryItem)

describe('executeDiscoveryBulkAction', () => {
  beforeEach(() => {
    promoteDiscoveryItemMock.mockReset()
    archiveDiscoveryItemMock.mockReset()
    insertCalls.length = 0
    onConflictCalls.length = 0
    vi.spyOn(performance, 'now').mockImplementationOnce(() => 0).mockImplementationOnce(() => 42)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('records audit details, emits telemetry, and returns per-item statuses', async () => {
    const briefDetail = {
      briefRef: {
        briefId: 'brief-1',
        editUrl: '/briefs/brief-1/edit',
      },
    }

    promoteDiscoveryItemMock
      .mockResolvedValueOnce(briefDetail)
      .mockRejectedValueOnce(new DiscoveryItemAlreadyPromotedError('Already promoted elsewhere'))
      .mockRejectedValueOnce(new Error('Unexpected failure'))

    const request = {
      actionId: '11111111-1111-1111-1111-111111111111',
      clientId: '22222222-2222-2222-2222-222222222222',
      itemIds: [
        'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
        'aaaaaaa2-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
        'aaaaaaa3-aaaa-aaaa-aaaa-aaaaaaaaaaa3',
      ],
      note: 'Ready for review',
      actorId: '33333333-3333-3333-3333-333333333333',
      filtersSnapshot: {
        status: ['spotted'],
        sourceIds: [],
        topicIds: [],
        search: '',
        dateFrom: null,
        dateTo: null,
        pageSize: 25,
      },
    } as const

    const response = await executeDiscoveryBulkAction('promote', request)

    expect(promoteDiscoveryItemMock).toHaveBeenCalledTimes(3)
    expect(response.summary).toEqual({
      success: 1,
      conflict: 1,
      failed: 1,
      durationMs: 42,
    })

    expect(response.results).toEqual([
      {
        itemId: request.itemIds[0],
        status: 'success',
        message: null,
        briefId: 'brief-1',
      },
      {
        itemId: request.itemIds[1],
        status: 'conflict',
        message: 'Already promoted elsewhere',
        briefId: null,
      },
      {
        itemId: request.itemIds[2],
        status: 'failed',
        message: 'Unexpected failure',
        briefId: null,
      },
    ])

    expect(insertCalls).toHaveLength(1)
    const auditPayload = insertCalls[0]
    expect(auditPayload).toMatchObject({
      actionId: request.actionId,
      clientId: request.clientId,
      actorId: request.actorId,
      action: 'promote',
      note: request.note,
      itemIds: request.itemIds,
      successIds: [request.itemIds[0]],
      conflictIds: [request.itemIds[1]],
      failedIds: [request.itemIds[2]],
      successBriefIds: ['brief-1'],
      successCount: 1,
      conflictCount: 1,
      failedCount: 1,
      totalCount: request.itemIds.length,
      durationMs: 42,
    })
    expect(Array.isArray(auditPayload.resultsJson)).toBe(true)
    expect(auditPayload.resultsJson).toEqual([
      { itemId: request.itemIds[0], status: 'success', message: null, briefId: 'brief-1' },
      { itemId: request.itemIds[1], status: 'conflict', message: 'Already promoted elsewhere', briefId: null },
      { itemId: request.itemIds[2], status: 'failed', message: 'Unexpected failure', briefId: null },
    ])

    expect(onConflictCalls).toHaveLength(1)

    expect(emitDiscoveryEventMock).toHaveBeenCalledWith({
      type: 'discovery.bulk.action.completed',
      version: 1,
      payload: expect.objectContaining({
        actionId: request.actionId,
        clientId: request.clientId,
        successCount: 1,
        conflictCount: 1,
        failedCount: 1,
        durationMs: 42,
        results: [
          { itemId: request.itemIds[0], status: 'success', message: null, briefId: 'brief-1' },
          { itemId: request.itemIds[1], status: 'conflict', message: 'Already promoted elsewhere', briefId: null },
          { itemId: request.itemIds[2], status: 'failed', message: 'Unexpected failure', briefId: null },
        ],
      }),
    })
  })
})
