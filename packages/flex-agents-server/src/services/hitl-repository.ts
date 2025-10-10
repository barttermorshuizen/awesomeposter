import {
  HitlRequestRecord,
  HitlRequestStatus,
  HitlResponse,
  HitlRunState,
  HitlResponseType
} from '@awesomeposter/shared'
import { getDb, hitlRequests, hitlResponses, eq } from '@awesomeposter/db'
import { asc, inArray } from 'drizzle-orm'
import { getOrchestratorPersistence } from './orchestrator-persistence'

export interface HitlRepository {
  create(request: HitlRequestRecord): Promise<void>
  updateStatus(requestId: string, status: HitlRequestStatus, updates?: { denialReason?: string }): Promise<void>
  appendResponse(response: HitlResponse): Promise<void>
  getRequestById(requestId: string): Promise<HitlRequestRecord | undefined>
  getRunState(runId: string): Promise<HitlRunState>
  setRunState(runId: string, state: HitlRunState): Promise<void>
}

const EMPTY_STATE: HitlRunState = { requests: [], responses: [], pendingRequestId: null, deniedCount: 0 }

const globalStructuredClone: (<T>(value: T) => T) | undefined = (globalThis as any).structuredClone

function clone<T>(value: T): T {
  if (value == null) return value
  try {
    if (typeof globalStructuredClone === 'function') return globalStructuredClone(value)
  } catch {}
  return JSON.parse(JSON.stringify(value))
}

export class DatabaseHitlRepository implements HitlRepository {
  private db
  private persistence

  constructor(dbInstance = getDb(), persistenceInstance = getOrchestratorPersistence()) {
    this.db = dbInstance
    this.persistence = persistenceInstance
  }

  async create(request: HitlRequestRecord): Promise<void> {
    await this.persistence.ensure(request.runId)
    const snapshot = await this.persistence.load(request.runId)
    await this.db
      .insert(hitlRequests)
      .values({
        id: request.id,
        runId: request.runId,
        briefId: snapshot.briefId ?? null,
        threadId: request.threadId ?? null,
        stepId: request.stepId ?? null,
        originAgent: request.originAgent,
        status: request.status,
        payloadJson: clone(request.payload),
        denialReason: request.denialReason ?? null,
        metricsJson: request.metrics ? clone(request.metrics) : {},
        createdAt: request.createdAt,
        updatedAt: request.updatedAt
      })
      .onConflictDoUpdate({
        target: hitlRequests.id,
        set: {
          status: request.status,
          payloadJson: clone(request.payload),
          denialReason: request.denialReason ?? null,
          metricsJson: request.metrics ? clone(request.metrics) : {},
          updatedAt: request.updatedAt
        }
      })
  }

  async updateStatus(requestId: string, status: HitlRequestStatus, updates?: { denialReason?: string }): Promise<void> {
    const now = new Date()
    await this.db
      .update(hitlRequests)
      .set({ status, denialReason: updates?.denialReason ?? null, updatedAt: now })
      .where(eq(hitlRequests.id, requestId))

    const record = await this.getRequestById(requestId)
    if (!record) return

    const state = await this.getRunState(record.runId)
    const nextRequests = state.requests.map((req) =>
      req.id === requestId
        ? {
            ...req,
            status,
            denialReason: updates?.denialReason,
            updatedAt: now
          }
        : req
    )
    const pendingId = nextRequests.find((req) => req.status === 'pending')?.id ?? null
    const nextState: HitlRunState = {
      requests: nextRequests,
      responses: [...state.responses],
      pendingRequestId: pendingId,
      deniedCount: nextRequests.filter((req) => req.status === 'denied').length
    }
    await this.setRunState(record.runId, nextState)
  }

