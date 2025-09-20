<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, nextTick } from 'vue'
import type { AgentRunRequest, AgentEvent, Asset, FinalBundle, FinalQuality, PendingApproval } from '@awesomeposter/shared'
import { postEventStream, type AgentEventWithId } from '@/lib/agent-sse'
import { AGENTS_BASE_URL, AGENTS_AUTH } from '@/lib/agents-api'
import KnobSettingsDisplay from './KnobSettingsDisplay.vue'
import QualityReportDisplay from './QualityReportDisplay.vue'

type BriefInput = {
  id: string
  clientId: string
  title: string | null
  description?: string | null
  objective?: string | null
  audienceId?: string | null
} | null

interface Props {
  modelValue: boolean
  brief: BriefInput
}

interface Emits {
  (e: 'update:modelValue', v: boolean): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const isOpen = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit('update:modelValue', v)
})

// Run state
const running = ref(false)
const frames = ref<Array<{ id?: string; type: AgentEvent['type']; data: AgentEventWithId; t: number }>>([])
const correlationId = ref<string | undefined>(undefined)
const errorMsg = ref<string | null>(null)
const backlog = ref<{ busy: boolean; retryAfter: number; pending: number; limit: number }>({ busy: false, retryAfter: 0, pending: 0, limit: 0 })

// Plan state (from plan_update frames)
type PlanStep = { id: string; capabilityId?: string; action?: string; label?: string; status: 'pending'|'in_progress'|'done'|'skipped'; note?: string }
type PlanState = { version: number; steps: PlanStep[] }
const plan = ref<PlanState | null>(null)

// Streaming handle
let streamHandle: { abort: () => void; done: Promise<void> } | null = null

// Final result payload (FinalBundle mapped to legacy AppResult-like shape for this view)
type AppResultView = {
  result: { content: string; platform: string }
  rationale?: string | null
  knobSettings?: unknown
  ['quality-report']?: unknown
}
const appResult = ref<AppResultView | null>(null)

type ApprovalTrailItem = PendingApproval & { startedAt?: number; decidedAt?: number }

// Watch dialog open/close
watch(isOpen, async (open) => {
  if (open) {
    reset()
    await startRun()
  } else {
    stopRun()
  }
})

onBeforeUnmount(() => stopRun())

function reset() {
  frames.value = []
  correlationId.value = undefined
  errorMsg.value = null
  backlog.value = { busy: false, retryAfter: 0, pending: 0, limit: 0 }
  appResult.value = null
  plan.value = null
}

function close() {
  isOpen.value = false
}

function stopRun() {
  running.value = false
  try { streamHandle?.abort() } catch {}
  streamHandle = null
}

function genCid(): string {
  // lightweight CID for local correlation
  return 'cid_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
}

function safeJson(v: unknown) {
  try { return JSON.stringify(v, null, 2) } catch { return String(v) }
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object'
}
function isFinalBundle(v: unknown): v is FinalBundle {
  return isRecord(v) && 'result' in v && 'quality' in v
}
function pickBriefObjective(brief: { objective?: string | null; description?: string | null } | null | undefined) {
  const obj = (brief?.objective || '').trim()
  if (obj) return obj
  const desc = (brief?.description || '').trim()
  if (desc) return `Create high-quality social post variants based on: ${desc}`
  return 'Create high-quality social post variants.'
}
function buildCompleteObjective(context: {
  brief: {
    id?: string
    title?: string | null
    description?: string | null
    objective?: string | null
    audienceId?: string | null
  }
  clientProfile: Record<string, unknown>
  assets: Array<Pick<Asset, 'id' | 'filename' | 'originalName' | 'url' | 'type' | 'mimeType' | 'fileSize'>>
}): string {
  const goal = pickBriefObjective(context.brief)

  const lines: string[] = []
  lines.push(
    goal,
    '',
    'Context (domain-agnostic; do not assume any database access):'
  )
  lines.push('Client Profile:')
  lines.push(safeJson(context.clientProfile))
  lines.push('')
  lines.push('Brief:')
  lines.push(safeJson({
    id: context.brief.id,
    title: context.brief.title || '',
    description: context.brief.description || '',
    objective: context.brief.objective || '',
    audienceId: context.brief.audienceId || undefined
  }))
  lines.push('')
  lines.push('Assets (use if relevant):')
  lines.push(safeJson(context.assets))
  return lines.join('\n')
}

