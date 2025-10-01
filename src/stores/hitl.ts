import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { HitlOriginAgent, HitlRequestPayload, HitlResponseType } from '@awesomeposter/shared'

type SubmissionState = 'idle' | 'submitting' | 'success' | 'error'

interface HitlOptionView {
  id: string
  label: string
  description?: string
}

export interface HitlRequestView {
  id: string
  question: string
  kind: HitlRequestPayload['kind']
  allowFreeForm: boolean
  options: HitlOptionView[]
  originAgent: HitlOriginAgent
  urgency: HitlRequestPayload['urgency']
  additionalContext?: string
  receivedAt: Date
  createdAt?: Date
  status: 'pending' | 'submitted'
}

type OrchestratorStatus =
  | 'pending'
  | 'running'
  | 'awaiting_hitl'
  | 'completed'
  | 'cancelled'
  | 'removed'
  | 'failed'
  | null

interface PendingRunSummary {
  runId: string | null
  threadId: string | null
  pendingRequestId: string | null
  status: OrchestratorStatus
  briefId: string | null
  updatedAt: string | null
  isSuspended: boolean
}

export interface OperatorProfile {
  id?: string
  displayName?: string
  email?: string
}

function readOperatorProfileFromStorage(): OperatorProfile | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem('hitl.operator')
    if (!raw) return null
    const parsed = JSON.parse(raw) as OperatorProfile
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

interface SubmitPayload {
  responseType: HitlResponseType
  approved?: boolean
  selectedOptionId?: string
  freeformText?: string
  metadata?: Record<string, unknown>
  responderId?: string
  responderDisplayName?: string
}

const AUTH_HEADER = (() => {
  const token = import.meta.env.VITE_AGENTS_AUTH_BEARER
  if (typeof token === 'string' && token.length > 0) {
    return `Bearer ${token}`
  }
  return null
})()

