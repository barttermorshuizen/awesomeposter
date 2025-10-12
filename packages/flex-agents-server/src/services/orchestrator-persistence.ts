import { getDb, orchestratorRuns, flexRuns, flexPlanNodes, eq, and, isNotNull } from '@awesomeposter/db'
import { sql } from 'drizzle-orm'
import type { Plan, RunReport, StepResult, HitlRunState, HitlRequestRecord } from '@awesomeposter/shared'
import type { TaskEnvelope, ContextBundle } from '@awesomeposter/shared'
import { setOrchestratorPersistence as setLegacyOrchestratorPersistence } from '../../../agents-server/src/services/orchestrator-persistence.js'

export type OrchestratorRunStatus =
  | 'pending'
  | 'running'
  | 'awaiting_hitl'
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
    setLegacyOrchestratorPersistence(instance as any)
  } catch {}
}

export type FlexRunStatus = 'pending' | 'running' | 'awaiting_hitl' | 'completed' | 'failed' | 'cancelled'
export type FlexPlanNodeStatus = 'pending' | 'running' | 'completed' | 'error' | 'awaiting_hitl'

export type FlexPlanNodeSnapshot = {
  nodeId: string
  capabilityId?: string | null
  label?: string | null
  status: FlexPlanNodeStatus
  context?: ContextBundle | null
  output?: Record<string, unknown> | null
  error?: Record<string, unknown> | null
  startedAt?: Date | null
  completedAt?: Date | null
}

export type FlexRunRecord = {
  runId: string
  envelope: TaskEnvelope
  status: FlexRunStatus
  threadId?: string | null
  objective?: string | null
  schemaHash?: string | null
  metadata?: Record<string, unknown> | null
  result?: Record<string, unknown> | null
  planVersion?: number
}

export class FlexRunPersistence {
  private db

  constructor(
    dbInstance = getDb(),
    private readonly orchestrator = getOrchestratorPersistence()
  ) {
    this.db = dbInstance
  }

  async ensure(runId: string) {
    await this.orchestrator.ensure(runId)
  }

  async createOrUpdateRun(record: FlexRunRecord) {
    const now = new Date()
    const metadata = record.metadata ?? (record.envelope.metadata ? clone(record.envelope.metadata) : {})
    await this.db
      .insert(flexRuns)
      .values({
        runId: record.runId,
        threadId: record.threadId ?? null,
        status: record.status,
        objective: record.objective ?? record.envelope.objective ?? null,
        envelopeJson: clone(record.envelope),
        schemaHash: record.schemaHash ?? null,
        metadataJson: metadata ? clone(metadata) : {},
        resultJson: record.result ? clone(record.result) : null,
        planVersion: record.planVersion ?? 0,
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: flexRuns.runId,
        set: {
          threadId: record.threadId ?? null,
          status: record.status,
          objective: record.objective ?? record.envelope.objective ?? null,
          envelopeJson: clone(record.envelope),
          schemaHash: record.schemaHash ?? null,
          metadataJson: metadata ? clone(metadata) : {},
          resultJson: record.result ? clone(record.result) : null,
          planVersion: record.planVersion ?? 0,
          updatedAt: now
        }
      })

    await this.orchestrator.ensure(record.runId)
    await this.orchestrator.save(record.runId, {
      status: record.status,
      threadId: record.threadId ?? null,
      executionContext: metadata ? clone(metadata) : undefined,
      runnerMetadata: {
        ...(metadata ? { callerMetadata: metadata } : {}),
        orchestrator: 'flex',
        schemaHash: record.schemaHash ?? undefined
      },
      lastError: undefined
    })
  }

  async updateStatus(runId: string, status: FlexRunStatus) {
    const now = new Date()
    await this.db
      .update(flexRuns)
      .set({ status, updatedAt: now })
      .where(eq(flexRuns.runId, runId))
    await this.orchestrator.touch(runId, status)
  }

  async savePlanSnapshot(runId: string, planVersion: number, nodes: FlexPlanNodeSnapshot[]) {
    const now = new Date()
    await this.db
      .update(flexRuns)
      .set({ planVersion, updatedAt: now })
      .where(eq(flexRuns.runId, runId))

    if (!nodes.length) return
    const rows = nodes.map((node) => ({
      runId,
      nodeId: node.nodeId,
      capabilityId: node.capabilityId ?? null,
      label: node.label ?? null,
      status: node.status,
      contextJson: node.context ? clone(node.context) : {},
      outputJson: node.output ? clone(node.output) : null,
      errorJson: node.error ? clone(node.error) : null,
      startedAt: node.startedAt ?? null,
      completedAt: node.completedAt ?? null,
      createdAt: now,
      updatedAt: now
    }))

    await this.db
      .insert(flexPlanNodes)
      .values(rows)
      .onConflictDoUpdate({
        target: [flexPlanNodes.runId, flexPlanNodes.nodeId],
        set: {
          capabilityId: sql`excluded.capability_id`,
          label: sql`excluded.label`,
          status: sql`excluded.status`,
          contextJson: sql`excluded.context_json`,
          outputJson: sql`excluded.output_json`,
          errorJson: sql`excluded.error_json`,
          startedAt: sql`excluded.started_at`,
          completedAt: sql`excluded.completed_at`,
          updatedAt: sql`excluded.updated_at`
        }
      })
  }