async function startRun() {
  if (!props.brief?.id || !props.brief?.clientId) {
    errorMsg.value = 'No brief selected'
    return
  }
  running.value = true
  const cid = genCid()

  try {
    // 1) Load client profile
    const profRes = await fetch(`/api/clients/${props.brief.clientId}/profile`, {
      headers: { accept: 'application/json' }
    })
    const profData = await profRes.json().catch(() => ({}))
    if (!profRes.ok || profData?.ok !== true) {
      throw new Error(profData?.statusMessage || profData?.error || 'Failed to load client profile')
    }

    // 2) Load full brief
    const briefRes = await fetch(`/api/briefs/${props.brief.id}`, {
      headers: { accept: 'application/json' }
    })
    const briefData = await briefRes.json().catch(() => ({}))
    if (!briefRes.ok || briefData?.ok !== true || !briefData?.brief) {
      throw new Error(briefData?.statusMessage || briefData?.error || 'Failed to load brief details')
    }
    const briefFull = briefData.brief as {
      id: string
      title?: string | null
      description?: string | null
      objective?: string | null
      audienceId?: string | null
    }

    // 3) Load assets (best-effort)
    let briefAssets: Asset[] = []
    try {
      const assetsRes = await fetch(`/api/briefs/${props.brief.id}/assets`, {
        headers: { accept: 'application/json' }
      })
      const assetsData = await assetsRes.json().catch(() => ({}))
      if (assetsRes.ok && Array.isArray(assetsData?.assets)) {
        briefAssets = assetsData.assets as Asset[]
      }
    } catch {
      // ignore asset load failure
    }

    // 4) Build complete objective (no briefId)
    const objective = buildCompleteObjective({
      brief: {
        id: briefFull.id,
        title: (briefFull.title ?? props.brief.title) || '',
        description: (typeof briefFull.description === 'string' && briefFull.description.trim().length > 0)
          ? briefFull.description
          : (props.brief.description || ''),
        objective: (briefFull.objective ?? props.brief.objective) || '',
        audienceId: (briefFull.audienceId ?? props.brief.audienceId) || undefined
      },
      clientProfile: {
        clientName: profData.profile?.clientName,
        primaryCommunicationLanguage: profData.profile?.primaryLanguage,
        objectives: profData.profile?.objectives || {},
        audiences: profData.profile?.audiences || {},
        tone: profData.profile?.tone || {},
        specialInstructions: profData.profile?.specialInstructions || {},
        guardrails: profData.profile?.guardrails || {},
        platformPrefs: profData.profile?.platformPrefs || {}
      },
      assets: (briefAssets || []).map((a) => ({
        id: a.id,
        filename: a.filename,
        originalName: a.originalName,
        url: a.url,
        type: a.type,
        mimeType: a.mimeType,
        fileSize: a.fileSize
      }))
    })

    const body: AgentRunRequest = {
      mode: 'app',
      objective,
      options: {
        schemaName: 'AppResult'
      }
    }

    const url = `${AGENTS_BASE_URL}/api/v1/agent/run.stream`
    const headers: Record<string, string> = {
      'x-correlation-id': cid
    }
    if (AGENTS_AUTH) headers['authorization'] = `Bearer ${AGENTS_AUTH}`

    streamHandle = postEventStream({
      url,
      body,
      headers,
      onCorrelationId: (cidFromServer) => { correlationId.value = cidFromServer },
      onBackoff: ({ retryAfter, pending, limit }) => {
        backlog.value = { busy: true, retryAfter, pending: pending || 0, limit: limit || 0 }
      },
      onEvent: (evt) => {
        const now = Date.now()
        frames.value.push({ id: evt.id, type: evt.type, data: evt, t: now })
        if (!correlationId.value && typeof evt.correlationId === 'string') {
          correlationId.value = evt.correlationId
        }
        switch (evt.type) {
          case 'plan_update': {
            try {
              const d = evt.data as unknown
              if (isRecord(d)) {
                const p = d['plan']
                if (isRecord(p)) {
                  const steps = p['steps']
                  if (Array.isArray(steps)) {
                    const versionRaw = p['version']
                    const version = typeof versionRaw === 'number' ? versionRaw : Number(versionRaw || 0)
                    plan.value = { version, steps: steps as PlanStep[] }
                  }
                }
              }
            } catch {}
            break
          }
          case 'warning':
            // keep running
            break
          case 'error':
            running.value = false
            errorMsg.value = evt.message || 'Unknown error'
            break
          case 'complete': {
            running.value = false
            const dUnknown = evt.data as unknown
            // If FinalBundle, map to AppResult-like shape for this UI
            if (isFinalBundle(dUnknown)) {
              const rRaw = dUnknown.result as unknown
              const quality: FinalQuality | null = (dUnknown as FinalBundle).quality ?? null
              try { console.groupCollapsed('[AgentResultsPopup] complete frame'); console.log('quality:', quality); console.log('quality.metrics:', quality?.metrics); console.groupEnd(); } catch {}

              let content = ''
              let platform = 'generic'
              let rationale: string | null = null
              let knobSettings: unknown
              if (isRecord(rRaw)) {
                if (typeof rRaw.content === 'string') content = rRaw.content
                if (typeof rRaw.platform === 'string') platform = rRaw.platform
                if (typeof rRaw.rationale === 'string') rationale = rRaw.rationale
                if ('knobSettings' in rRaw) knobSettings = (rRaw as Record<string, unknown>)['knobSettings']
              }

              const mapped: AppResultView = {
                result: { content, platform },
                rationale,
                knobSettings
              }
              if (quality && typeof quality === 'object') {
                const qm = (quality.metrics ?? {}) as Record<string, unknown>
                mapped['quality-report'] = {
                  composite: typeof quality.score === 'number' ? quality.score : null,
                  compliance: typeof quality.pass === 'boolean' ? quality.pass : undefined,
                  // Flattened metrics for the display component
                  readability: typeof qm.readability === 'number' ? (qm.readability as number) : undefined,
                  clarity: typeof qm.clarity === 'number' ? (qm.clarity as number) : undefined,
                  objectiveFit: typeof qm.objectiveFit === 'number' ? (qm.objectiveFit as number) : undefined,
                  brandRisk: typeof qm.brandRisk === 'number' ? (qm.brandRisk as number) : undefined,
                  // Also keep nested metrics for resilience
                  metrics: {
                    readability: typeof qm.readability === 'number' ? (qm.readability as number) : undefined,
                    clarity: typeof qm.clarity === 'number' ? (qm.clarity as number) : undefined,
                    objectiveFit: typeof qm.objectiveFit === 'number' ? (qm.objectiveFit as number) : undefined,
                    brandRisk: typeof qm.brandRisk === 'number' ? (qm.brandRisk as number) : undefined,
                  }
                }
              }
              appResult.value = mapped
              try { console.log('[AgentResultsPopup] mapped quality-report:', mapped['quality-report']) } catch {}
            } else {
              // Fallback: assume legacy AppResult shape
              appResult.value = (evt.data as AppResultView) ?? null
            }
            break
          }
        }
      }
    })
    await streamHandle.done
  } catch (err: unknown) {
    running.value = false
    errorMsg.value = err instanceof Error ? err.message : String(err)
  } finally {
    streamHandle = null
  }
}

