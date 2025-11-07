import { getDb, orchestratorRuns, eq, and, isNotNull } from '@awesomeposter/db'
import type { Plan, RunReport, StepResult, HitlRunState, HitlRequestRecord } from '@awesomeposter/shared'

export type OrchestratorRunStatus =
  | 'pending'
  | 'running'
  | 'awaiting_hitl'
  | 'awaiting_human'
  | 'completed'
  | 'cancelled'
  | 'removed'
  | 'failed'

export type OrchestratorSnapshot = {
  runId: string
  plan: Plan
  history: StepResult[]
  runReport: RunReport | null
  hitlState: HitlRunState
  pendingRequestId: string | null
  status: OrchestratorRunStatus
  threadId?: string | null
  briefId?: string | null
  executionContext: Record<string, unknown>
  runnerMetadata: Record<string, unknown>
  lastError?: string | null
  createdAt?: Date
  updatedAt?: Date
}

const DEFAULT_PLAN: Plan = { version: 0, steps: [] }
const DEFAULT_HITL_STATE: HitlRunState = { requests: [], responses: [], pendingRequestId: null, deniedCount: 0 }

type LegacyBridge = typeof globalThis & {
  __awesomeposter_setOrchestratorPersistence?: (instance: unknown) => void
  __awesomeposter_orchestratorPersistenceInstance?: unknown
}

const legacyBridge = globalThis as LegacyBridge

function clone<T>(value: T): T {
  if (value == null) return value
  return JSON.parse(JSON.stringify(value))
}

export class OrchestratorPersistence {
  private db

  constructor(dbInstance = getDb()) {
    this.db = dbInstance
  }

  async ensure(runId: string) {
    await this.db.insert(orchestratorRuns).values({ runId }).onConflictDoNothing()
  }

  async load(runId: string): Promise<OrchestratorSnapshot> {
    await this.ensure(runId)
    const [row] = await this.db
      .select()
      .from(orchestratorRuns)
      .where(eq(orchestratorRuns.runId, runId))
      .limit(1)

    if (!row) {
      return {
        runId,
        plan: clone(DEFAULT_PLAN),
        history: [],
        runReport: null,
        hitlState: clone(DEFAULT_HITL_STATE),
        pendingRequestId: null,
        status: 'pending',
        executionContext: {},
        runnerMetadata: {}
      }
    }

    const plan = (row.planSnapshotJson as Plan | null) ?? clone(DEFAULT_PLAN)
    const history = Array.isArray(row.stepHistoryJson) ? (row.stepHistoryJson as StepResult[]) : []
    const hitl = (row.hitlStateJson as HitlRunState | null) ?? clone(DEFAULT_HITL_STATE)

    return {
      runId,
      plan,
      history,
      runReport: (row.runReportJson as RunReport | null) ?? null,
      hitlState: hitl,
      pendingRequestId: row.pendingRequestId ?? hitl.pendingRequestId ?? null,
      status: (row.status as OrchestratorRunStatus | undefined) ?? 'pending',
      threadId: row.threadId ?? null,
      briefId: row.briefId ?? null,
      executionContext: (row.executionContextJson as Record<string, unknown> | null) ?? {},
      runnerMetadata: (row.runnerMetadataJson as Record<string, unknown> | null) ?? {},
      lastError: row.lastError ?? null,
      createdAt: row.createdAt ?? undefined,
      updatedAt: row.updatedAt ?? undefined
    }
  }

  async save(
    runId: string,
    updates: Partial<{
      plan: Plan
      history: StepResult[]
      runReport: RunReport | null
      hitlState: HitlRunState
      pendingRequestId: string | null
      status: OrchestratorRunStatus
      threadId: string | null
      briefId: string | null
      executionContext: Record<string, unknown>
      runnerMetadata: Record<string, unknown>
      lastError: string | null
    }>
  ) {
    await this.ensure(runId)
    const now = new Date()
    const set: Record<string, unknown> = { updatedAt: now }

    if (updates.plan) set.planSnapshotJson = clone(updates.plan)
    if (updates.history) set.stepHistoryJson = clone(updates.history)
    if (updates.runReport !== undefined) set.runReportJson = updates.runReport ? clone(updates.runReport) : null
    if (updates.hitlState) set.hitlStateJson = clone(updates.hitlState)
    if (updates.pendingRequestId !== undefined) set.pendingRequestId = updates.pendingRequestId
    if (updates.status) set.status = updates.status
    if (updates.threadId !== undefined) set.threadId = updates.threadId
    if (updates.briefId !== undefined) set.briefId = updates.briefId
    if (updates.executionContext) set.executionContextJson = clone(updates.executionContext)
    if (updates.runnerMetadata) set.runnerMetadataJson = clone(updates.runnerMetadata)
    if (updates.lastError !== undefined) set.lastError = updates.lastError

    await this.db
      .update(orchestratorRuns)
      .set(set)
      .where(eq(orchestratorRuns.runId, runId))
  }

  async touch(runId: string, status?: OrchestratorRunStatus) {
    await this.save(runId, { status })
  }

  async listAwaitingHitl() {
    const rows = await this.db
      .select()
      .from(orchestratorRuns)
      .where(and(isNotNull(orchestratorRuns.pendingRequestId), eq(orchestratorRuns.status, 'awaiting_hitl')))

    return Promise.all(
      rows.map(async (row) => {
        const snapshot = await this.load(row.runId)
        const pendingRequest = snapshot.hitlState.requests.find((req) => req.id === row.pendingRequestId)
        return {
          runId: row.runId,
          threadId: row.threadId ?? null,
          briefId: row.briefId ?? null,
          pendingRequestId: row.pendingRequestId,
          status: snapshot.status,
          updatedAt: row.updatedAt ?? undefined,
          executionContext: snapshot.executionContext,
          pendingRequest
        }
      })
    )
  }

