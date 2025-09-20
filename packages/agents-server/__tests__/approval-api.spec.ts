// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { createError } from 'h3'
import { resetApprovalStore, getApprovalStore } from '../src/services/approval-store'

;(globalThis as any).defineEventHandler = (fn: any) => fn
;(globalThis as any).createError = createError

describe('approval API routes', () => {
  beforeEach(() => {
    resetApprovalStore()
  })

  it('updates approval decision via POST', async () => {
    const store = getApprovalStore()
    store.create({
      checkpointId: 'cp_1',
      threadId: 'thread_1',
      reason: 'Needs review',
      requestedBy: 'QA',
      requestedAt: new Date().toISOString(),
      requiredRoles: [],
      evidenceRefs: [],
      status: 'waiting',
      advisory: {
        severity: 'warn',
        reason: 'Manual review',
        evidenceRefs: []
      }
    } as any)

    const mod = await import('../routes/api/v1/orchestrator/approval.post')
    const handler = mod.default as (e: any) => Promise<any>

    const res = await handler({
      context: {
        body: {
          checkpointId: 'cp_1',
          status: 'approved',
          decidedBy: 'reviewer',
          decisionNotes: 'Looks good'
        }
      }
    })

    expect(res).toEqual({ ok: true, checkpointId: 'cp_1', status: 'approved' })
    expect(store.get('cp_1')?.status).toBe('approved')
    expect(store.get('cp_1')?.decidedBy).toBe('reviewer')
  })

  it('returns pending approvals via GET', async () => {
    const store = getApprovalStore()
    store.create({
      checkpointId: 'cp_a',
      threadId: 'thread_list',
      reason: 'Manual review',
      requestedBy: 'QA',
      requestedAt: new Date().toISOString(),
      requiredRoles: [],
      evidenceRefs: [],
      status: 'waiting',
      advisory: {
        severity: 'warn',
        reason: 'Manual review',
        evidenceRefs: []
      }
    } as any)

    const mod = await import('../routes/api/v1/orchestrator/approvals.get')
    const handler = mod.default as (e: any) => any

    const res = handler({
      context: { query: { threadId: 'thread_list' } },
      node: { req: { url: '/dummy' } }
    })

    expect(Array.isArray(res.pending)).toBe(true)
    expect(res.pending[0]?.checkpointId).toBe('cp_a')
  })
})