function retry() {
  if (running.value) return
  backlog.value = { busy: false, retryAfter: 0, pending: 0, limit: 0 }
  appResult.value = null
  startRun()
}

function downloadJson() {
  const payload = {
    correlationId: correlationId.value,
    frames: frames.value.map(f => f.data),
    appResult: appResult.value
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const safeTitle = (props.brief?.title || 'results').replace(/[^a-z0-9-_]+/gi, '_')
  a.href = url
  a.download = `agents_run_${safeTitle}.json`
  a.click()
  URL.revokeObjectURL(url)
}


function dotColor(type: string) {
  switch (type) {
    case 'start': return 'primary'
    case 'phase': return 'secondary'
    case 'delta':
    case 'message':
    case 'data': return 'info'
    case 'tool_call': return 'warning'
    case 'tool_result': return 'success'
    case 'handoff': return 'purple'
    case 'metrics': return 'teal'
    case 'warning': return 'orange'
    case 'error': return 'red'
    case 'complete': return 'green'
    default: return 'default'
  }
}

function stringify(v: unknown) {
  try { return JSON.stringify(v, null, 2) } catch { return String(v) }
}

const ORIGIN_CAPABILITIES = ['strategy', 'generation', 'qa'] as const

function normalizeOriginCapability(value: unknown): PendingApproval['originCapabilityId'] | undefined {
  if (typeof value !== 'string') return undefined
  return (ORIGIN_CAPABILITIES as readonly string[]).includes(value)
    ? (value as PendingApproval['originCapabilityId'])
    : undefined
}

function normalizePendingFromFrame(raw: unknown, fallbackId?: string): PendingApproval | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const checkpointId = typeof obj.checkpointId === 'string' ? obj.checkpointId : fallbackId
  const reason = typeof obj.reason === 'string' ? obj.reason : undefined
  const requestedBy = typeof obj.requestedBy === 'string' ? obj.requestedBy : undefined
  if (!checkpointId || !reason || !requestedBy) return null

  const requiredRoles = Array.isArray(obj.requiredRoles)
    ? (obj.requiredRoles.filter((role): role is PendingApproval['requiredRoles'][number] => typeof role === 'string'))
    : []
  const evidenceRefs = Array.isArray(obj.evidenceRefs)
    ? obj.evidenceRefs.filter((ref): ref is string => typeof ref === 'string')
    : []

  const pending: PendingApproval = {
    checkpointId,
    reason,
    requestedBy,
    requestedAt: typeof obj.requestedAt === 'string' ? obj.requestedAt : undefined,
    requiredRoles,
    evidenceRefs,
    advisory: typeof obj.advisory === 'object' && obj.advisory !== null ? (obj.advisory as PendingApproval['advisory']) : undefined,
    status: ((): PendingApproval['status'] => {
      const status = obj.status
      return status === 'approved' || status === 'rejected' ? status : 'waiting'
    })(),
    decidedBy: typeof obj.decidedBy === 'string' ? obj.decidedBy : undefined,
    decidedAt: typeof obj.decidedAt === 'string' ? obj.decidedAt : undefined,
    decisionNotes: typeof obj.decisionNotes === 'string' ? obj.decisionNotes : undefined,
    originCapabilityId: normalizeOriginCapability(obj.originCapabilityId),
    originStepId: typeof obj.originStepId === 'string' ? obj.originStepId : undefined,
  }

  return pending
}

