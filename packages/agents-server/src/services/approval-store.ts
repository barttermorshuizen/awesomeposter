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
 * Temporary in-memory approval store used while M2/M3 iterate.
 * TODO (M3): replace with durable persistence behind feature flag.
 */
class InMemoryApprovalStore {
  private entries = new Map<string, PendingEntry>()
  private threadIndex = new Map<string, Set<string>>()
  private waiters = new Map<string, Waiter[]>()

  create(entry: PendingEntry) {
    this.entries.set(entry.checkpointId, entry)
    if (entry.threadId) {
      const set = this.threadIndex.get(entry.threadId) ?? new Set<string>()
      set.add(entry.checkpointId)
      this.threadIndex.set(entry.threadId, set)
    }
  }

  get(checkpointId: string) {
    return this.entries.get(checkpointId)
  }

  listByThread(threadId: string) {
    const ids = this.threadIndex.get(threadId)
    if (!ids) return []
    return Array.from(ids)
      .map((id) => this.entries.get(id))
      .filter((entry): entry is PendingEntry => !!entry)
  }

  waitForDecision(checkpointId: string): Promise<PendingEntry> {
    const existing = this.entries.get(checkpointId)
    if (existing && existing.status !== 'waiting') {
      return Promise.resolve(existing)
    }
    return new Promise<PendingEntry>((resolve) => {
      const waiters = this.waiters.get(checkpointId) ?? []
      waiters.push(resolve)
      this.waiters.set(checkpointId, waiters)
    })
  }

  resolve(checkpointId: string, update: DecisionUpdate) {
    const existing = this.entries.get(checkpointId)
    if (!existing) return undefined
    const decidedAt = new Date().toISOString()
    const next: PendingEntry = {
      ...existing,
      status: update.status,
      decidedBy: update.decidedBy ?? existing.decidedBy,
      decisionNotes: update.decisionNotes ?? existing.decisionNotes,
      decidedAt,
    }
    this.entries.set(checkpointId, next)
    this.flushWaiters(checkpointId, next)
    return next
  }

  clear() {
    this.entries.clear()
    this.threadIndex.clear()
    this.waiters.clear()
  }

  private flushWaiters(checkpointId: string, entry: PendingEntry) {
    if (entry.status === 'waiting') return
    const waiters = this.waiters.get(checkpointId)
    if (!waiters?.length) return
    this.waiters.delete(checkpointId)
    for (const waiter of waiters) {
      try {
        waiter(entry)
      } catch {
        // ignore waiter failures
      }
    }
  }
}

const approvalStore = new InMemoryApprovalStore()

export function getApprovalStore() {
  return approvalStore
}

export type { PendingEntry, DecisionUpdate }