export const useHitlStore = defineStore('hitl', () => {
  const activeRequest = ref<HitlRequestView | null>(null)
  const submissionState = ref<SubmissionState>('idle')
  const submissionError = ref<string | null>(null)
  const submissionNotice = ref<string | null>(null)
  const pendingRun = ref<PendingRunSummary>({
    runId: null,
    threadId: null,
    pendingRequestId: null,
    status: null,
    briefId: null,
    updatedAt: null,
    isSuspended: false
  })
  const denialNotice = ref<string | null>(null)
  const operatorProfile = ref<OperatorProfile | null>(readOperatorProfileFromStorage())

  const hasActiveRequest = computed(() => activeRequest.value !== null)
  const submitting = computed(() => submissionState.value === 'submitting')
  const hasSuspendedRun = computed(() => pendingRun.value.isSuspended && Boolean(pendingRun.value.threadId || pendingRun.value.runId))

  function resetAll() {
    activeRequest.value = null
    submissionState.value = 'idle'
    submissionError.value = null
    submissionNotice.value = null
    denialNotice.value = null
    pendingRun.value = {
      runId: null,
      threadId: null,
      pendingRequestId: null,
      status: null,
      briefId: null,
      updatedAt: null,
      isSuspended: false
    }
  }

  function setThreadId(threadId: string | null) {
    pendingRun.value.threadId = threadId
  }

  function setRunId(runId: string | null) {
    pendingRun.value.runId = runId
  }

  function startTrackingRequest(input: {
    requestId: string
    payload: HitlRequestPayload
    originAgent: HitlOriginAgent
    receivedAt?: Date
    threadId?: string | null
  }) {
    const receivedAt = input.receivedAt ?? new Date()
    pendingRun.value.pendingRequestId = input.requestId
    if (typeof input.threadId === 'string') {
      pendingRun.value.threadId = input.threadId
    }
    pendingRun.value.status = 'awaiting_hitl'
    pendingRun.value.isSuspended = true
    denialNotice.value = null
    submissionError.value = null
    submissionNotice.value = null
    submissionState.value = 'idle'

    const { options = [], allowFreeForm, question, kind, urgency, additionalContext } = input.payload
    activeRequest.value = {
      id: input.requestId,
      question,
      kind,
      allowFreeForm,
      options: options.map((option) => ({ ...option })),
      originAgent: input.originAgent,
      urgency,
      additionalContext,
      receivedAt,
      status: 'pending'
    }
  }

  function markAwaiting(requestId: string | null | undefined) {
    pendingRun.value.pendingRequestId = requestId ?? null
    if (!requestId) return
    if (activeRequest.value && activeRequest.value.id === requestId) {
      activeRequest.value.status = 'pending'
    }
  }

  function clearRequest(reason?: 'resolved' | 'reset') {
    pendingRun.value.pendingRequestId = null
    pendingRun.value.isSuspended = false
    pendingRun.value.status = reason === 'reset' ? pendingRun.value.status : null
    if (reason === 'resolved' && submissionState.value === 'success') {
      submissionNotice.value = submissionNotice.value || 'Response submitted successfully.'
    }
    activeRequest.value = null
  }

  function handleDenial(reason: string | undefined) {
    denialNotice.value = reason || 'Request denied by orchestrator.'
    pendingRun.value.pendingRequestId = null
    pendingRun.value.isSuspended = false
    pendingRun.value.status = 'cancelled'
    activeRequest.value = null
  }

  async function hydrateFromPending(options?: { threadId?: string | null; briefId?: string | null; force?: boolean }) {
    const targetThreadId = options?.threadId ?? pendingRun.value.threadId
    const targetBriefId = options?.briefId ?? pendingRun.value.briefId
    const hasIdentifiers = Boolean(pendingRun.value.pendingRequestId || targetThreadId || targetBriefId)
    if (!hasIdentifiers && !options?.force) return
    try {
      const res = await fetch('/api/hitl/pending', {
        headers: buildHeaders()
      })
      if (!res.ok) return
      const payload = await res.json().catch(() => null)
      const runs: Array<{
        runId: string
        threadId: string | null
        briefId?: string | null
        pendingRequestId: string | null
        status?: OrchestratorStatus
        updatedAt?: string | Date | null
        pendingRequest?: {
          id: string
          createdAt?: string
          payload?: HitlRequestPayload
          originAgent?: HitlOriginAgent
        }
      }> = Array.isArray(payload?.runs) ? payload.runs : []

      const match = runs.find((run) => {
        if (pendingRun.value.pendingRequestId && run.pendingRequestId === pendingRun.value.pendingRequestId) return true
        if (targetThreadId && run.threadId === targetThreadId) return true
        if (targetBriefId && run.briefId === targetBriefId) return true
        return false
      })

      if (!match) {
        if (options?.force) {
          pendingRun.value = {
            runId: null,
            threadId: targetThreadId ?? null,
            pendingRequestId: null,
            status: null,
            briefId: targetBriefId ?? null,
            updatedAt: null,
            isSuspended: false
          }
          activeRequest.value = null
        }
        return
      }

      pendingRun.value.runId = match.runId ?? null
      pendingRun.value.threadId = match.threadId ?? null
      pendingRun.value.briefId = match.briefId ?? pendingRun.value.briefId ?? null
      pendingRun.value.pendingRequestId = match.pendingRequestId ?? match.pendingRequest?.id ?? pendingRun.value.pendingRequestId
      pendingRun.value.status = (match.status as OrchestratorStatus) ?? pendingRun.value.status ?? null
      pendingRun.value.updatedAt = typeof match.updatedAt === 'string'
        ? match.updatedAt
        : match.updatedAt instanceof Date
          ? match.updatedAt.toISOString()
          : pendingRun.value.updatedAt
      pendingRun.value.isSuspended = pendingRun.value.status === 'awaiting_hitl'

      if (match.pendingRequest) {
        const createdAtValue = match.pendingRequest.createdAt ? new Date(match.pendingRequest.createdAt) : undefined
        const payload = match.pendingRequest.payload
        const existing = activeRequest.value
        const sameRequest = existing && existing.id === match.pendingRequest.id
        const preserveSubmission = sameRequest && submissionState.value === 'success'

        if (!preserveSubmission) {
          submissionState.value = 'idle'
          submissionError.value = null
          submissionNotice.value = preserveSubmission ? submissionNotice.value : null
          denialNotice.value = null
        }

        if (!existing || !sameRequest) {
          activeRequest.value = {
            id: match.pendingRequest.id,
            question: payload?.question ?? existing?.question ?? '',
            kind: payload?.kind ?? existing?.kind ?? 'approval',
            allowFreeForm: payload?.allowFreeForm ?? existing?.allowFreeForm ?? false,
            options: (payload?.options ?? existing?.options ?? []).map((option) => ({ ...option })),
            originAgent: match.pendingRequest.originAgent ?? existing?.originAgent ?? 'strategy',
            urgency: payload?.urgency ?? existing?.urgency ?? 'normal',
            additionalContext: payload?.additionalContext,
            receivedAt: createdAtValue ?? new Date(),
            createdAt: createdAtValue,
            status: preserveSubmission ? 'submitted' : 'pending'
          }
        } else {
          if (createdAtValue) {
            existing.createdAt = createdAtValue
          }
          if (payload) {
            existing.question = payload.question
            existing.options = (payload.options ?? []).map((option) => ({ ...option }))
            existing.kind = payload.kind
            existing.allowFreeForm = Boolean(payload.allowFreeForm)
            existing.urgency = payload.urgency
            existing.additionalContext = payload.additionalContext
          }
          if (match.pendingRequest.originAgent) {
            existing.originAgent = match.pendingRequest.originAgent
          }
          existing.status = preserveSubmission ? 'submitted' : 'pending'
        }
      }
    } catch (err) {
      console.warn('[hitl-store] failed to hydrate pending request', err)
    }
  }

  async function submitResponse(payload: SubmitPayload) {
    if (!activeRequest.value) return
    if (!pendingRun.value.pendingRequestId) return
    if (!pendingRun.value.threadId && !pendingRun.value.runId) {
      await hydrateFromPending({ force: true })
    }

    submissionError.value = null
    submissionNotice.value = null
    submissionState.value = 'submitting'

    try {
      const operator = buildOperator()
      const body = {
        requestId: activeRequest.value.id,
        runId: pendingRun.value.runId ?? undefined,
        threadId: pendingRun.value.threadId ?? undefined,
        responses: [
          {
            requestId: activeRequest.value.id,
            responseType: payload.responseType,
            approved: payload.approved,
            selectedOptionId: payload.selectedOptionId,
            freeformText: payload.freeformText,
            metadata: payload.metadata,
            responderId: payload.responderId ?? operator?.id,
            responderDisplayName: payload.responderDisplayName ?? operator?.displayName
          }
        ],
        operator: operator ?? undefined
      }

      const res = await fetch('/api/hitl/resume', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...buildHeaders()
        },
        body: JSON.stringify(body)
      })

      if (!res.ok) {
        const errBody = await res.json().catch(() => null)
        const msg = errBody?.statusMessage || errBody?.error || `Request failed (${res.status})`
        throw new Error(msg)
      }

      submissionState.value = 'success'
      submissionNotice.value = 'Response submitted. Waiting for orchestrator to resume.'
      if (activeRequest.value) {
        activeRequest.value.status = 'submitted'
      }
    } catch (err: unknown) {
      submissionState.value = 'error'
      submissionError.value = err instanceof Error ? err.message : 'Failed to submit response.'
    }
  }

  function buildHeaders() {
    const headers: Record<string, string> = {}
    if (AUTH_HEADER) headers.authorization = AUTH_HEADER
    return headers
  }

  function buildOperator(): OperatorProfile | null {
    const profile = operatorProfile.value
    if (!profile) return null
    const { id, displayName, email } = profile
    if (!id && !displayName && !email) return null
    return { id, displayName, email }
  }

  function setOperatorProfile(profile: OperatorProfile | null) {
    operatorProfile.value = profile
    if (typeof window === 'undefined') return
    try {
      if (!profile || (!profile.id && !profile.displayName && !profile.email)) {
        window.localStorage.removeItem('hitl.operator')
      } else {
        window.localStorage.setItem('hitl.operator', JSON.stringify(profile))
      }
    } catch {
      // ignore persistence errors (private browsing, etc.)
    }
  }

  async function removePendingRun(input: { reason: string; note?: string }) {
    const { reason, note } = input
    if (!reason || reason.trim().length === 0) {
      throw new Error('Removal reason is required')
    }

    if (!pendingRun.value.runId && !pendingRun.value.threadId) {
      await hydrateFromPending({ force: true })
    }

    if (!pendingRun.value.runId && !pendingRun.value.threadId) {
      throw new Error('No suspended run detected for removal')
    }

    const operator = buildOperator()
    const body = {
      runId: pendingRun.value.runId ?? undefined,
      threadId: pendingRun.value.threadId ?? undefined,
      requestId: pendingRun.value.pendingRequestId ?? undefined,
      reason: reason.trim(),
      note,
      operator: operator ?? undefined
    }

    const res = await fetch('/api/hitl/remove', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildHeaders()
      },
      body: JSON.stringify(body)
    })

    if (!res.ok) {
      const errBody = await res.json().catch(() => null)
      const msg = errBody?.statusMessage || errBody?.error || `Removal failed (${res.status})`
      throw new Error(msg)
    }

    resetAll()
    return res.json().catch(() => ({ ok: true }))
  }

  return {
    activeRequest,
    hasActiveRequest,
    submitting,
    hasSuspendedRun,
    submissionState,
    submissionError,
    submissionNotice,
    denialNotice,
    pendingRun,
    operatorProfile,
    resetAll,
    setThreadId,
    setRunId,
    startTrackingRequest,
    markAwaiting,
    clearRequest,
    handleDenial,
    hydrateFromPending,
    submitResponse,
    setOperatorProfile,
    removePendingRun
  }
})