function approvalStatusColor(status: PendingApproval['status']) {
  if (status === 'approved') return 'success'
  if (status === 'rejected') return 'error'
  return 'warning'
}

function formatTimestamp(value?: string | number | null) {
  if (value === null || value === undefined) return ''
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString()
}

//

const approvalTrail = computed<ApprovalTrailItem[]>(() => {
  const map = new Map<string, { entry: PendingApproval; startedAt?: number; decidedAt?: number }>()

  frames.value.forEach((frame) => {
    const evt = frame.data
    if (evt.type === 'phase' && evt.phase === 'approval') {
      const raw = evt.data as Record<string, unknown> | undefined
      const checkpointId = typeof raw?.checkpointId === 'string' ? raw.checkpointId : undefined
      const pending = normalizePendingFromFrame((raw as any)?.pending ?? raw, checkpointId)
      if (pending) {
        const prev = map.get(pending.checkpointId)
        const merged: PendingApproval = {
          ...(prev?.entry || pending),
          ...pending,
          requiredRoles: [...pending.requiredRoles],
          evidenceRefs: [...pending.evidenceRefs],
          advisory: pending.advisory ?? prev?.entry.advisory,
          status: pending.status ?? prev?.entry.status ?? 'waiting',
          originCapabilityId: pending.originCapabilityId ?? prev?.entry.originCapabilityId,
          originStepId: pending.originStepId ?? prev?.entry.originStepId,
        }
        map.set(pending.checkpointId, {
          entry: merged,
          startedAt: prev?.startedAt ?? frame.t,
          decidedAt: prev?.decidedAt,
        })
      }
    } else if (evt.type === 'message' && evt.message === 'approval_decision') {
      const data = evt.data as Record<string, unknown> | undefined
      const checkpointId = typeof data?.checkpointId === 'string' ? data.checkpointId : undefined
      if (!checkpointId) return
      const prev = map.get(checkpointId)
      const status: PendingApproval['status'] = data?.status === 'rejected' ? 'rejected' : 'approved'
      const decidedBy = typeof data?.decidedBy === 'string' ? data.decidedBy : prev?.entry.decidedBy
      const decisionNotes = typeof data?.decisionNotes === 'string' ? data.decisionNotes : prev?.entry.decisionNotes
      const decidedAt = typeof data?.decidedAt === 'string' ? data.decidedAt : prev?.entry.decidedAt
      const reason = prev?.entry.reason || (typeof data?.reason === 'string' ? data.reason : 'Approval required')
      const requestedBy = prev?.entry.requestedBy || 'orchestrator'
      const requestedAt = prev?.entry.requestedAt
      const requiredRoles = prev?.entry.requiredRoles ? [...prev.entry.requiredRoles] : []
      const evidenceRefs = prev?.entry.evidenceRefs ? [...prev.entry.evidenceRefs] : []
      const advisory = prev?.entry.advisory
      const originCapabilityId = normalizeOriginCapability(data?.originCapabilityId) ?? prev?.entry.originCapabilityId
      const originStepId = typeof data?.originStepId === 'string' ? data.originStepId : prev?.entry.originStepId

      const entry: PendingApproval = {
        checkpointId,
        reason,
        requestedBy,
        requestedAt,
        requiredRoles,
        evidenceRefs,
        advisory,
        status,
        decidedBy,
        decisionNotes,
        decidedAt: decidedAt || new Date(frame.t).toISOString(),
        originCapabilityId,
        originStepId,
      }

      map.set(checkpointId, {
        entry,
        startedAt: prev?.startedAt,
        decidedAt: frame.t,
      })
    }
  })

  return Array.from(map.values())
    .map(({ entry, startedAt, decidedAt }) => ({
      ...entry,
      requiredRoles: [...(entry.requiredRoles || [])],
      evidenceRefs: [...(entry.evidenceRefs || [])],
      advisory: entry.advisory ? { ...entry.advisory } : undefined,
      startedAt,
      decidedAt,
    }))
    .sort((a, b) => {
      const aT = a.startedAt ?? (a.decidedAt ? Date.parse(a.decidedAt) : 0)
      const bT = b.startedAt ?? (b.decidedAt ? Date.parse(b.decidedAt) : 0)
      return aT - bT
    })
})

