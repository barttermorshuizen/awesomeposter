import type { Action } from '@awesomeposter/shared'

export type PendingPolicyActionState = {
  policyId: string
  nodeId: string
  requestId: string | null
  approveAction?: Action
  rejectAction?: Action
}

export type PolicyAttemptState = Record<string, number>

export type RuntimePolicySnapshotMode = 'hitl' | 'pause'
