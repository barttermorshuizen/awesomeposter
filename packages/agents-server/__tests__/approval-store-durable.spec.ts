// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const durableRecords = new Map<string, any>()
const controls = { throwOnImport: false }

vi.mock('@awesomeposter/db', () => {
  const table = {
    checkpointId: 'checkpointId',
    threadId: 'threadId',
    payloadJson: 'payloadJson',
    status: 'status',
    requestedAt: 'requestedAt',
    decidedAt: 'decidedAt',
    decidedBy: 'decidedBy',
    decisionNotes: 'decisionNotes',
    updatedAt: 'updatedAt'
  }
  const eq = (column: string, value: any) => ({ column, value })

  const db = {
    select() {
      return {
        from(_table: any) {
          const data = Array.from(durableRecords.values())
          const result: any = {
            where(cond: any) {
              const filtered = cond
                ? data.filter((row: any) => row[cond.column] === cond.value)
                : data
              return {
                limit(n: number) {
                  return Promise.resolve(filtered.slice(0, n))
                }
              }
            },
            then(resolve: any) {
              return Promise.resolve(data).then(resolve)
            }
          }
          return result
        }
      }
    },
    insert(_table: any) {
      return {
        values(row: any) {
          return {
            async onConflictDoUpdate({ set }: { set: any }) {
              const existing = durableRecords.get(row.checkpointId)
              if (!existing) {
                durableRecords.set(row.checkpointId, { ...row })
              } else {
                durableRecords.set(row.checkpointId, { ...existing, ...row, ...set })
              }
            }
          }
        }
      }
    },
    delete(_table: any) {
      return {
        async where() {
          durableRecords.clear()
        }
      }
    }
  }

  return {
    getDb: () => {
      if (controls.throwOnImport) throw new Error('db unavailable')
      return db
    },
    approvalCheckpoints: table,
    eq,
    __records: durableRecords,
    __controls: controls
  }
})

import { getApprovalStore, resetApprovalStore } from '../src/services/approval-store'

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('durable approval store', () => {
  beforeEach(() => {
    durableRecords.clear()
    controls.throwOnImport = false
    process.env.ENABLE_HITL_APPROVALS_DURABLE = 'true'
    resetApprovalStore()
  })

  it('persists approvals to the durable backend', async () => {
    const store = getApprovalStore()
    store.create({
      checkpointId: 'cp_durable',
      threadId: 'thread_durable',
      reason: 'Needs review',
      requestedBy: 'QA',
      requestedAt: new Date().toISOString(),
      requiredRoles: [],
      evidenceRefs: [],
      status: 'waiting',
      advisory: { severity: 'warn', reason: 'Manual review', evidenceRefs: [] }
    } as any)

    await flushAsync()
    expect(durableRecords.has('cp_durable')).toBe(true)

    const listed = store.listByThread('thread_durable')
    expect(listed).toHaveLength(1)
    expect(listed[0]?.checkpointId).toBe('cp_durable')

    store.resolve('cp_durable', { status: 'approved', decidedBy: 'reviewer', decisionNotes: 'ok' })
    await flushAsync()

    const row = durableRecords.get('cp_durable')
    expect(row.status).toBe('approved')
    expect(row.decidedBy).toBe('reviewer')
  })

  it('falls back to in-memory when durable init fails', async () => {
    controls.throwOnImport = true
    resetApprovalStore()

    const store = getApprovalStore()
    store.create({
      checkpointId: 'cp_memory',
      threadId: 'thread_memory',
      reason: 'Fallback review',
      requestedBy: 'QA',
      requestedAt: new Date().toISOString(),
      requiredRoles: [],
      evidenceRefs: [],
      status: 'waiting',
      advisory: { severity: 'warn', reason: 'Manual', evidenceRefs: [] }
    } as any)

    await flushAsync()
    expect(durableRecords.has('cp_memory')).toBe(false)
    const listed = store.listByThread('thread_memory')
    expect(listed).toHaveLength(1)
  })
})