  async findByThreadId(threadId: string) {
    const [row] = await this.db
      .select()
      .from(orchestratorRuns)
      .where(eq(orchestratorRuns.threadId, threadId))
      .limit(1)
    if (!row) return null
    const snapshot = await this.load(row.runId)
    return { runId: row.runId, snapshot }
  }
}

export class InMemoryOrchestratorPersistence {
  private runs = new Map<string, OrchestratorSnapshot>()

  private ensureSnapshot(runId: string): OrchestratorSnapshot {
    if (!this.runs.has(runId)) {
      this.runs.set(runId, {
        runId,
        plan: clone(DEFAULT_PLAN),
        history: [],
        runReport: null,
        hitlState: clone(DEFAULT_HITL_STATE),
        pendingRequestId: null,
        status: 'pending',
        executionContext: {},
        runnerMetadata: {}
      })
    }
    return this.runs.get(runId)!
  }

  async ensure(runId: string) {
    this.ensureSnapshot(runId)
  }

  async load(runId: string): Promise<OrchestratorSnapshot> {
    const snap = clone(this.ensureSnapshot(runId))
    return snap
  }

  async save(
    runId: string,
    updates: Partial<{
      plan: Plan
      history: StepResult[]
      runReport: RunReport | null
      hitlState: HitlRunState
      pendingRequestId: string | null
      status: OrchestratorRunStatus
      threadId: string | null
      briefId: string | null
      executionContext: Record<string, unknown>
      runnerMetadata: Record<string, unknown>
      lastError: string | null
    }>
  ) {
    const current = this.ensureSnapshot(runId)
    const next: OrchestratorSnapshot = {
      ...current,
      plan: updates.plan ? clone(updates.plan) : current.plan,
      history: updates.history ? clone(updates.history) : current.history,
      runReport: updates.runReport === undefined ? current.runReport : updates.runReport ? clone(updates.runReport) : null,
      hitlState: updates.hitlState ? clone(updates.hitlState) : current.hitlState,
      pendingRequestId: updates.pendingRequestId !== undefined ? updates.pendingRequestId : current.pendingRequestId,
      status: updates.status ?? current.status,
      threadId: updates.threadId !== undefined ? updates.threadId : current.threadId,
      briefId: updates.briefId !== undefined ? updates.briefId : current.briefId,
      executionContext: updates.executionContext ? clone(updates.executionContext) : current.executionContext,
      runnerMetadata: updates.runnerMetadata ? clone(updates.runnerMetadata) : current.runnerMetadata,
      lastError: updates.lastError !== undefined ? updates.lastError : current.lastError,
      runId
    }
    this.runs.set(runId, next)
  }

  async touch(runId: string, status?: OrchestratorRunStatus) {
    if (status) await this.save(runId, { status })
  }

  async listAwaitingHitl() {
    const results: Array<{
      runId: string
      threadId: string | null | undefined
      briefId?: string | null
      pendingRequestId: string | null | undefined
      status: OrchestratorRunStatus
      updatedAt?: Date
      executionContext: Record<string, unknown>
      pendingRequest: HitlRequestRecord | undefined
    }> = []
    for (const snapshot of this.runs.values()) {
      if (snapshot.status === 'awaiting_hitl' && snapshot.pendingRequestId) {
        const pendingRequest = snapshot.hitlState.requests.find((req) => req.id === snapshot.pendingRequestId)
        results.push({
          runId: snapshot.runId,
          threadId: snapshot.threadId,
          briefId: snapshot.briefId,
          pendingRequestId: snapshot.pendingRequestId,
          status: snapshot.status,
          executionContext: snapshot.executionContext,
          pendingRequest
        })
      }
    }
    return results
  }

  async findByThreadId(threadId: string) {
    for (const snapshot of this.runs.values()) {
      if (snapshot.threadId === threadId) {
        return { runId: snapshot.runId, snapshot: await this.load(snapshot.runId) }
      }
    }
    return null
  }
}

type PersistenceImpl = OrchestratorPersistence | InMemoryOrchestratorPersistence

let singleton: PersistenceImpl | null = null

export function getOrchestratorPersistence() {
  if (!singleton) {
    const sharedInstance = legacyBridge.__awesomeposter_orchestratorPersistenceInstance
    if (sharedInstance) {
      singleton = sharedInstance as PersistenceImpl
      return singleton
    }
    if (process.env.ORCHESTRATOR_PERSISTENCE === 'memory' || process.env.NODE_ENV === 'test') {
      singleton = new InMemoryOrchestratorPersistence()
    } else {
      singleton = new OrchestratorPersistence()
    }
  }
  return singleton
}

export function setOrchestratorPersistence(instance: PersistenceImpl) {
  singleton = instance
  try {
    legacyBridge.__awesomeposter_orchestratorPersistenceInstance = instance
  } catch {}
}

if (typeof legacyBridge.__awesomeposter_setOrchestratorPersistence !== 'function') {
  legacyBridge.__awesomeposter_setOrchestratorPersistence = (instance: unknown) => {
    try {
      setOrchestratorPersistence(instance as PersistenceImpl)
    } catch {}
  }
}