  async appendResponse(response: HitlResponse): Promise<void> {
    const request = await this.getRequestById(response.requestId)
    if (!request) return

    await this.db.insert(hitlResponses).values({
      id: response.id,
      requestId: response.requestId,
      responseType: response.responseType,
      selectedOptionId: response.selectedOptionId ?? null,
      freeformText: response.freeformText ?? null,
      approved: response.approved ?? null,
      responderId: response.responderId ?? null,
      responderDisplayName: response.responderDisplayName ?? null,
      metadataJson: response.metadata ? clone(response.metadata) : {},
      createdAt: response.createdAt
    })

    await this.db
      .update(hitlRequests)
      .set({ status: 'resolved', updatedAt: new Date(response.createdAt) })
      .where(eq(hitlRequests.id, response.requestId))

    const updatedState = await this.getRunState(request.runId)
    await this.setRunState(request.runId, updatedState)
  }

  async getRequestById(requestId: string): Promise<HitlRequestRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(hitlRequests)
      .where(eq(hitlRequests.id, requestId))
      .limit(1)
    if (!row) return undefined
    return this.mapRequest(row)
  }

  async getRunState(runId: string): Promise<HitlRunState> {
    await this.persistence.ensure(runId)
    const snapshot = await this.persistence.load(runId)
    const requestRows = await this.db
      .select()
      .from(hitlRequests)
      .where(eq(hitlRequests.runId, runId))
      .orderBy(asc(hitlRequests.createdAt))
    const responseRows = requestRows.length
      ? await this.db
          .select()
          .from(hitlResponses)
          .where(inArray(hitlResponses.requestId, requestRows.map((row) => row.id)))
          .orderBy(asc(hitlResponses.createdAt))
      : []

    const requests = requestRows.map((row) => this.mapRequest(row))
    const responses = responseRows.map((row) => this.mapResponse(row))

    const pendingFromRequests = requests.find((req) => req.status === 'pending')?.id ?? null
    const fallbackPending = snapshot.pendingRequestId
      ? requests.find((req) => req.id === snapshot.pendingRequestId && req.status === 'pending')?.id ?? null
      : null
    const pendingRequestId = pendingFromRequests ?? fallbackPending ?? null

    return {
      requests,
      responses,
      pendingRequestId,
      deniedCount: requests.filter((req) => req.status === 'denied').length
    }
  }

  async setRunState(runId: string, state: HitlRunState): Promise<void> {
    const snapshot = await this.persistence.load(runId)
    const nextStatus = state.pendingRequestId
      ? 'awaiting_hitl'
      : snapshot.status === 'awaiting_hitl' || snapshot.status === 'pending'
      ? 'running'
      : snapshot.status
    await this.persistence.save(runId, {
      hitlState: state,
      pendingRequestId: state.pendingRequestId ?? null,
      status: nextStatus
    })
  }

  private mapRequest(row: typeof hitlRequests.$inferSelect): HitlRequestRecord {
    const metrics = row.metricsJson ? clone(row.metricsJson) as Record<string, unknown> : undefined
    return {
      id: row.id,
      runId: row.runId,
      threadId: row.threadId ?? undefined,
      stepId: row.stepId ?? undefined,
      stepStatusAtRequest: undefined,
      originAgent: row.originAgent as HitlRequestRecord['originAgent'],
      payload: clone(row.payloadJson) as HitlRequestRecord['payload'],
      status: row.status as HitlRequestStatus,
      denialReason: row.denialReason ?? undefined,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
      metrics: metrics && Object.keys(metrics).length > 0 ? metrics : undefined
    }
  }

  private mapResponse(row: typeof hitlResponses.$inferSelect): HitlResponse {
    const metadata = row.metadataJson ? (clone(row.metadataJson) as Record<string, unknown>) : undefined
    return {
      id: row.id,
      requestId: row.requestId,
      responseType: row.responseType as HitlResponseType,
      selectedOptionId: row.selectedOptionId ?? undefined,
      freeformText: row.freeformText ?? undefined,
      approved: row.approved ?? undefined,
      responderId: row.responderId ?? undefined,
      responderDisplayName: row.responderDisplayName ?? undefined,
      createdAt: new Date(row.createdAt),
      metadata: metadata && Object.keys(metadata).length > 0 ? metadata : undefined
    }
  }
}

