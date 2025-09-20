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

export function createDurableApprovalStore(): ApprovalStore {
  const waiters = new Map<string, Waiter[]>()
  const cache = new Map<string, PendingEntry>()
  const threadIndex = new Map<string, Set<string>>()

  const dbPromise = (async () => {
    const dbModule = await import('@awesomeposter/db')
    const db = dbModule.getDb()
    return {
      db,
      table: dbModule.approvalCheckpoints,
      eq: dbModule.eq
    }
  })()

  const clone = (entry: PendingEntry): PendingEntry => JSON.parse(JSON.stringify(entry))

  const indexAdd = (threadId: string | undefined, checkpointId: string) => {
    if (!threadId) return
    const set = threadIndex.get(threadId) ?? new Set<string>()
    set.add(checkpointId)
    threadIndex.set(threadId, set)
  }

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

  const normalizeRow = (row: any): PendingEntry | undefined => {
    if (!row) return undefined
    const payload = (row.payloadJson || {}) as Record<string, any>
    const checkpointId = (payload.checkpointId as string) || row.checkpointId
    if (!checkpointId) return undefined
    const normalized: PendingEntry = {
      ...(payload as any),
      checkpointId,
      threadId: (payload.threadId as string) || row.threadId,
      status: (payload.status as any) || (row.status as any)
    }
    if (row.decidedBy && !normalized.decidedBy) normalized.decidedBy = row.decidedBy
    if (row.decisionNotes && !normalized.decisionNotes) normalized.decisionNotes = row.decisionNotes
    if (!normalized.requestedAt && row.requestedAt) normalized.requestedAt = row.requestedAt.toISOString()
    if (!normalized.decidedAt && row.decidedAt) normalized.decidedAt = row.decidedAt.toISOString()
    return normalized
  }

  const persistUpsert = (entry: PendingEntry) => {
    dbPromise
      .then(async ({ db, table }) => {
        const payloadJson = clone(entry)
        await db
          .insert(table)
          .values({
            checkpointId: entry.checkpointId,
            threadId: entry.threadId ?? '',
            payloadJson: payloadJson as any,
            status: entry.status,
            requestedAt: entry.requestedAt ? new Date(entry.requestedAt) : new Date(),
            decidedAt: entry.decidedAt ? new Date(entry.decidedAt) : null,
            decidedBy: entry.decidedBy ?? null,
            decisionNotes: entry.decisionNotes ?? null,
            updatedAt: new Date()
          })
          .onConflictDoUpdate({
            target: table.checkpointId,
            set: {
              payloadJson: payloadJson as any,
              status: entry.status,
              threadId: entry.threadId ?? '',
              decidedAt: entry.decidedAt ? new Date(entry.decidedAt) : null,
              decidedBy: entry.decidedBy ?? null,
              decisionNotes: entry.decisionNotes ?? null,
              updatedAt: new Date()
            }
          })
      })
      .catch((err) => {
        console.warn('[approval-store] durable persist failed', err)
      })
  }

  const persistDeleteAll = () => {
    dbPromise
      .then(async ({ db, table }) => {
        await db.delete(table)
      })
      .catch((err) => {
        console.warn('[approval-store] durable clear failed', err)
      })
  }

  dbPromise
    .then(async ({ db, table }) => {
      const rows = await db.select().from(table)
      for (const row of rows) {
        const entry = normalizeRow(row)
        if (!entry) continue
        cache.set(entry.checkpointId, entry)
        indexAdd(entry.threadId, entry.checkpointId)
      }
    })
    .catch((err) => {
      console.warn('[approval-store] durable load failed', err)
    })

  const getFromCache = async (checkpointId: string): Promise<PendingEntry | undefined> => {
    const existing = cache.get(checkpointId)
    if (existing) return existing
    try {
      const { db, table, eq } = await dbPromise
      const [row] = await db
        .select()
        .from(table)
        .where(eq(table.checkpointId, checkpointId))
        .limit(1)
      const entry = normalizeRow(row)
      if (entry) {
        cache.set(entry.checkpointId, entry)
        indexAdd(entry.threadId, entry.checkpointId)
      }
      return entry
    } catch (err) {
      console.warn('[approval-store] durable fetch failed', err)
      return undefined
    }
  }

  return {
    create(entry) {
      cache.set(entry.checkpointId, entry)
      indexAdd(entry.threadId, entry.checkpointId)
      persistUpsert(entry)
    },
    get(checkpointId) {
      void getFromCache(checkpointId)
      return cache.get(checkpointId)
    },
    listByThread(threadId) {
      const ids = threadIndex.get(threadId)
      if (!ids || ids.size === 0) {
        dbPromise
          .then(async ({ db, table, eq }) => {
            const rows = await db
              .select()
              .from(table)
              .where(eq(table.threadId, threadId))
            for (const row of rows) {
              const entry = normalizeRow(row)
              if (!entry) continue
              cache.set(entry.checkpointId, entry)
              indexAdd(entry.threadId, entry.checkpointId)
            }
          })
          .catch((err) => {
            console.warn('[approval-store] durable list failed', err)
          })
      }
      return Array.from(ids ?? [])
        .map((id) => cache.get(id))
        .filter((entry): entry is PendingEntry => !!entry)
    },
    waitForDecision(checkpointId) {
      const existing = cache.get(checkpointId)
      if (existing && existing.status !== 'waiting') {
        return Promise.resolve(existing)
      }
      void getFromCache(checkpointId)
      return new Promise<PendingEntry>((resolve) => {
        const queue = waiters.get(checkpointId) ?? []
        queue.push(resolve)
        waiters.set(checkpointId, queue)
      })
    },
    resolve(checkpointId, update) {
      const base = cache.get(checkpointId)
      if (!base) {
        void getFromCache(checkpointId)
      }
      const current = cache.get(checkpointId)
      if (!current) return undefined
      const decidedAt = new Date().toISOString()
      const next: PendingEntry = {
        ...current,
        status: update.status,
        decidedBy: update.decidedBy ?? current.decidedBy,
        decisionNotes: update.decisionNotes ?? current.decisionNotes,
        decidedAt
      }
      cache.set(checkpointId, next)
      persistUpsert(next)
      flushWaiters(checkpointId, next)
      return next
    },
    clear() {
      cache.clear()
      threadIndex.clear()
      waiters.clear()
      persistDeleteAll()
    }
  }
}

let activeStore: ApprovalStore | null = null

export function setApprovalStore(store: ApprovalStore) {
  activeStore = store
}

export function resetApprovalStore() {
  activeStore = null
  return getApprovalStore()
}

export function getApprovalStore() {
  if (!activeStore) {
    if (process.env.ENABLE_HITL_APPROVALS_DURABLE === 'true') {
      try {
        activeStore = createDurableApprovalStore()
      } catch (err) {
        console.warn('[approval-store] durable store init failed, falling back to in-memory', err)
        activeStore = createInMemoryApprovalStore()
      }
    } else {
      activeStore = createInMemoryApprovalStore()
    }
  }
  return activeStore
}

// Internal type export for tests
export type { PendingEntry, DecisionUpdate }