const timelinePanels = computed(() => {
  const out: Array<{ id?: string; type: AgentEvent['type'] | 'data'; data: AgentEventWithId; t: number }> = []
  const deltaItems: Array<{ id?: string; type: AgentEvent['type']; data: AgentEventWithId; t: number }> = []

  for (const f of frames.value) {
    if (f.type === 'delta') {
      deltaItems.push(f)
    } else {
      out.push(f)
    }
  }

  if (deltaItems.length) {
    const first = deltaItems[0]
    const fullText = deltaItems.map(d => (typeof d.data.message === 'string' ? d.data.message : '')).join('')
    out.push({
      id: 'delta-group',
      type: 'data',
      t: first.t,
      data: {
        type: 'message',
        // short header label; detailed text goes in panel body
        message: `stream (${deltaItems.length} chunks)`,
        data: {
          fullText,
          chunks: deltaItems.map(d => d.data),
        }
      } as AgentEventWithId
    })
  }

  out.sort((a, b) => a.t - b.t)
  return out
})

// Derived views for template safety
const knobSettingsView = computed(() => appResult.value?.knobSettings ?? null)

// Auto-scroll timeline to tail on updates
const timelineScroll = ref<HTMLElement | null>(null)
watch(frames, () => {
  nextTick(() => {
    const el = timelineScroll.value
    if (el) el.scrollTop = el.scrollHeight
  })
}, { deep: true })

