import { describe, expect, it } from 'vitest'
import {
  ApprovalAdvisorySchema,
  ApprovalDecisionStatusEnum,
  PendingApprovalSchema,
} from './agent-run.js'

describe('approval advisory schema', () => {
  it('serializes and deserializes advisories with optional fields', () => {
    const advisory = ApprovalAdvisorySchema.parse({
      severity: 'warn',
      reason: 'High risk content detected',
      evidenceRefs: ['asset-123'],
      suggestedRoles: ['legal', 'compliance'],
      autoEscalate: true,
    })

    expect(advisory).toEqual({
      severity: 'warn',
      reason: 'High risk content detected',
      evidenceRefs: ['asset-123'],
      suggestedRoles: ['legal', 'compliance'],
      autoEscalate: true,
    })
  })

  it('defaults optional arrays when not provided', () => {
    const advisory = ApprovalAdvisorySchema.parse({
      severity: 'info',
      reason: 'Provide additional context',
    })

    expect(advisory.evidenceRefs).toEqual([])
    expect(advisory.suggestedRoles).toBeUndefined()
    expect(advisory.autoEscalate).toBeUndefined()
  })
})

describe('pending approval schema', () => {
  it('parses minimal pending approvals with defaults applied', () => {
    const approval = PendingApprovalSchema.parse({
      checkpointId: 'chk-1',
      reason: 'Manual approval required',
      requestedBy: 'orchestrator',
    })

    expect(approval).toMatchObject({
      checkpointId: 'chk-1',
      reason: 'Manual approval required',
      requestedBy: 'orchestrator',
      requiredRoles: [],
      evidenceRefs: [],
      status: 'waiting',
    })
  })

  it('parses completed approvals with advisory metadata', () => {
    const approval = PendingApprovalSchema.parse({
      checkpointId: 'chk-2',
      reason: 'Escalated for legal review',
      requestedBy: 'orchestrator',
      requestedAt: '2025-01-01T00:00:00.000Z',
      requiredRoles: ['legal'],
      evidenceRefs: ['asset-456'],
      advisory: {
        severity: 'block',
        reason: 'Potential regulatory violation',
        evidenceRefs: ['asset-456'],
        suggestedRoles: ['legal'],
        autoEscalate: true,
      },
      status: 'approved',
      decidedBy: 'reviewer-1',
      decidedAt: '2025-01-01T01:00:00.000Z',
      decisionNotes: 'Reviewed by counsel',
    })

    expect(approval.status).toBe(ApprovalDecisionStatusEnum.enum.approved)
    expect(approval.requiredRoles).toEqual(['legal'])
    expect(approval.advisory?.severity).toBe('block')
  })
})
