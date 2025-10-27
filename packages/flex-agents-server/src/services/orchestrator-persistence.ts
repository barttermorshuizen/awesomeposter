import { getDb, orchestratorRuns, flexRuns, flexPlanNodes, flexPlanSnapshots, flexRunOutputs, eq, and, isNotNull } from '@awesomeposter/db'
import { sql, notInArray, desc, asc } from 'drizzle-orm'
import type { Plan, RunReport, StepResult, HitlRunState, HitlRequestRecord } from '@awesomeposter/shared'
import type { TaskEnvelope, ContextBundle } from '@awesomeposter/shared'
import { setOrchestratorPersistence as setLegacyOrchestratorPersistence } from '../../../agents-server/src/services/orchestrator-persistence.js'
import type { RunContextSnapshot } from './run-context'
import type {
  FlexPlanNodeContracts,
  FlexPlanNodeFacets,
  FlexPlanNodeProvenance,
  FlexPlan,
  FlexPlanEdge,
  FlexPlanExecutor
} from './flex-planner'
import type { PendingPolicyActionState, RuntimePolicySnapshotMode } from './runtime-policy-types'

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

export type FlexRunStatus =
  | 'pending'
  | 'running'
  | 'awaiting_hitl'
  | 'awaiting_human'
  | 'completed'
  | 'failed'
  | 'cancelled'
export type FlexPlanNodeStatus = 'pending' | 'running' | 'completed' | 'error' | 'awaiting_hitl' | 'awaiting_human'

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
  facets?: FlexPlanNodeFacets | null
  contracts?: FlexPlanNodeContracts | null
  provenance?: FlexPlanNodeProvenance | null
  metadata?: Record<string, unknown> | null
  rationale?: string[] | null
  executor?: FlexPlanExecutor | null
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
  contextSnapshot?: RunContextSnapshot | null
  createdAt?: Date | null
  updatedAt?: Date | null
}

type PlanSnapshotState = {
  completedNodeIds: string[]
  nodeOutputs: Record<string, Record<string, unknown>>
  policyActions?: PendingPolicyActionState[]
  policyAttempts?: Record<string, number>
  mode?: RuntimePolicySnapshotMode
}

type SavePlanSnapshotOptions = {
  facets?: RunContextSnapshot
  schemaHash?: string | null
  edges?: FlexPlanEdge[]
  planMetadata?: Record<string, unknown>
  pendingState?: PlanSnapshotState
  tx?: any
}

type RecordResultOptions = {
  planVersion?: number
  status?: FlexRunStatus
  schemaHash?: string | null
  facets?: RunContextSnapshot | null
  provenance?: Record<string, unknown> | null
  snapshot?: {
    nodes: FlexPlanNodeSnapshot[]
    planVersion: number
    edges?: FlexPlanEdge[]
    planMetadata?: Record<string, unknown>
    pendingState?: PlanSnapshotState
  }
}

export type FlexRunOutputRow = {
  runId: string
  planVersion: number
  schemaHash: string | null
  status: FlexRunStatus
  output: Record<string, unknown>
  facets: RunContextSnapshot | null
  provenance: Record<string, unknown> | null
  recordedAt: Date | null
  updatedAt: Date | null
}

export type FlexPlanSnapshotRow = {
  runId: string
  planVersion: number
  snapshot: Record<string, unknown>
  facets: RunContextSnapshot | null
  schemaHash: string | null
  pendingNodeIds: string[]
  createdAt: Date | null
  updatedAt: Date | null
}