  async markNode(
    runId: string,
    nodeId: string,
    updates: Partial<FlexPlanNodeSnapshot> & { status?: FlexPlanNodeStatus }
  ) {
    const now = new Date()
    const set: Record<string, unknown> = { updatedAt: now }
    if (updates.status) set.status = updates.status
    if (updates.capabilityId !== undefined) set.capabilityId = updates.capabilityId ?? null
    if (updates.label !== undefined) set.label = updates.label ?? null
    if (updates.context !== undefined) set.contextJson = updates.context ? clone(updates.context) : {}
    if (updates.output !== undefined) set.outputJson = updates.output ? clone(updates.output) : null
    if (updates.error !== undefined) set.errorJson = updates.error ? clone(updates.error) : null
    if (updates.startedAt !== undefined) set.startedAt = updates.startedAt ?? null
    if (updates.completedAt !== undefined) set.completedAt = updates.completedAt ?? null

    await this.db
      .insert(flexPlanNodes)
      .values({
        runId,
        nodeId,
        capabilityId: updates.capabilityId ?? null,
        label: updates.label ?? null,
        status: updates.status ?? 'pending',
        contextJson: updates.context ? clone(updates.context) : {},
        outputJson: updates.output ? clone(updates.output) : null,
        errorJson: updates.error ? clone(updates.error) : null,
        startedAt: updates.startedAt ?? null,
        completedAt: updates.completedAt ?? null,
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: [flexPlanNodes.runId, flexPlanNodes.nodeId],
        set
      })
  }

  async recordPendingResult(runId: string, result: Record<string, unknown>) {
    const now = new Date()
    await this.db
      .update(flexRuns)
      .set({ resultJson: clone(result), updatedAt: now })
      .where(eq(flexRuns.runId, runId))
  }

  async recordResult(runId: string, result: Record<string, unknown>) {
    const now = new Date()
    await this.db
      .update(flexRuns)
      .set({ resultJson: clone(result), status: 'completed', updatedAt: now })
      .where(eq(flexRuns.runId, runId))
    await this.orchestrator.save(runId, {
      status: 'completed',
      runnerMetadata: {
        ...(result ? { resultKeys: Object.keys(result) } : {}),
        orchestrator: 'flex'
      }
    })
  }

  async loadFlexRun(runId: string) {
    const [row] = await this.db
      .select()
      .from(flexRuns)
      .where(eq(flexRuns.runId, runId))
      .limit(1)
    if (!row) return null
    const nodeRows = await this.db
      .select()
      .from(flexPlanNodes)
      .where(eq(flexPlanNodes.runId, runId))
      .orderBy(flexPlanNodes.createdAt)

    const nodes: FlexPlanNodeSnapshot[] = nodeRows.map((node) => ({
      nodeId: node.nodeId,
      capabilityId: node.capabilityId ?? undefined,
      label: node.label ?? undefined,
      status: (node.status as FlexPlanNodeStatus) ?? 'pending',
      context: (node.contextJson as ContextBundle | null) ?? null,
      output: (node.outputJson as Record<string, unknown> | null) ?? null,
      error: (node.errorJson as Record<string, unknown> | null) ?? null,
      startedAt: node.startedAt ?? null,
      completedAt: node.completedAt ?? null
    }))

    return {
      run: {
        runId: row.runId,
        threadId: row.threadId ?? null,
        status: (row.status as FlexRunStatus) ?? 'pending',
        objective: row.objective ?? null,
        envelope: (row.envelopeJson as TaskEnvelope),
        schemaHash: row.schemaHash ?? null,
        metadata: (row.metadataJson as Record<string, unknown>) ?? null,
        result: (row.resultJson as Record<string, unknown> | null) ?? null,
        planVersion: row.planVersion ?? 0
      },
      nodes
    }
  }

  async findFlexRunByThreadId(threadId: string) {
    const [row] = await this.db
      .select()
      .from(flexRuns)
      .where(eq(flexRuns.threadId, threadId))
      .limit(1)
    if (!row) return null
    return this.loadFlexRun(row.runId)
  }
}
