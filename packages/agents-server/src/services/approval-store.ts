import { PendingApproval, ApprovalDecisionStatus } from '@awesomeposter/shared'

type PendingEntry = PendingApproval & {
  threadId?: string
}

type DecisionUpdate = {
  status: Exclude<ApprovalDecisionStatus, 'waiting'>
  decidedBy?: string
  decisionNotes?: string
}

export type ApprovalStore = {
  create(entry: PendingEntry): void
  get(checkpointId: string): PendingEntry | undefined
  listByThread(threadId: string): PendingEntry[]
  waitForDecision(checkpointId: string): Promise<PendingEntry>
  resolve(checkpointId: string, update: DecisionUpdate): PendingEntry | undefined
  clear(): void
}

type Waiter = (entry: PendingEntry) => void

export function createInMemoryApprovalStore(): ApprovalStore {
  const entries = new Map<string, PendingEntry>()
  const threadIndex = new Map<string, Set<string>>()
  const waiters = new Map<string, Waiter[]>()

  const flushWaiters = (checkpointId: string, entry: PendingEntry) => {
    if (entry.status === 'waiting') return
    const queue = waiters.get(checkpointId)
    if (!queue?.length) return
    waiters.delete(checkpointId)
    for (const waiter of queue) {
      try {
        waiter(entry)
      } catch {}
    }
  }

  return {
    create(entry) {
      entries.set(entry.checkpointId, entry)
      if (entry.threadId) {
        const set = threadIndex.get(entry.threadId) ?? new Set<string>()
        set.add(entry.checkpointId)
        threadIndex.set(entry.threadId, set)
      }
    },
    get(checkpointId) {
      return entries.get(checkpointId)
    },
    listByThread(threadId) {
      const ids = threadIndex.get(threadId)
      if (!ids) return []
      return Array.from(ids)
        .map((id) => entries.get(id))
        .filter((entry): entry is PendingEntry => !!entry)
    },
    waitForDecision(checkpointId) {
      const existing = entries.get(checkpointId)
      if (existing && existing.status !== 'waiting') {
        return Promise.resolve(existing)
      }
      return new Promise<PendingEntry>((resolve) => {
        const queue = waiters.get(checkpointId) ?? []
        queue.push(resolve)
        waiters.set(checkpointId, queue)
      })
    },
    resolve(checkpointId, update) {
      const existing = entries.get(checkpointId)
      if (!existing) return undefined
      const decidedAt = new Date().toISOString()
      const next: PendingEntry = {
        ...existing,
        status: update.status,
        decidedBy: update.decidedBy ?? existing.decidedBy,
        decisionNotes: update.decisionNotes ?? existing.decisionNotes,
        decidedAt,
      }
      entries.set(checkpointId, next)
      flushWaiters(checkpointId, next)
      return next
    },
    clear() {
      entries.clear()
      threadIndex.clear()
      waiters.clear()
    }
  }
}

let activeStore: ApprovalStore | null = null

export function setApprovalStore(store: ApprovalStore) {
  activeStore = store
}

export function resetApprovalStore() {
  activeStore = createInMemoryApprovalStore()
  return activeStore
}

export function getApprovalStore() {
  if (!activeStore) {
    activeStore = createInMemoryApprovalStore()
  }
  return activeStore
}

// Internal type export for tests
export type { PendingEntry, DecisionUpdate }
