import type { PendingApproval } from '@awesomeposter/shared'

type ApprovalDecisionInput = {
  checkpointId: string
  decision: 'approved' | 'rejected'
  decidedBy?: string
  notes?: string
}

type ApprovalDecisionResponse = {
  ok: boolean
  checkpointId: string
  status: 'approved' | 'rejected'
}

type PendingApprovalsResponse = {
  pending?: PendingApproval[]
}

export const AGENTS_BASE_URL = import.meta.env.VITE_AGENTS_BASE_URL || 'http://localhost:3002'
export const AGENTS_AUTH = import.meta.env.VITE_AGENTS_AUTH_BEARER || undefined

function buildHeaders(init?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...init,
  }
  if (AGENTS_AUTH) headers['authorization'] = `Bearer ${AGENTS_AUTH}`
  return headers
}

export async function listPendingApprovals(threadId: string): Promise<PendingApproval[]> {
  const url = new URL('/api/v1/orchestrator/approvals', AGENTS_BASE_URL)
  url.searchParams.set('threadId', threadId)

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: buildHeaders(),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Failed to load approvals (${res.status}): ${text || res.statusText}`)
  }

  const json = (await res.json().catch(() => ({}))) as PendingApprovalsResponse
  if (!json || !Array.isArray(json.pending)) return []
  return json.pending
}

export async function postApprovalDecision(input: ApprovalDecisionInput): Promise<ApprovalDecisionResponse> {
  const res = await fetch(`${AGENTS_BASE_URL}/api/v1/orchestrator/approval`, {
    method: 'POST',
    headers: buildHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      checkpointId: input.checkpointId,
      status: input.decision,
      decidedBy: input.decidedBy,
      decisionNotes: input.notes,
    }),
  })

  const json = (await res.json().catch(() => ({}))) as ApprovalDecisionResponse | { statusMessage?: string; error?: string }

  if (!res.ok || !json || (json as ApprovalDecisionResponse).ok !== true) {
    const message =
      (json as { statusMessage?: string }).statusMessage ||
      (json as { error?: string }).error ||
      `Approval request failed (${res.status})`
    throw new Error(message)
  }

  return json as ApprovalDecisionResponse
}
