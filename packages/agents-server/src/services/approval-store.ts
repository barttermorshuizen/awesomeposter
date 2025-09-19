import { PendingApproval, ApprovalDecisionStatus } from '@awesomeposter/shared'

type PendingEntry = PendingApproval & {
  threadId?: string
}

type DecisionUpdate = {
  status: Exclude<ApprovalDecisionStatus, 'waiting'>
  decidedBy?: string
  decisionNotes?: string
}

type Waiter = (entry: PendingEntry) => void

/**
 * In-memory approval store used during early HITL rollout.
 * TODO: replace with external persistence (M3) when feature flag graduates.
 */
class InMemoryApprovalStore {
  private entries = new Map<string, PendingEntry>()
  private threadIndex = new Map<string, Set<string>>()
  private waiters = new Map<string, Waiter[]>()

  create(entry: PendingEntry) {
    this.entries.set(entry.checkpointId, entry)
    if (entry.threadId) {
      const existing = this.threadIndex.get(entry.threadId) || new Set<string>()
      existing.add(entry.checkpointId)
      this.threadIndex.set(entry.threadId, existing)
    }
    this.resolveWaiters(entry.checkpointId, entry)
  }

  get(checkpointId: string) {
    return this.entries.get(checkpointId)
  }

  listByThread(threadId: string): PendingEntry[] {
    const ids = this.threadIndex.get(threadId)
    if (!ids) return []
    return Array.from(ids)
      .map((id) => this.entries.get(id))
      .filter((entry): entry is PendingEntry => !!entry)
  }

  async waitForDecision(checkpointId: string): Promise<PendingEntry> {
    const current = this.entries.get(checkpointId)
    if (current && current.status !== 'waiting') {
      return current
    }
    return await new Promise<PendingEntry>((resolve) => {
      const list = this.waiters.get(checkpointId) || []
      list.push(resolve)
      this.waiters.set(checkpointId, list)
    })
  }

  resolve(checkpointId: string, update: DecisionUpdate) {
    const existing = this.entries.get(checkpointId)
    if (!existing) return undefined
    const decidedAt = new Date().toISOString()
    const updated: PendingEntry = {
      ...existing,
      status: update.status,
      decidedBy: update.decidedBy ?? existing.decidedBy,
      decisionNotes: update.decisionNotes ?? existing.decisionNotes,
      decidedAt,
    }
    this.entries.set(checkpointId, updated)
    this.resolveWaiters(checkpointId, updated)
    return updated
  }

  clear() {
    this.entries.clear()
    this.threadIndex.clear()
    this.waiters.clear()
  }

  private resolveWaiters(checkpointId: string, entry: PendingEntry) {
    if (entry.status === 'waiting') return
    const waiters = this.waiters.get(checkpointId)
    if (!waiters || waiters.length === 0) return
    this.waiters.delete(checkpointId)
    for (const waiter of waiters) {
      try {
        waiter(entry)
      } catch {
        // ignore waiter errors
      }
    }
  }
}

const approvalStore = new InMemoryApprovalStore()

export function getApprovalStore() {
  return approvalStore
}

export type { PendingEntry }