// Auto-scroll plan view to tail on updates
const planScroll = ref<HTMLElement | null>(null)
watch(plan, () => {
  nextTick(() => {
    const el = planScroll.value
    if (el) el.scrollTop = el.scrollHeight
  })
}, { deep: true })

function planStatusColor(status: PlanStep['status']) {
  // Vuetify theme tokens store RGB channels; wrap in rgb() for visible colors
  switch (status) {
    case 'done':
      return 'rgb(var(--v-theme-success))'
    case 'in_progress':
      return 'rgb(var(--v-theme-info))'
    case 'skipped':
      return 'rgb(var(--v-theme-warning))'
    default:
      return 'rgba(var(--v-theme-on-surface), 0.38)'
  }
}

// no trailing status chips in the plan list

function planStepNote(step: PlanStep) {
  const note = typeof step.note === 'string' ? step.note.trim() : ''
  if (note) return note
  if (step.action === 'finalize') return 'Final review'
  if (step.capabilityId === 'strategy') return 'Strategy plan'
  if (step.capabilityId === 'generation') return 'Draft content'
  if (step.capabilityId === 'qa') return 'QA review'
  return 'No note'
}

</script>

<template>
  <v-dialog v-model="isOpen" max-width="1080" scrollable>
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon icon="mdi-robot-outline" class="me-2" />
        <div class="d-flex flex-column">
          <span class="text-h6">Agents Monitor</span>
          <small class="text-medium-emphasis">{{ props.brief?.title || '(untitled brief)' }}</small>
        </div>
        <v-spacer />
        <v-chip v-if="correlationId" size="small" color="primary" variant="tonal" class="me-2">
          CID: {{ correlationId }}
        </v-chip>
        <v-btn icon variant="text" @click="close">
          <v-icon icon="mdi-close" />
        </v-btn>
      </v-card-title>

      <v-divider />

      <v-card-text style="max-height: 72vh;">
        <v-alert
          v-if="backlog.busy"
          type="warning"
          variant="tonal"
          border="start"
          title="Server busy"
          class="mb-4"
        >
          Backlog is full ({{ backlog.pending }}/{{ backlog.limit }} pending). Retry after {{ backlog.retryAfter }}s.
          <v-btn class="ms-2" size="small" color="warning" @click="retry" :disabled="running">Retry now</v-btn>
        </v-alert>

        <v-alert v-if="errorMsg" type="error" variant="tonal" border="start" class="mb-4">
          {{ errorMsg }}
        </v-alert>

        <!-- Live plan, timeline and result two-column layout -->
        <v-row align="stretch" dense>
          <v-col cols="12" md="6">
            <!-- Planning view (mirrors Sandbox plan table) -->
            <v-card class="mb-3">
              <v-card-title class="d-flex align-center">
                <v-icon icon="mdi-clipboard-text-outline" class="me-2" />
                Plan
              </v-card-title>
              <v-divider />
              <v-card-text>
                <div v-if="!plan" class="plan-steps-scroll d-flex align-center justify-center">
                  <div class="text-caption text-medium-emphasis">No plan yet</div>
                </div>
                <div v-else ref="planScroll" class="plan-steps-scroll">
                  <div
                    v-for="s in plan.steps"
                    :key="s.id"
                    class="plan-step-row"
                    :style="{ '--status-color': planStatusColor(s.status) }"
                  >
                    <span class="plan-status-dot" :style="{ backgroundColor: planStatusColor(s.status) }" />
                    <span class="plan-step-text text-body-2">{{ planStepNote(s) }}</span>
                  </div>
                </div>
              </v-card-text>
            </v-card>

            <v-card v-if="approvalTrail.length" class="mb-3">
              <v-card-title class="d-flex align-center">
                <v-icon icon="mdi-account-check-outline" class="me-2" />
                Approvals
              </v-card-title>
              <v-divider />
              <v-card-text>
                <div v-for="(item, idx) in approvalTrail" :key="`${item.checkpointId}-${idx}`" class="mb-3">
                  <div class="d-flex align-center mb-1">
                    <v-chip size="x-small" :color="approvalStatusColor(item.status)" variant="flat">
                      {{ item.status }}
                    </v-chip>
                    <span class="text-caption text-medium-emphasis ms-2">{{ item.checkpointId }}</span>
                    <span v-if="item.decidedAt" class="text-caption text-medium-emphasis ms-2">
                      {{ formatTimestamp(item.decidedAt) }}
                    </span>
                  </div>
                  <div class="text-body-2">{{ item.reason }}</div>
                  <div class="text-caption text-medium-emphasis" v-if="item.requestedBy">
                    Requested by {{ item.requestedBy }}
                  </div>
                  <div class="text-caption text-medium-emphasis" v-if="item.decidedBy">
                    Reviewer: {{ item.decidedBy }}
                  </div>
                  <div class="text-body-2 mt-1" v-if="item.decisionNotes">
                    <strong>Notes:</strong> {{ item.decisionNotes }}
                  </div>
                  <div class="text-caption text-medium-emphasis mt-1" v-if="item.requiredRoles?.length">
                    Roles: {{ item.requiredRoles.join(', ') }}
                  </div>
                  <div class="text-caption text-medium-emphasis mt-1" v-if="item.evidenceRefs?.length">
                    Evidence: {{ item.evidenceRefs.join(', ') }}
                  </div>
                  <v-divider v-if="idx < approvalTrail.length - 1" class="my-3" />
                </div>
              </v-card-text>
            </v-card>

            <v-card variant="tonal">
              <v-card-title class="d-flex align-center">
                <v-icon icon="mdi-timeline-text-outline" class="me-2" />
                Timeline
                <v-spacer />
                <v-chip size="small" :color="running ? 'success' : 'default'" variant="tonal">
                  {{ running ? 'Streaming...' : 'Idle' }}
                </v-chip>
              </v-card-title>
              <v-divider />
              <v-card-text>
                <div ref="timelineScroll" style="height: 144px; overflow: auto">
                  <v-expansion-panels variant="accordion" density="comfortable">
                    <v-expansion-panel v-for="(f, idx) in timelinePanels" :key="idx">
                      <v-expansion-panel-title>
                        <div class="d-flex align-center w-100">
                          <v-chip
                          size="x-small"
                          class="me-2"
                          :color="dotColor(f.type)"
                          variant="flat"
                        >
                          {{ f.type }}
                        </v-chip>
                        <span class="text-body-2 flex-grow-1">
                          {{ f.data.message || '' }}
                        </span>
                        <v-chip
                          v-if="f.type === 'metrics' && typeof f.data?.durationMs === 'number'"
                          size="x-small"
                          color="teal"
                          variant="outlined"
                          class="ms-2"
                        >
                          {{ Math.round(f.data.durationMs) }} ms
                        </v-chip>
                        <span class="text-caption text-medium-emphasis ms-auto">
                          {{ new Date(f.t).toLocaleTimeString() }}
                        </span>
                      </div>
                    </v-expansion-panel-title>
                    <v-expansion-panel-text>
                      <div v-if="f.type === 'data'">
                        <div class="text-caption text-medium-emphasis mb-1">Aggregated stream</div>
                        <pre class="text-caption" style="white-space: pre-wrap; margin: 0">{{ f.data?.data?.fullText || '' }}</pre>
                      </div>
                      <pre v-else class="text-caption" style="white-space: pre-wrap; margin: 0">{{ stringify(f.data) }}</pre>
                    </v-expansion-panel-text>
                  </v-expansion-panel>
                 </v-expansion-panels>
                </div>
              </v-card-text>
            </v-card>
          </v-col>

          <v-col cols="12" md="6">
            <v-card>
              <v-card-title class="d-flex align-center">
                <v-icon icon="mdi-post-outline" class="me-2" />
                App Result
              </v-card-title>
              <v-divider />
              <v-card-text>
                <div v-if="!appResult">
                  <div class="d-flex flex-column align-center py-6">
                    <v-progress-circular indeterminate color="primary" size="32" class="mb-2" v-if="running" />
                    <div class="text-medium-emphasis">{{ running ? 'Streaming...' : 'No result yet' }}</div>
                  </div>
                </div>

                <div v-else class="d-flex flex-column ga-3">
                  <v-card variant="outlined" class="mb-3">
                    <v-card-title class="d-flex align-center text-subtitle-2">
                      <v-icon icon="mdi-post-outline" class="me-2" />
                      Result
                      <v-spacer />
                      <v-chip v-if="appResult?.result?.platform" size="x-small" color="secondary" variant="flat">{{ appResult?.result?.platform }}</v-chip>
                    </v-card-title>
                    <v-card-text>
                      <div class="pa-3 rounded" style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06)">
                        <pre class="text-body-2" style="white-space: pre-wrap; margin: 0">{{ appResult?.result?.content || '' }}</pre>
                      </div>
                    </v-card-text>
                  </v-card>

                  <v-alert
                    v-if="appResult?.rationale"
                    type="info"
                    variant="outlined"
                    class="mb-3"
                  >
                    <div class="text-subtitle-2 mb-1">Rationale</div>
                    <div class="text-body-2">{{ appResult?.rationale }}</div>
                  </v-alert>

                  <v-card v-if="knobSettingsView" variant="tonal" class="mb-3">
                    <v-card-title class="text-subtitle-2">Knob Settings</v-card-title>
                    <v-card-text>
                      <KnobSettingsDisplay :knobs="knobSettingsView" />
                    </v-card-text>
                  </v-card>

                  <v-card v-if="appResult && (appResult as any)['quality-report']" variant="outlined">
                    <v-card-title class="text-subtitle-2">Quality Report</v-card-title>
                    <v-card-text>
                      <QualityReportDisplay :report="(appResult as any)['quality-report']" />
                    </v-card-text>
                  </v-card>
                </div>
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>
      </v-card-text>

      <v-divider />

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">Close</v-btn>
        <v-btn color="warning" variant="elevated" @click="stopRun" :disabled="!running">
          <v-icon icon="mdi-stop" class="me-1" /> Stop
        </v-btn>
        <v-btn color="primary" @click="retry" :disabled="running">
          <v-icon icon="mdi-reload" class="me-1" /> Retry
        </v-btn>
        <v-btn color="default" variant="tonal" @click="downloadJson" :disabled="!appResult">
          <v-icon icon="mdi-tray-arrow-down" class="me-1" /> Download JSON
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.ga-2 { gap: 8px; }
.ga-3 { gap: 12px; }
.plan-steps-scroll {
  height: 240px;
  overflow: auto;
  padding: 4px 0;
}
.plan-step-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px 8px 12px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-left: 3px solid var(--status-color, transparent);
}
.plan-step-row:last-of-type {
  border-bottom: none;
}
.plan-status-dot {
  width: 12px;
  height: 12px;
  border-radius: 9999px;
  display: inline-block;
  flex-shrink: 0;
}
.plan-step-text {
  /* Use medium emphasis for readability on dark backgrounds */
  color: rgb(var(--v-theme-on-surface));
}
</style>
