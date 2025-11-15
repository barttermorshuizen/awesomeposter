import { getDb, orchestratorRuns, flexRuns, flexPlanNodes, flexPlanSnapshots, flexRunOutputs, eq, and, isNotNull } from '@awesomeposter/db'
import { sql, notInArray, desc, asc } from 'drizzle-orm'
import type { Plan, RunReport, StepResult, HitlRunState, HitlRequestRecord } from '@awesomeposter/shared'
import type {
  TaskEnvelope,
  ContextBundle,
  FlexFacetProvenanceMap,
  ConditionalRoutingNode,
  GoalConditionResult,
  FacetCondition
} from '@awesomeposter/shared'
import { ensureFacetPlaceholders, stripPlannerFields } from './run-context-utils'
import type { RunContextSnapshot } from './run-context'
import type {
  FlexPlanNodeContracts,
  FlexPlanNodeFacets,
  FlexPlanNodeProvenance,
  FlexPlanEdge,
  FlexPlanExecutor,
  FlexPlanNodeStatus
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

type DbClient = ReturnType<typeof getDb>

type LegacyOrchestratorBridge = typeof globalThis & {
  __awesomeposter_setOrchestratorPersistence?: (instance: unknown) => void
  __awesomeposter_orchestratorPersistenceInstance?: unknown
}

const legacyBridge = globalThis as LegacyOrchestratorBridge

function clone<T>(value: T): T {
  if (value == null) return value
  return JSON.parse(JSON.stringify(value))
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function extractFacetValues(
  snapshot: RunContextSnapshot | null | undefined,
  facets: string[] | undefined
): Record<string, unknown> {
  if (!snapshot || !snapshot.facets || typeof snapshot.facets !== 'object') {
    return {}
  }

  const entries = snapshot.facets
  const selectedFacets =
    Array.isArray(facets) && facets.length > 0 ? facets : Object.keys(entries)

  const values: Record<string, unknown> = {}
  for (const facet of selectedFacets) {
    if (typeof facet !== 'string') continue
    const entry = entries[facet]
    if (entry && typeof entry === 'object' && entry !== null && Object.prototype.hasOwnProperty.call(entry, 'value')) {
      values[facet] = clone((entry as { value: unknown }).value)
    }
  }
  return values
}

function hasObjectKeys(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.keys(value as Record<string, unknown>).length > 0
}

function resolveEnvelopeInputFacets(envelope: TaskEnvelope | null | undefined): string[] {
  if (!envelope || !envelope.inputs || typeof envelope.inputs !== 'object') return []
  const ignored = new Set(['plannerKind', 'plannerVariantCount', 'derivedCapability'])
  return Object.keys(envelope.inputs as Record<string, unknown>).filter((key) => !ignored.has(key))
}

function resolveEnvelopeOutputFacets(envelope: TaskEnvelope | null | undefined): string[] {
  if (!envelope || !envelope.outputContract) return []
  const contract = envelope.outputContract
  if (contract.mode === 'facets') {
    return Array.isArray(contract.facets) ? [...contract.facets] : []
  }
  if (contract.mode === 'json_schema') {
    if (Array.isArray(contract.hints?.facets) && contract.hints?.facets.length) {
      return contract.hints.facets
        .map((entry) => (entry && typeof entry === 'object' ? (entry as { facet?: string }).facet : null))
        .filter((facet): facet is string => typeof facet === 'string' && facet.length > 0)
    }
    if (contract.schema && typeof contract.schema === 'object') {
      const properties = (contract.schema as { properties?: Record<string, unknown> }).properties ?? {}
      return Object.keys(properties)
    }
  }
  return []
}

function removeDuplicateMetadataAliases(metadata: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object') return metadata
  const cleaned = clone(metadata)

  const stripPlannerKeys = (payload: Record<string, unknown> | null) =>
    payload ? stripPlannerFields(payload) : null

  const currentInputs = stripPlannerKeys(
    hasObjectKeys(cleaned.currentInputs) ? (cleaned.currentInputs as Record<string, unknown>) : null
  )
  const candidateInputs = stripPlannerKeys(
    hasObjectKeys(cleaned.inputs) ? (cleaned.inputs as Record<string, unknown>) : null
  )
  const candidateInput = stripPlannerKeys(
    hasObjectKeys(cleaned.input) ? (cleaned.input as Record<string, unknown>) : null
  )

  const resolvedInputs = currentInputs ?? candidateInputs ?? candidateInput
  if (resolvedInputs) {
    cleaned.currentInputs = resolvedInputs
    if (candidateInputs && JSON.stringify(candidateInputs) === JSON.stringify(resolvedInputs)) {
      delete cleaned.inputs
    }
    if (candidateInput && JSON.stringify(candidateInput) === JSON.stringify(resolvedInputs)) {
      delete cleaned.input
    }
  }

  const currentOutput = stripPlannerKeys(
    hasObjectKeys(cleaned.currentOutput) ? (cleaned.currentOutput as Record<string, unknown>) : null
  )
  const candidateOutput = stripPlannerKeys(
    hasObjectKeys(cleaned.output) ? (cleaned.output as Record<string, unknown>) : null
  )
  const candidatePrior = stripPlannerKeys(
    hasObjectKeys(cleaned.priorOutputs) ? (cleaned.priorOutputs as Record<string, unknown>) : null
  )

  const resolvedOutput = currentOutput ?? candidateOutput ?? candidatePrior
  if (resolvedOutput) {
    cleaned.currentOutput = resolvedOutput
    if (candidateOutput && JSON.stringify(candidateOutput) === JSON.stringify(resolvedOutput)) {
      delete cleaned.output
    }
    if (candidatePrior && JSON.stringify(candidatePrior) === JSON.stringify(resolvedOutput)) {
      delete cleaned.priorOutputs
    }
  }

  return cleaned
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
    legacyBridge.__awesomeposter_orchestratorPersistenceInstance = instance
  } catch {}
  try {
    legacyBridge.__awesomeposter_setOrchestratorPersistence?.(instance)
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
  routing?: ConditionalRoutingNode | null
  postConditionGuards?: FacetCondition[] | null
  postConditionResults?: GoalConditionResult[] | null
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
  goalConditionFailures?: GoalConditionResult[]
  postConditionAttempts?: Record<string, number>
}

type ExtendedContextBundle = ContextBundle & {
  runContextSnapshot?: RunContextSnapshot | null
  currentInputs?: unknown
  inputs?: unknown
  currentOutput?: unknown
  priorOutputs?: unknown
}

type SavePlanSnapshotOptions = {
  facets?: RunContextSnapshot
  schemaHash?: string | null
  edges?: FlexPlanEdge[]
  planMetadata?: Record<string, unknown>
  pendingState?: PlanSnapshotState
  tx?: DbClient
}

type RecordResultOptions = {
  planVersion?: number
  status?: FlexRunStatus
  schemaHash?: string | null
  facets?: RunContextSnapshot | null
  provenance?: Record<string, unknown> | null
  goalConditionResults?: GoalConditionResult[] | null
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
  goalConditionResults: GoalConditionResult[] | null
  postConditionResults: Array<{
    nodeId: string
    capabilityId: string | null
    guards: FacetCondition[]
    results: GoalConditionResult[]
  }> | null
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
    const execute = async (executor: DbClient) => {
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
          postConditionGuardsJson: node.postConditionGuards ? clone(node.postConditionGuards) : null,
          postConditionResultsJson: node.postConditionResults ? clone(node.postConditionResults) : null,
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
              postConditionGuardsJson: sql`excluded.post_condition_guards_json`,
              postConditionResultsJson: sql`excluded.post_condition_results_json`,
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
          postConditionGuards: node.postConditionGuards ? clone(node.postConditionGuards) : [],
          postConditionResults: node.postConditionResults ? clone(node.postConditionResults) : [],
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
              ...(options.pendingState.postConditionAttempts
                ? { postConditionAttempts: clone(options.pendingState.postConditionAttempts) }
                : {}),
              ...(options.pendingState.mode ? { mode: options.pendingState.mode } : {}),
              ...(options.pendingState.goalConditionFailures
                ? { goalConditionFailures: clone(options.pendingState.goalConditionFailures) }
                : {})
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

  async saveRunContext(runId: string, snapshot: RunContextSnapshot, options: { tx?: DbClient } = {}) {
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
    if (updates.postConditionGuards !== undefined) {
      set.postConditionGuardsJson = updates.postConditionGuards ? clone(updates.postConditionGuards) : null
    }
    if (updates.postConditionResults !== undefined) {
      set.postConditionResultsJson = updates.postConditionResults ? clone(updates.postConditionResults) : null
    }

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
        postConditionGuardsJson: updates.postConditionGuards ? clone(updates.postConditionGuards) : null,
        postConditionResultsJson: updates.postConditionResults ? clone(updates.postConditionResults) : null,
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
    const postConditionSnapshot =
      options.snapshot?.nodes && options.snapshot.nodes.length
        ? options.snapshot.nodes
            .map((node) => ({
              nodeId: node.nodeId,
              capabilityId: node.capabilityId ?? null,
              guards: node.postConditionGuards ? clone(node.postConditionGuards) : [],
              results: node.postConditionResults ? clone(node.postConditionResults) : []
            }))
            .filter((entry) => entry.guards.length || entry.results.length)
        : null
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
          goalConditionResultsJson: options.goalConditionResults ? clone(options.goalConditionResults) : null,
          postConditionResultsJson: postConditionSnapshot ? clone(postConditionSnapshot) : null,
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
            goalConditionResultsJson: sql`excluded.goal_condition_results_json`,
            postConditionResultsJson: sql`excluded.post_condition_results_json`,
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

  async recordGoalConditionCheckpoint(
    runId: string,
    context: {
      planVersion?: number
      schemaHash?: string | null
      status?: FlexRunStatus
      output?: Record<string, unknown> | null
      goalConditionResults: GoalConditionResult[]
    }
  ) {
    const now = new Date()
    const outputPayload = context.output ?? {}
    await this.db
      .insert(flexRunOutputs)
      .values({
        runId,
        planVersion: context.planVersion ?? 0,
        schemaHash: context.schemaHash ?? null,
        status: context.status ?? 'running',
        outputJson: clone(outputPayload),
        facetSnapshotJson: null,
        provenanceJson: null,
        goalConditionResultsJson: clone(context.goalConditionResults),
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
          goalConditionResultsJson: sql`excluded.goal_condition_results_json`,
          updatedAt: now
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
      goalConditionResults: (row.goalConditionResultsJson as GoalConditionResult[] | null) ?? null,
      postConditionResults:
        (row.postConditionResultsJson as FlexRunOutputRow['postConditionResults'] | null) ?? null,
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
      postConditionGuards: (node.postConditionGuardsJson as FacetCondition[] | null) ?? null,
      postConditionResults: (node.postConditionResultsJson as GoalConditionResult[] | null) ?? null,
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
        runUpdatedAt: flexRuns.updatedAt,
        runContextSnapshot: flexRuns.contextSnapshotJson,
        envelope: flexRuns.envelopeJson
      })
      .from(flexPlanNodes)
      .innerJoin(flexRuns, eq(flexPlanNodes.runId, flexRuns.runId))
      .where(eq(flexPlanNodes.status, 'awaiting_human'))

    const normalized = rows.map((row) => {
      const envelope = (row.envelope as TaskEnvelope | null | undefined) ?? null
      const context = (row.context as ContextBundle | null) ?? null
      const contextBundle = context as ExtendedContextBundle | null
      const assignment = context?.assignment ?? null
      const status =
        typeof assignment?.status === 'string' && assignment.status
          ? (assignment.status as string)
          : 'awaiting_submission'
      const facets = contextBundle?.facets ?? null
      const facetProvenance = contextBundle?.facetProvenance as FlexFacetProvenanceMap | undefined
      const contracts = contextBundle?.contracts ?? null
      const storedRunContext: RunContextSnapshot | null = contextBundle?.runContextSnapshot ?? null
      const persistedRunContext: RunContextSnapshot | null =
        (row.runContextSnapshot as RunContextSnapshot | null | undefined) ?? null
      const resolvedRunContext = storedRunContext ?? persistedRunContext ?? null
      const inputsCandidateRaw = contextBundle?.currentInputs ?? contextBundle?.inputs ?? null
      const outputsCandidateRaw = contextBundle?.currentOutput ?? contextBundle?.priorOutputs ?? null
      const assignmentMetadata =
        assignment?.metadata && typeof assignment.metadata === 'object'
          ? clone(assignment.metadata as Record<string, unknown>)
          : null
      const contextExtras: Record<string, unknown> = {}
      const resolvedRunContextInputs = stripPlannerFields(
        resolvedRunContext && facets && Array.isArray(facets.input)
          ? extractFacetValues(resolvedRunContext, facets.input)
          : {}
      )
      if (resolvedRunContextInputs && Object.keys(resolvedRunContextInputs).length) {
        contextExtras.currentInputs = ensureFacetPlaceholders(resolvedRunContextInputs, facets?.input ?? [])
      } else if (hasObjectKeys(inputsCandidateRaw)) {
        const sanitizedInputs = stripPlannerFields(inputsCandidateRaw as Record<string, unknown>)
        if (sanitizedInputs && Object.keys(sanitizedInputs).length) {
          contextExtras.currentInputs = ensureFacetPlaceholders(sanitizedInputs, facets?.input ?? [])
        }
      } else if (envelope && envelope.inputs && typeof envelope.inputs === 'object' && facets && Array.isArray(facets.input)) {
        const fallbackInputs: Record<string, unknown> = {}
        for (const facet of facets.input) {
          if (typeof facet !== 'string') continue
          const value = (envelope.inputs as Record<string, unknown>)[facet]
          if (value !== undefined) {
            fallbackInputs[facet] = clone(value)
          }
        }
        if (Object.keys(fallbackInputs).length) {
          const sanitizedInputs = stripPlannerFields(fallbackInputs)
          if (sanitizedInputs && Object.keys(sanitizedInputs).length) {
            contextExtras.currentInputs = ensureFacetPlaceholders(sanitizedInputs, facets?.input ?? [])
          }
        }
      }
      let resolvedOutputPayload: Record<string, unknown> | null = null
      if (hasObjectKeys(outputsCandidateRaw)) {
        const sanitized = stripPlannerFields(outputsCandidateRaw as Record<string, unknown>)
        if (sanitized && Object.keys(sanitized).length) {
          resolvedOutputPayload = sanitized
        }
      }

      if (!resolvedOutputPayload && assignmentMetadata && typeof assignmentMetadata.currentOutput === 'object') {
        const sanitized = stripPlannerFields(assignmentMetadata.currentOutput as Record<string, unknown>)
        if (sanitized && Object.keys(sanitized).length) {
          resolvedOutputPayload = sanitized
        }
      }

      if (resolvedOutputPayload) {
        contextExtras.currentOutput = ensureFacetPlaceholders(resolvedOutputPayload, facets?.output ?? [])
      } else if (Array.isArray(facets?.output) && facets.output.length) {
        contextExtras.currentOutput = ensureFacetPlaceholders(null, facets.output)
      }
      if (resolvedRunContext) {
        contextExtras.runContextSnapshot = clone(resolvedRunContext)
      }
      const assignedTo = assignment?.assignedTo ?? null
      const role = assignment?.role ?? null
      const dueAt = assignment?.dueAt ?? null
      const priority = assignment?.priority ?? null
      const instructions = assignment?.instructions ?? null
      const mergedMetadata = assignmentMetadata
        ? { ...assignmentMetadata, ...contextExtras }
        : Object.keys(contextExtras).length
        ? contextExtras
        : null
      const metadata = removeDuplicateMetadataAliases(mergedMetadata)
      const defaults = assignment?.defaults ? clone(assignment.defaults) : null
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

      const expectedInputFacetsSource = assignmentMetadata?.expectedInputFacets
      const expectedInputFacets = Array.isArray(expectedInputFacetsSource)
        ? (expectedInputFacetsSource as string[])
        : []
      const expectedOutputFacetsSource = assignmentMetadata?.expectedOutputFacets
      const expectedOutputFacets = Array.isArray(expectedOutputFacetsSource)
        ? (expectedOutputFacetsSource as string[])
        : []

      const normalizedFacets = (() => {
        const candidate: { input?: string[]; output?: string[] } =
          facets && typeof facets === 'object' ? clone(facets) : {}

        const ensureArray = (value: unknown): string[] =>
          Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : []

        let inputFacets = ensureArray(candidate.input)
        let outputFacets = ensureArray(candidate.output)

        const inputsCandidateValue = (contextExtras.currentInputs as Record<string, unknown> | undefined) ?? null
        const outputsCandidateValue = (contextExtras.currentOutput as Record<string, unknown> | undefined) ?? null
        const currentInputs = hasObjectKeys(inputsCandidateValue) ? inputsCandidateValue : null
        const currentOutput = hasObjectKeys(outputsCandidateValue) ? outputsCandidateValue : null
        const ignoredKeys = new Set(['plannerKind', 'plannerVariantCount', 'derivedCapability'])

        if ((!inputFacets || inputFacets.length === 0) && currentInputs) {
          inputFacets = Object.keys(currentInputs as Record<string, unknown>).filter(
            (key) => !ignoredKeys.has(key)
          )
        }

        if ((!inputFacets || inputFacets.length === 0) && envelope) {
          const envelopeInputs = resolveEnvelopeInputFacets(envelope)
          if (envelopeInputs.length) {
            inputFacets = envelopeInputs
          }
        }

        if (expectedInputFacets.length) {
          inputFacets = Array.from(new Set([...(inputFacets ?? []), ...expectedInputFacets]))
        }

        if ((!outputFacets || outputFacets.length === 0) && currentOutput) {
          outputFacets = Object.keys(currentOutput as Record<string, unknown>).filter(
            (key) => !ignoredKeys.has(key)
          )
        }

        if ((!outputFacets || outputFacets.length === 0) && envelope) {
          const envelopeOutputs = resolveEnvelopeOutputFacets(envelope)
          if (envelopeOutputs.length) {
            outputFacets = envelopeOutputs
          }
        }

        if (expectedOutputFacets.length) {
          outputFacets = Array.from(new Set([...(outputFacets ?? []), ...expectedOutputFacets]))
        }

        if (!inputFacets?.length && !outputFacets?.length) {
          return null
        }
        return {
          input: inputFacets ?? [],
          output: outputFacets ?? []
        }
      })()

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
        contracts: contracts ? clone(contracts) : null,
        facets: normalizedFacets,
        facetProvenance: facetProvenance ? clone(facetProvenance) : null,
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
    type ResumeMetadataExtras = {
      auditLog?: Array<Record<string, unknown>>
      lastResumeAt?: string
      lastOperator?: Record<string, unknown> | null
      lastResumeNote?: string | null
    }
    const metadata = (run.metadata ? clone(run.metadata) : {}) as Record<string, unknown> & ResumeMetadataExtras
    const auditLog = Array.isArray(metadata.auditLog)
      ? [...metadata.auditLog]
      : []

    auditLog.push({
      action: 'resume',
      at: now.toISOString(),
      operator: audit.operator ?? null,
      note: audit.note ?? null
    })

    metadata.auditLog = auditLog
    metadata.lastResumeAt = now.toISOString()
    if (audit.operator) {
      metadata.lastOperator = audit.operator
    }
    if (audit.note) {
      metadata.lastResumeNote = audit.note
    }

    await this.db
      .update(flexRuns)
      .set({ metadataJson: clone(metadata), updatedAt: now })
      .where(eq(flexRuns.runId, run.runId))

    try {
      const orchestratorSnapshot = await this.orchestrator.load(run.runId)
      type RunnerMetadataExtras = {
        auditLog?: Array<Record<string, unknown>>
        lastResumeAt?: string
        lastOperator?: Record<string, unknown> | null
      }
      const runnerMetadata = (orchestratorSnapshot.runnerMetadata
        ? clone(orchestratorSnapshot.runnerMetadata)
        : {}) as Record<string, unknown> & RunnerMetadataExtras
      const runnerAuditLog = Array.isArray(runnerMetadata.auditLog)
        ? [...runnerMetadata.auditLog]
        : []
      runnerAuditLog.push({
        action: 'resume',
        at: now.toISOString(),
        operator: audit.operator ?? null,
        note: audit.note ?? null
      })
      runnerMetadata.auditLog = runnerAuditLog
      runnerMetadata.lastResumeAt = now.toISOString()
      if (audit.operator) {
        runnerMetadata.lastOperator = audit.operator
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
      let metadata: Record<string, unknown> | null = null
      if (isPlainRecord(snapshotPayload)) {
        const payloadMetadata = snapshotPayload.metadata
        metadata =
          payloadMetadata && isPlainRecord(payloadMetadata)
            ? clone(payloadMetadata)
            : null
      }
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
            goalConditionResults: null,
            postConditionResults: null,
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
