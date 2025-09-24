import {
  HitlRequestRecord,
  HitlRequestStatus,
  HitlResponse,
  HitlRunState
} from '@awesomeposter/shared'

export interface HitlRepository {
  create(request: HitlRequestRecord): Promise<void>
  updateStatus(requestId: string, status: HitlRequestStatus, updates?: { denialReason?: string }): Promise<void>
  appendResponse(response: HitlResponse): Promise<void>
  getRequestById(requestId: string): Promise<HitlRequestRecord | undefined>
  getRunState(runId: string): Promise<HitlRunState>
  setRunState(runId: string, state: HitlRunState): Promise<void>
}

class InMemoryHitlRepository implements HitlRepository {
  private requests = new Map<string, HitlRequestRecord>()
  private responses = new Map<string, HitlResponse[]>()
  private runSnapshots = new Map<string, HitlRunState>()

  async create(request: HitlRequestRecord): Promise<void> {
    this.requests.set(request.id, request)
    const state = await this.getRunState(request.runId)
    const existing = state.requests.filter((r) => r.id !== request.id)
    const nextState: HitlRunState = {
      ...state,
      requests: [...existing, request],
      pendingRequestId: request.status === 'pending' ? request.id : state.pendingRequestId,
      deniedCount: state.deniedCount + (request.status === 'denied' ? 1 : 0)
    }
    this.runSnapshots.set(request.runId, nextState)
  }

  async updateStatus(requestId: string, status: HitlRequestStatus, updates?: { denialReason?: string }): Promise<void> {
    const record = this.requests.get(requestId)
    if (!record) return
    const updated: HitlRequestRecord = {
      ...record,
      status,
      denialReason: updates?.denialReason,
      updatedAt: new Date()
    }
    this.requests.set(requestId, updated)
    const state = await this.getRunState(record.runId)
    const requests = state.requests.map((req) => (req.id === requestId ? updated : req))
    const deniedCount = requests.filter((req) => req.status === 'denied').length
    const pendingId = status === 'pending' ? requestId : (state.pendingRequestId === requestId ? null : state.pendingRequestId ?? null)
    this.runSnapshots.set(record.runId, { ...state, requests, pendingRequestId: pendingId, deniedCount })
  }

  async appendResponse(response: HitlResponse): Promise<void> {
    const clone = { ...response }
    const list = this.responses.get(response.requestId) || []
    list.push(clone)
    this.responses.set(response.requestId, list)
    const req = this.requests.get(response.requestId)
    if (req) {
      await this.updateStatus(response.requestId, 'resolved')
      const state = await this.getRunState(req.runId)
      this.runSnapshots.set(req.runId, {
        ...state,
        responses: [...state.responses, clone],
        pendingRequestId: state.pendingRequestId === req.id ? null : state.pendingRequestId ?? null
      })
    }
  }

  async getRequestById(requestId: string): Promise<HitlRequestRecord | undefined> {
    const record = this.requests.get(requestId)
    return record ? { ...record } : undefined
  }

  async getRunState(runId: string): Promise<HitlRunState> {
    const snap = this.runSnapshots.get(runId)
    if (!snap) {
      const empty: HitlRunState = { requests: [], responses: [], pendingRequestId: null, deniedCount: 0 }
      this.runSnapshots.set(runId, empty)
      return empty
    }
    return {
      requests: snap.requests.map((r) => ({ ...r })),
      responses: snap.responses.map((r) => ({ ...r })),
      pendingRequestId: snap.pendingRequestId ?? null,
      deniedCount: snap.deniedCount
    }
  }

  async setRunState(runId: string, state: HitlRunState): Promise<void> {
    this.runSnapshots.set(runId, {
      requests: state.requests.map((r) => ({ ...r })),
      responses: state.responses.map((r) => ({ ...r })),
      pendingRequestId: state.pendingRequestId ?? null,
      deniedCount: state.deniedCount
    })
    for (const req of state.requests) {
      this.requests.set(req.id, { ...req })
    }
    for (const resp of state.responses) {
      const list = this.responses.get(resp.requestId) || []
      list.push({ ...resp })
      this.responses.set(resp.requestId, list)
    }
  }
}

let activeRepository: HitlRepository | null = null

export function getHitlRepository(): HitlRepository {
  if (!activeRepository) {
    activeRepository = new InMemoryHitlRepository()
  }
  return activeRepository
}

export function setHitlRepository(repo: HitlRepository) {
  activeRepository = repo
}

export function resetHitlRepository() {
  activeRepository = new InMemoryHitlRepository()
}