export type FlexRunDebugView = {
  run: FlexRunRecord & {
    createdAt?: Date | null
    updatedAt?: Date | null
  }
  nodes: FlexPlanNodeSnapshot[]
  snapshots: Array<FlexPlanSnapshotRow & { metadata?: Record<string, unknown> | null }>
  output: FlexRunOutputRow | null
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
        contextSnapshotJson: record.contextSnapshot ? clone(record.contextSnapshot) : {},
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
          contextSnapshotJson: record.contextSnapshot ? clone(record.contextSnapshot) : sql`coalesce(flex_runs.context_snapshot_json, '{}'::jsonb)`,
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

  async savePlanSnapshot(
    runId: string,
    planVersion: number,
    nodes: FlexPlanNodeSnapshot[],
    options: SavePlanSnapshotOptions = {}
  ) {
    const now = new Date()
    const execute = async (executor: any) => {
      await executor
        .update(flexRuns)
        .set({ planVersion, updatedAt: now })
        .where(eq(flexRuns.runId, runId))

      if (!nodes.length) {
        await executor.delete(flexPlanNodes).where(eq(flexPlanNodes.runId, runId))
      } else {
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

        await executor
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

        const nodeIds = nodes.map((node) => node.nodeId)
        if (nodeIds.length) {
          await executor
            .delete(flexPlanNodes)
            .where(and(eq(flexPlanNodes.runId, runId), notInArray(flexPlanNodes.nodeId, nodeIds)))
        }
      }

      if (options.facets) {
        await this.saveRunContext(runId, options.facets, { tx: executor })
      }

      const pendingNodeIds = nodes
        .filter((node) => node.status !== 'completed')
        .map((node) => node.nodeId)

      const snapshotPayload = {
        version: planVersion,
        nodes: nodes.map((node) => ({
          nodeId: node.nodeId,
          capabilityId: node.capabilityId ?? null,
          label: node.label ?? null,
          status: node.status,
          context: node.context ? clone(node.context) : null,
          output: node.output ? clone(node.output) : null,
          error: node.error ? clone(node.error) : null,
          facets: node.facets ? clone(node.facets) : null,
          contracts: node.contracts ? clone(node.contracts) : null,
          provenance: node.provenance ? clone(node.provenance) : null,
          metadata: node.metadata ? clone(node.metadata) : null,
          executor: node.executor ? clone(node.executor) : null,
          rationale: node.rationale ? clone(node.rationale) : null,
          startedAt: node.startedAt ? node.startedAt.toISOString() : null,
          completedAt: node.completedAt ? node.completedAt.toISOString() : null
        })),
        edges: options.edges ? clone(options.edges) : [],
        metadata: options.planMetadata ? clone(options.planMetadata) : {},
        pendingState: options.pendingState
          ? {
              completedNodeIds: clone(options.pendingState.completedNodeIds),
              nodeOutputs: clone(options.pendingState.nodeOutputs),
              ...(options.pendingState.policyActions
                ? { policyActions: clone(options.pendingState.policyActions) }
                : {}),
              ...(options.pendingState.policyAttempts
                ? { policyAttempts: clone(options.pendingState.policyAttempts) }
                : {}),
              ...(options.pendingState.mode ? { mode: options.pendingState.mode } : {})
            }
          : undefined
      }

      await executor
        .insert(flexPlanSnapshots)
        .values({
          runId,
          planVersion,
          snapshotJson: clone(snapshotPayload),
          facetSnapshotJson: options.facets ? clone(options.facets) : null,
          schemaHash: options.schemaHash ?? null,
          pendingNodeIds: pendingNodeIds.length ? pendingNodeIds : [],
          createdAt: now,
          updatedAt: now
        })
        .onConflictDoUpdate({
          target: [flexPlanSnapshots.runId, flexPlanSnapshots.planVersion],
          set: {
            snapshotJson: sql`excluded.snapshot_json`,
            facetSnapshotJson: sql`excluded.facet_snapshot_json`,
            schemaHash: sql`excluded.schema_hash`,
            pendingNodeIds: sql`excluded.pending_node_ids`,
            updatedAt: now
          }
        })
    }

    if (options.tx) {
      await execute(options.tx)
    } else {
      await this.db.transaction(async (tx) => {
        await execute(tx)
      })
    }
  }

  async saveRunContext(runId: string, snapshot: RunContextSnapshot, options: { tx?: any } = {}) {
    const now = new Date()
    const executor = options.tx ?? this.db
    await executor
      .update(flexRuns)
      .set({ contextSnapshotJson: clone(snapshot), updatedAt: now })
      .where(eq(flexRuns.runId, runId))
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

  async recordResult(runId: string, result: Record<string, unknown>, options: RecordResultOptions = {}) {
    const now = new Date()
    const status: FlexRunStatus = options.status ?? 'completed'
    await this.db.transaction(async (tx) => {
      await tx
        .update(flexRuns)
        .set({ resultJson: clone(result), status, updatedAt: now })
        .where(eq(flexRuns.runId, runId))

      await tx
        .insert(flexRunOutputs)
        .values({
          runId,
          planVersion: options.planVersion ?? options.snapshot?.planVersion ?? 0,
          schemaHash: options.schemaHash ?? null,
          status,
          outputJson: clone(result),
          facetSnapshotJson: options.facets ? clone(options.facets) : null,
          provenanceJson: options.provenance ? clone(options.provenance) : null,
          recordedAt: now,
          updatedAt: now
        })
        .onConflictDoUpdate({
          target: flexRunOutputs.runId,
          set: {
            planVersion: sql`excluded.plan_version`,
            schemaHash: sql`excluded.schema_hash`,
            status: sql`excluded.status`,
            outputJson: sql`excluded.output_json`,
            facetSnapshotJson: sql`excluded.facet_snapshot_json`,
            provenanceJson: sql`excluded.provenance_json`,
            updatedAt: now
          }
        })

      if (options.snapshot) {
        await this.savePlanSnapshot(runId, options.snapshot.planVersion, options.snapshot.nodes, {
          facets: options.facets ?? undefined,
          schemaHash: options.schemaHash ?? null,
          edges: options.snapshot.edges,
          planMetadata: options.snapshot.planMetadata,
          pendingState: options.snapshot.pendingState,
          tx
        })
      }
    })

    await this.orchestrator.save(runId, {
      status,
      runnerMetadata: {
        ...(result ? { resultKeys: Object.keys(result) } : {}),
        orchestrator: 'flex'
      }
    })
  }

  async loadRunOutput(runId: string): Promise<FlexRunOutputRow | null> {
    const [row] = await this.db
      .select()
      .from(flexRunOutputs)
      .where(eq(flexRunOutputs.runId, runId))
      .limit(1)
    if (!row) return null
    return {
      runId: row.runId,
      planVersion: row.planVersion ?? 0,
      schemaHash: row.schemaHash ?? null,
      status: (row.status as FlexRunStatus) ?? 'pending',
      output: (row.outputJson as Record<string, unknown>) ?? {},
      facets: (row.facetSnapshotJson as RunContextSnapshot | null) ?? null,
      provenance: (row.provenanceJson as Record<string, unknown> | null) ?? null,
      recordedAt: row.recordedAt ?? null,
      updatedAt: row.updatedAt ?? null
    }
  }

  async loadPlanSnapshot(runId: string, planVersion?: number): Promise<FlexPlanSnapshotRow | null> {
    let rows
    if (typeof planVersion === 'number') {
      rows = await this.db
        .select()
        .from(flexPlanSnapshots)
        .where(and(eq(flexPlanSnapshots.runId, runId), eq(flexPlanSnapshots.planVersion, planVersion)))
        .limit(1)
    } else {
      rows = await this.db
        .select()
        .from(flexPlanSnapshots)
        .where(eq(flexPlanSnapshots.runId, runId))
        .orderBy(desc(flexPlanSnapshots.planVersion))
        .limit(1)
    }
    const [row] = rows
    if (!row) return null
    return {
      runId: row.runId,
      planVersion: row.planVersion ?? 0,
      snapshot: (row.snapshotJson as Record<string, unknown>) ?? {},
      facets: (row.facetSnapshotJson as RunContextSnapshot | null) ?? null,
      schemaHash: row.schemaHash ?? null,
      pendingNodeIds: Array.isArray(row.pendingNodeIds) ? [...row.pendingNodeIds] : [],
      createdAt: row.createdAt ?? null,
      updatedAt: row.updatedAt ?? null
    }
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
      completedAt: node.completedAt ?? null,
      facets: null,
      contracts: null,
      provenance: null,
      metadata: null,
      rationale: null,
      executor: null
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
        planVersion: row.planVersion ?? 0,
        contextSnapshot: (row.contextSnapshotJson as RunContextSnapshot | undefined) ?? undefined,
        createdAt: row.createdAt ?? null,
        updatedAt: row.updatedAt ?? null
      },
      nodes
    }
  }

  async listPlanSnapshots(runId: string): Promise<FlexPlanSnapshotRow[]> {
    const rows = await this.db
      .select()
      .from(flexPlanSnapshots)
      .where(eq(flexPlanSnapshots.runId, runId))
      .orderBy(asc(flexPlanSnapshots.planVersion))

    return rows.map((row) => ({
      runId: row.runId,
      planVersion: row.planVersion ?? 0,
      snapshot: (row.snapshotJson as Record<string, unknown>) ?? {},
      facets: (row.facetSnapshotJson as RunContextSnapshot | null) ?? null,
      schemaHash: row.schemaHash ?? null,
      pendingNodeIds: Array.isArray(row.pendingNodeIds) ? [...row.pendingNodeIds] : [],
      createdAt: row.createdAt ?? null,
      updatedAt: row.updatedAt ?? null
    }))
  }

  async listPendingHumanTasks(filters: { assignedTo?: string; role?: string; status?: string } = {}) {
    const rows = await this.db
      .select({
        runId: flexPlanNodes.runId,
        nodeId: flexPlanNodes.nodeId,
        capabilityId: flexPlanNodes.capabilityId,
        label: flexPlanNodes.label,
        context: flexPlanNodes.contextJson,
        nodeUpdatedAt: flexPlanNodes.updatedAt,
        nodeCreatedAt: flexPlanNodes.createdAt,
        runStatus: flexRuns.status,
        runUpdatedAt: flexRuns.updatedAt
      })
      .from(flexPlanNodes)
      .innerJoin(flexRuns, eq(flexPlanNodes.runId, flexRuns.runId))
      .where(eq(flexPlanNodes.status, 'awaiting_human'))

    const normalized = rows.map((row) => {
      const context = (row.context as ContextBundle | null) ?? null
      const assignment = context?.assignment ?? null
      const status =
        typeof assignment?.status === 'string' && assignment.status
          ? (assignment.status as string)
          : 'awaiting_submission'
      const assignedTo = assignment?.assignedTo ?? null
      const role = assignment?.role ?? null
      const dueAt = assignment?.dueAt ?? null
      const priority = assignment?.priority ?? null
      const instructions = assignment?.instructions ?? null
      const defaults = assignment?.defaults ? clone(assignment.defaults) : null
      const metadata = assignment?.metadata ? clone(assignment.metadata) : null
      const timeoutSeconds = assignment?.timeoutSeconds ?? null
      const maxNotifications = assignment?.maxNotifications ?? null
      const notifyChannels = assignment?.notifyChannels ?? null
      const taskId = assignment?.assignmentId ?? `${row.runId}:${row.nodeId}`
      const createdAt =
        assignment?.createdAt ??
        (row.nodeCreatedAt ? row.nodeCreatedAt.toISOString() : null)
      const updatedAt =
        assignment?.updatedAt ??
        (row.nodeUpdatedAt ? row.nodeUpdatedAt.toISOString() : null)

      return {
        taskId,
        runId: row.runId,
        nodeId: row.nodeId,
        capabilityId: row.capabilityId ?? null,
        label: row.label ?? null,
        status,
        assignedTo,
        role,
        dueAt,
        priority,
        instructions,
        defaults,
        metadata,
        timeoutSeconds,
        maxNotifications,
        notifyChannels,
        createdAt,
        updatedAt,
        runStatus: row.runStatus ?? null,
        runUpdatedAt: row.runUpdatedAt ? row.runUpdatedAt.toISOString() : null
      }
    })

    return normalized
      .filter((task) => {
        if (filters.assignedTo) {
          if (!task.assignedTo || task.assignedTo !== filters.assignedTo) return false
        }
        if (filters.role) {
          if (!task.role || task.role !== filters.role) return false
        }
        if (filters.status) {
          if (task.status !== filters.status) return false
        }
        return true
      })
      .sort((a, b) => {
        const left = a.updatedAt ?? ''
        const right = b.updatedAt ?? ''
        return right.localeCompare(left)
      })
  }

  async recordResumeAudit(
    run: FlexRunRecord,
    audit: { operator?: Record<string, unknown> | null; note?: string | null }
  ) {
    const now = new Date()
    const metadata = run.metadata ? clone(run.metadata) : {}
    const auditLog = Array.isArray((metadata as any).auditLog)
      ? [...((metadata as any).auditLog as Array<Record<string, unknown>>)]
      : []

    auditLog.push({
      action: 'resume',
      at: now.toISOString(),
      operator: audit.operator ?? null,
      note: audit.note ?? null
    })

    ;(metadata as any).auditLog = auditLog
    ;(metadata as any).lastResumeAt = now.toISOString()
    if (audit.operator) {
      ;(metadata as any).lastOperator = audit.operator
    }
    if (audit.note) {
      ;(metadata as any).lastResumeNote = audit.note
    }

    await this.db
      .update(flexRuns)
      .set({ metadataJson: clone(metadata), updatedAt: now })
      .where(eq(flexRuns.runId, run.runId))

    try {
      const orchestratorSnapshot = await this.orchestrator.load(run.runId)
      const runnerMetadata = orchestratorSnapshot.runnerMetadata
        ? clone(orchestratorSnapshot.runnerMetadata)
        : {}
      const runnerAuditLog = Array.isArray((runnerMetadata as any).auditLog)
        ? [...((runnerMetadata as any).auditLog as Array<Record<string, unknown>>)]
        : []
      runnerAuditLog.push({
        action: 'resume',
        at: now.toISOString(),
        operator: audit.operator ?? null,
        note: audit.note ?? null
      })
      ;(runnerMetadata as any).auditLog = runnerAuditLog
      ;(runnerMetadata as any).lastResumeAt = now.toISOString()
      if (audit.operator) {
        ;(runnerMetadata as any).lastOperator = audit.operator
      }
      await this.orchestrator.save(run.runId, {
        runnerMetadata
      })
    } catch {}

    run.metadata = metadata
  }

  async loadFlexRunDebug(runId: string): Promise<FlexRunDebugView | null> {
    const record = await this.loadFlexRun(runId)
    if (!record) return null
    const [snapshots, output] = await Promise.all([
      this.listPlanSnapshots(runId),
      this.loadRunOutput(runId)
    ])

    const snapshotsWithMetadata = snapshots.map((snapshot) => {
      const snapshotPayload = snapshot.snapshot ?? {}
      const metadata =
        snapshotPayload && typeof snapshotPayload === 'object' && !Array.isArray(snapshotPayload)
          ? ((snapshotPayload as any).metadata && typeof (snapshotPayload as any).metadata === 'object'
              ? clone((snapshotPayload as any).metadata as Record<string, unknown>)
              : null)
          : null
      return { ...snapshot, metadata }
    })

    return {
      run: record.run,
      nodes: record.nodes,
      snapshots: snapshotsWithMetadata,
      output: output ?? (record.run.result
        ? {
            runId,
            planVersion: record.run.planVersion ?? 0,
            schemaHash: record.run.schemaHash ?? null,
            status: record.run.status,
            output: clone(record.run.result),
            facets: record.run.contextSnapshot ?? null,
            provenance: null,
            recordedAt: record.run.updatedAt ?? null,
            updatedAt: record.run.updatedAt ?? null
          }
        : null)
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