export class InMemoryHitlRepository implements HitlRepository {
  private requests = new Map<string, HitlRequestRecord>()
  private responses = new Map<string, HitlResponse[]>()
  private runSnapshots = new Map<string, HitlRunState>()

  async create(request: HitlRequestRecord): Promise<void> {
    this.requests.set(request.id, clone(request))
    const state = await this.getRunState(request.runId)
    const others = state.requests.filter((r) => r.id !== request.id)
    this.runSnapshots.set(request.runId, {
      requests: [...others, clone(request)],
      responses: [...state.responses],
      pendingRequestId: request.status === 'pending' ? request.id : state.pendingRequestId,
      deniedCount: state.deniedCount + (request.status === 'denied' ? 1 : 0)
    })
  }

  async updateStatus(requestId: string, status: HitlRequestStatus, updates?: { denialReason?: string }): Promise<void> {
    const record = this.requests.get(requestId)
    if (!record) return
    const next: HitlRequestRecord = { ...record, status, denialReason: updates?.denialReason, updatedAt: new Date() }
    this.requests.set(requestId, next)
    const state = await this.getRunState(record.runId)
    const requests = state.requests.map((req) => (req.id === requestId ? next : req))
    const pendingId = requests.find((req) => req.status === 'pending')?.id ?? null
    this.runSnapshots.set(record.runId, {
      requests,
      responses: state.responses.map((r) => ({ ...r })),
      pendingRequestId: pendingId,
      deniedCount: requests.filter((req) => req.status === 'denied').length
    })
  }

  async appendResponse(response: HitlResponse): Promise<void> {
    const list = this.responses.get(response.requestId) || []
    list.push(clone(response))
    this.responses.set(response.requestId, list)
    const request = this.requests.get(response.requestId)
    if (!request) return
    await this.updateStatus(response.requestId, 'resolved')
    const state = await this.getRunState(request.runId)
    this.runSnapshots.set(request.runId, {
      ...state,
      responses: [...state.responses, clone(response)],
      pendingRequestId: state.pendingRequestId === response.requestId ? null : state.pendingRequestId
    })
  }

  async getRequestById(requestId: string): Promise<HitlRequestRecord | undefined> {
    const record = this.requests.get(requestId)
    return record ? clone(record) : undefined
  }

  async getRunState(runId: string): Promise<HitlRunState> {
    const snap = this.runSnapshots.get(runId)
    if (!snap) {
      this.runSnapshots.set(runId, clone(EMPTY_STATE))
      return clone(EMPTY_STATE)
    }
    return {
      requests: snap.requests.map((r) => clone(r)),
      responses: snap.responses.map((r) => clone(r)),
      pendingRequestId: snap.pendingRequestId ?? null,
      deniedCount: snap.deniedCount
    }
  }

  async setRunState(runId: string, state: HitlRunState): Promise<void> {
    this.runSnapshots.set(runId, {
      requests: state.requests.map((r) => clone(r)),
      responses: state.responses.map((r) => clone(r)),
      pendingRequestId: state.pendingRequestId ?? null,
      deniedCount: state.deniedCount
    })
    for (const request of state.requests) {
      this.requests.set(request.id, clone(request))
    }
    for (const response of state.responses) {
      const list = this.responses.get(response.requestId) || []
      list.push(clone(response))
      this.responses.set(response.requestId, list)
    }
  }
}

let activeRepository: HitlRepository | null = null

export function getHitlRepository(): HitlRepository {
  if (!activeRepository) {
    if (process.env.DATABASE_URL) {
      try {
        activeRepository = new DatabaseHitlRepository()
      } catch {
        activeRepository = new InMemoryHitlRepository()
      }
    } else {
      activeRepository = new InMemoryHitlRepository()
    }
  }
  return activeRepository
}

export function setHitlRepository(repo: HitlRepository) {
  activeRepository = repo
}

export function resetHitlRepository() {
  activeRepository = new InMemoryHitlRepository()
}
