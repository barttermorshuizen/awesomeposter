// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

vi.mock('@awesomeposter/db', () => {
  const column = (name: string) => ({ name })
  return {
    flexRunOutputs: { runId: column('run_id'), planVersion: column('plan_version'), schemaHash: column('schema_hash'), status: column('status'), outputJson: column('output_json'), facetSnapshotJson: column('facet_snapshot_json'), provenanceJson: column('provenance_json'), recordedAt: column('recorded_at'), updatedAt: column('updated_at') },
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
