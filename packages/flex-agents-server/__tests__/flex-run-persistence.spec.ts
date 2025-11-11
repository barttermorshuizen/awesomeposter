// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

vi.mock('@awesomeposter/db', () => {
  const column = (name: string) => ({ name })
  return {
    flexRunOutputs: {
      runId: column('run_id'),
      planVersion: column('plan_version'),
      schemaHash: column('schema_hash'),
      status: column('status'),
      outputJson: column('output_json'),
      facetSnapshotJson: column('facet_snapshot_json'),
      provenanceJson: column('provenance_json'),
      goalConditionResultsJson: column('goal_condition_results_json'),
      recordedAt: column('recorded_at'),
      updatedAt: column('updated_at')
    },
    flexPlanSnapshots: {
      runId: column('run_id'),
      planVersion: column('plan_version'),
      snapshotJson: column('snapshot_json'),
      facetSnapshotJson: column('facet_snapshot_json'),
      schemaHash: column('schema_hash'),
      pendingNodeIds: column('pending_node_ids'),
      createdAt: column('created_at'),
      updatedAt: column('updated_at')
    },
    flexRuns: {},
    flexPlanNodes: {},
    orchestratorRuns: {},
    eq: (column: unknown, value: unknown) => ({ column, value }),
    and: (...conditions: unknown[]) => ({ conditions }),
    desc: (column: unknown) => column,
    sql: (...args: unknown[]) => ({ sql: args }),
    notInArray: (...args: unknown[]) => ({ notInArray: args }),
    isNotNull: (...args: unknown[]) => ({ isNotNull: args }),
    getDb: vi.fn()
  }
})

import { FlexRunPersistence } from '../src/services/orchestrator-persistence'

function createExecutorStub() {
  const executor: any = {}
  executor.update = vi.fn(() => executor)
  executor.set = vi.fn(() => executor)
  executor.where = vi.fn(() => executor)
  executor.delete = vi.fn(() => executor)
  executor.insert = vi.fn((table: unknown) => {
    executor.__lastInsertTarget = table
    return executor
  })
  executor.values = vi.fn(() => executor)
  executor.onConflictDoUpdate = vi.fn(() => executor)
  executor.transaction = vi.fn(async (cb: (tx: any) => Promise<void>) => {
    await cb(executor)
  })
  return executor
}

function createSelectStub(rows: any[]) {
  const chain: any = {}
  chain.from = vi.fn(() => chain)
  chain.where = vi.fn(() => chain)
  chain.orderBy = vi.fn(() => chain)
  chain.limit = vi.fn(() => Promise.resolve(rows))
  return chain
}

describe('FlexRunPersistence read helpers', () => {
  it('loadRunOutput returns structured payload with provenance', async () => {
    const row = {
      runId: 'run_1',
      planVersion: 2,
      schemaHash: 'abc123def4567890',
      status: 'completed',
      outputJson: { result: true },
      facetSnapshotJson: {
        copyVariants: {
          value: [{ headline: 'A', body: 'B', callToAction: 'C' }],
          updatedAt: '2025-04-01T12:00:00.000Z',
          provenance: [{ nodeId: 'content_1', capabilityId: 'content', rationale: ['test'], timestamp: '2025-04-01T12:00:00.000Z' }]
        }
      },
      provenanceJson: { copyVariants: [{ nodeId: 'content_1' }] },
      goalConditionResultsJson: [
        { facet: 'post_copy', path: '/', expression: 'status == "ready"', satisfied: true }
      ],
      recordedAt: new Date('2025-04-01T12:05:00.000Z'),
      updatedAt: new Date('2025-04-01T12:05:01.000Z')
    }
    const selectStub = createSelectStub([row])
    const fakeDb = {
      select: vi.fn(() => selectStub)
    }
    const fakeOrchestrator = { ensure: vi.fn(), save: vi.fn(), touch: vi.fn() }
    const persistence = new FlexRunPersistence(fakeDb as any, fakeOrchestrator as any)

    const output = await persistence.loadRunOutput('run_1')
    expect(output).toEqual({
      runId: 'run_1',
      planVersion: 2,
      schemaHash: 'abc123def4567890',
      status: 'completed',
      output: { result: true },
      facets: row.facetSnapshotJson,
      provenance: row.provenanceJson,
      goalConditionResults: row.goalConditionResultsJson,
      recordedAt: row.recordedAt,
      updatedAt: row.updatedAt
    })
    expect(fakeDb.select).toHaveBeenCalled()
  })

  it('loadPlanSnapshot returns latest snapshot metadata when version omitted', async () => {
    const snapshotRow = {
      runId: 'run_2',
      planVersion: 3,
      snapshotJson: { nodes: [{ nodeId: 'n1', status: 'completed' }] },
      facetSnapshotJson: { foo: { value: 'bar', provenance: [] } },
      schemaHash: 'ffffeeee11112222',
      pendingNodeIds: ['n3'],
      createdAt: new Date('2025-04-01T13:00:00.000Z'),
      updatedAt: new Date('2025-04-01T13:00:30.000Z')
    }
    const selectStub = createSelectStub([snapshotRow])
    const fakeDb = {
      select: vi.fn(() => selectStub)
    }
    const fakeOrchestrator = { ensure: vi.fn(), save: vi.fn(), touch: vi.fn() }
    const persistence = new FlexRunPersistence(fakeDb as any, fakeOrchestrator as any)

    const snapshot = await persistence.loadPlanSnapshot('run_2')
    expect(snapshot).toEqual({
      runId: 'run_2',
      planVersion: 3,
      snapshot: snapshotRow.snapshotJson,
      facets: snapshotRow.facetSnapshotJson,
      schemaHash: 'ffffeeee11112222',
      pendingNodeIds: ['n3'],
      createdAt: snapshotRow.createdAt,
      updatedAt: snapshotRow.updatedAt
    })
    expect(fakeDb.select).toHaveBeenCalledTimes(1)
  })
})

describe('FlexRunPersistence save helpers', () => {
  it('persists conditional node metadata inside plan snapshots', async () => {
    const executor = createExecutorStub()
    const fakeOrchestrator = { ensure: vi.fn(), save: vi.fn(), touch: vi.fn() }
    const persistence = new FlexRunPersistence(executor as any, fakeOrchestrator as any)

    await persistence.savePlanSnapshot(
      'run-conditional',
      1,
      [
        {
          nodeId: 'conditional_1',
          status: 'pending',
          conditional: {
            branches: [
              {
                predicate: {
                  dsl: 'facets.objectiveBrief != null',
                  jsonLogic: { '!!': [{ var: 'facets.objectiveBrief' }] }
                },
                next: 'writer_node'
              }
            ],
            fallback: {
              kind: 'action',
              action: { type: 'exit', reason: 'resume planner' }
            }
          }
        } as any
      ]
    )

    const valuesCalls = ((executor as any).values.mock.calls ?? []) as Array<[any]>
    const snapshotPayload =
      valuesCalls.length > 0 ? valuesCalls[valuesCalls.length - 1][0] : undefined
    expect(snapshotPayload?.snapshotJson).toBeTruthy()
    const node = snapshotPayload?.snapshotJson.nodes[0]
    expect(node?.nodeId).toBe('conditional_1')
    expect(node?.status).toBe('pending')
    expect(snapshotPayload?.pendingNodeIds).toContain('conditional_1')

  })
})
