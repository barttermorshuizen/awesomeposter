<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import type { AgentEvent, AgentMode, AgentRunRequest, PendingApproval } from '@awesomeposter/shared'
import ApprovalCheckpointBanner from '@/components/ApprovalCheckpointBanner.vue'
import { AGENTS_BASE_URL, AGENTS_AUTH, listPendingApprovals, postApprovalDecision } from '@/lib/agents-api'
// Temporary local alias while shared package builds
type TargetAgentId = 'orchestrator' | 'strategy' | 'generator' | 'qa'

type AgentInfo = { id: TargetAgentId; label: string; supports: ('app' | 'chat')[] }

// Safe fallback list so the Sandbox remains usable even if the server is down
const DEFAULT_AGENTS: AgentInfo[] = [
  { id: 'orchestrator', label: 'Orchestrator', supports: ['app', 'chat'] },
  { id: 'strategy', label: 'Strategy Manager', supports: ['chat'] },
  { id: 'generator', label: 'Content Generator', supports: ['chat'] },
  { id: 'qa', label: 'Quality Assurance', supports: ['chat'] },
]

// Controls
const agents = ref<AgentInfo[]>([])
const agentsLoading = ref(true)
const selectedAgentId = ref<TargetAgentId>('orchestrator')
const mode = ref<AgentMode>('chat')
const objective = ref('Say hello and explain what you can do for AwesomePoster.')
const toolPolicy = ref<'auto' | 'required' | 'off'>('auto')
const toolsAllowlistInput = ref('')
const trace = ref(false)
// Optional orchestrator constraints
const qualityThreshold = ref<number | null>(null)
const maxRevisionCycles = ref<number | null>(null)

// Run state
const running = ref(false)
const chatText = ref('')
type AgentEventWithSseId = AgentEvent & { id?: string }
type Frame = { id?: string; type: AgentEvent['type']; data: AgentEventWithSseId; t: number }
const frames = ref<Frame[]>([])
const correlationId = ref<string | undefined>(undefined)
const phase = ref<string | undefined>(undefined)
const errorMsg = ref<string | null>(null)

// Live plan state from plan_update frames
type PlanStep = { id: string; capabilityId?: string; action?: string; label?: string; status: 'pending'|'in_progress'|'done'|'skipped'; note?: string }
type PlanState = { version: number; steps: PlanStep[] }
const plan = ref<PlanState | null>(null)

const threadId = ref<string | undefined>(undefined)
const pendingApprovals = ref<PendingApproval[]>([])
const approvalNotes = ref('')
const approvalReviewer = ref('')
const approvalError = ref<string | null>(null)
const approvalBusy = ref(false)
const approvalsLoadedForThread = ref<string | null>(null)

const backlog = reactive({ busy: false, retryAfter: 0, pending: 0, limit: 0 })
let abortController: AbortController | null = null

const canAgentChat = computed(() => {
  const a = agents.value.find((x) => x.id === selectedAgentId.value)
  return !!a && a.supports.includes('chat')
})

const filteredAgents = computed(() => {
  if (mode.value === 'app') {
    return agents.value.filter((x) => x.id === 'orchestrator')
  }
  return agents.value
})

const agentSelectDisabled = computed(() => running.value || mode.value === 'app')

const waitingApproval = computed(() => pendingApprovals.value.find((entry) => entry.status === 'waiting') || null)
const approvalHistory = computed(() =>
  pendingApprovals.value
    .filter((entry) => entry.status !== 'waiting')
    .slice()
    .sort((a, b) => {
      const at = entryTime(a.decidedAt || a.requestedAt)
      const bt = entryTime(b.decidedAt || b.requestedAt)
      return bt - at
    })
)

// Enforce orchestrator selection in App mode
watch(mode, (m) => {
  if (m === 'app') selectedAgentId.value = 'orchestrator'
})
 
function parseAllowlist() {
  return toolsAllowlistInput.value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function entryTime(input?: string | null) {
  if (!input) return 0
  const value = Date.parse(input)
  return Number.isNaN(value) ? 0 : value
}

async function loadAgents() {
  agentsLoading.value = true
  try {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (AGENTS_AUTH) headers['authorization'] = `Bearer ${AGENTS_AUTH}`
    const res = await fetch(`${AGENTS_BASE_URL}/api/v1/agent/agents`, { headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json().catch(() => ({}))
    const list = Array.isArray(json?.agents) ? (json.agents as AgentInfo[]) : DEFAULT_AGENTS
    agents.value = list
  } catch (e) {
    errorMsg.value = `Failed to load agents: ${String(e)}`
    agents.value = DEFAULT_AGENTS
  } finally {
    agentsLoading.value = false
  }
}

function resetApprovals() {
  pendingApprovals.value = []
  approvalNotes.value = ''
  approvalError.value = null
  approvalBusy.value = false
  approvalsLoadedForThread.value = null
}

const ORIGIN_CAPABILITIES = ['strategy', 'generation', 'qa'] as const

function normalizeOriginCapability(value: unknown): PendingApproval['originCapabilityId'] | undefined {
  if (typeof value !== 'string') return undefined
  return (ORIGIN_CAPABILITIES as readonly string[]).includes(value)
    ? (value as PendingApproval['originCapabilityId'])
    : undefined
}

function setPendingApprovals(list: PendingApproval[]) {
  pendingApprovals.value = list.map((entry) => ({
    ...entry,
    requiredRoles: Array.isArray(entry.requiredRoles) ? [...entry.requiredRoles] : [],
    evidenceRefs: Array.isArray(entry.evidenceRefs) ? [...entry.evidenceRefs] : [],
    advisory: entry.advisory ? { ...entry.advisory } : undefined,
  }))
}

function upsertPendingApproval(entry: PendingApproval) {
  const normalized: PendingApproval = {
    ...entry,
    requiredRoles: Array.isArray(entry.requiredRoles) ? [...entry.requiredRoles] : [],
    evidenceRefs: Array.isArray(entry.evidenceRefs) ? [...entry.evidenceRefs] : [],
    advisory: entry.advisory ? { ...entry.advisory } : undefined,
  }
  const idx = pendingApprovals.value.findIndex((item) => item.checkpointId === normalized.checkpointId)
  if (idx === -1) {
    pendingApprovals.value = [...pendingApprovals.value, normalized]
  } else {
    const current = pendingApprovals.value[idx]
    pendingApprovals.value.splice(idx, 1, {
      ...current,
      ...normalized,
    })
  }
}

function applyDecisionPatch(patch: {
  checkpointId: string
  status: 'approved' | 'rejected'
  decidedBy?: string
  decisionNotes?: string
  decidedAt?: string
}) {
  const idx = pendingApprovals.value.findIndex((item) => item.checkpointId === patch.checkpointId)
  if (idx === -1) {
    const decidedAt = patch.decidedAt || new Date().toISOString()
    pendingApprovals.value = [
      ...pendingApprovals.value,
      {
        checkpointId: patch.checkpointId,
        reason: 'Approval decision',
        requestedBy: 'orchestrator',
        requiredRoles: [],
        evidenceRefs: [],
        status: patch.status,
        decidedBy: patch.decidedBy,
        decisionNotes: patch.decisionNotes,
        decidedAt,
      },
    ]
    return
  }

  const current = pendingApprovals.value[idx]
  pendingApprovals.value.splice(idx, 1, {
    ...current,
    status: patch.status,
    decidedBy: patch.decidedBy ?? current.decidedBy,
    decisionNotes: patch.decisionNotes ?? current.decisionNotes,
    decidedAt: patch.decidedAt || current.decidedAt || new Date().toISOString(),
  })
}

function normalizePendingApproval(raw: unknown, fallbackId?: string): PendingApproval | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const checkpointId = typeof obj.checkpointId === 'string' ? obj.checkpointId : fallbackId
  const reason = typeof obj.reason === 'string' ? obj.reason : undefined
  const requestedBy = typeof obj.requestedBy === 'string' ? obj.requestedBy : undefined
  if (!checkpointId || !reason || !requestedBy) return null

  const requiredRolesRaw = Array.isArray(obj.requiredRoles) ? obj.requiredRoles : []
  const evidenceRefsRaw = Array.isArray(obj.evidenceRefs) ? obj.evidenceRefs : []

  const pending: PendingApproval = {
    checkpointId,
    reason,
    requestedBy,
    requestedAt: typeof obj.requestedAt === 'string' ? obj.requestedAt : undefined,
    requiredRoles: requiredRolesRaw.filter((role): role is PendingApproval['requiredRoles'][number] => typeof role === 'string'),
    evidenceRefs: evidenceRefsRaw.filter((ref): ref is string => typeof ref === 'string'),
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

async function refreshApprovalsForThread(force = false) {
  if (!threadId.value) return
  if (!force && approvalsLoadedForThread.value === threadId.value) return
  try {
    const list = await listPendingApprovals(threadId.value)
    setPendingApprovals(list)
    approvalsLoadedForThread.value = threadId.value
  } catch (err) {
    console.warn('[Sandbox] Failed to load approvals', err)
  }
}

function resetRun() {
  chatText.value = ''
  frames.value = []
  correlationId.value = undefined
  phase.value = undefined
  threadId.value = undefined
  backlog.busy = false
  backlog.retryAfter = 0
  backlog.pending = 0
  backlog.limit = 0
  errorMsg.value = null
  plan.value = null
  resetApprovals()
}

async function startRun() {
  if (running.value) return
  resetRun()
  running.value = true
  abortController = new AbortController()

  type AgentRunOptions = NonNullable<AgentRunRequest['options']>
  const options: AgentRunOptions = {
    toolPolicy: toolPolicy.value,
    toolsAllowlist: parseAllowlist(),
    trace: trace.value,
    ...(mode.value === 'chat' ? { targetAgentId: selectedAgentId.value } as Pick<AgentRunOptions, 'targetAgentId'> : {}),
    ...(qualityThreshold.value != null ? { qualityThreshold: qualityThreshold.value } as Pick<AgentRunOptions, 'qualityThreshold'> : {}),
    ...(maxRevisionCycles.value != null
      ? { maxRevisionCycles: Math.max(0, Math.floor(Number(maxRevisionCycles.value))) } as Pick<AgentRunOptions, 'maxRevisionCycles'>
      : {}),
  }

  const body: AgentRunRequest = {
    mode: mode.value,
    objective: objective.value,
    options,
  }

  try {
    // Debug: log outgoing request in Sandbox
    console.debug('[Sandbox] startRun', {
      baseUrl: AGENTS_BASE_URL,
      selectedAgentId: selectedAgentId.value,
      mode: mode.value,
      body
    })
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    }
    if (AGENTS_AUTH) headers['authorization'] = `Bearer ${AGENTS_AUTH}`
    const res = await fetch(`${AGENTS_BASE_URL}/api/v1/agent/run.stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: abortController.signal,
    })

    if (!res.ok) {
      if (res.status === 503) {
        backlog.busy = true
        backlog.retryAfter = Number.parseInt(res.headers.get('Retry-After') || '2', 10)
        backlog.pending = Number.parseInt(res.headers.get('X-Backlog-Pending') || '0', 10)
        backlog.limit = Number.parseInt(res.headers.get('X-Backlog-Limit') || '0', 10)
      } else {
        const text = await res.text().catch(() => '')
        frames.value.push({
          type: 'error',
          data: { type: 'error', message: `HTTP ${res.status} ${res.statusText}`, data: { body: text } },
          t: Date.now(),
        })
      }
      running.value = false
      return
    }

    const reader = res.body?.getReader()
    if (!reader) {
      running.value = false
      return
    }

    await parseSse(reader, (evt: AgentEventWithSseId) => {
      const now = Date.now()
      frames.value.push({ id: evt.id, type: evt.type, data: evt, t: now })
      if (typeof evt.correlationId === 'string' && !correlationId.value) {
        correlationId.value = evt.correlationId
      }

      switch (evt.type) {
        case 'start': {
          const data = evt.data as Record<string, unknown> | undefined
          const tid = typeof data?.threadId === 'string' ? data.threadId : undefined
          if (tid) {
            threadId.value = tid
            approvalsLoadedForThread.value = null
            void refreshApprovalsForThread(true)
          }
          break
        }
        case 'delta':
          if (evt.message) chatText.value += evt.message
          break
        case 'message':
          if (evt.message === 'approval_decision') {
            const data = evt.data as Record<string, unknown> | undefined
            const checkpointId = typeof data?.checkpointId === 'string' ? data.checkpointId : undefined
            if (checkpointId) {
              applyDecisionPatch({
                checkpointId,
                status: data?.status === 'rejected' ? 'rejected' : 'approved',
                decidedBy: typeof data?.decidedBy === 'string' ? data.decidedBy : undefined,
                decisionNotes: typeof data?.decisionNotes === 'string' ? data.decisionNotes : undefined,
                decidedAt: typeof data?.decidedAt === 'string' ? data.decidedAt : undefined,
              })
              approvalError.value = null
              void refreshApprovalsForThread(true)
            }
            break
          }
          if (evt.message) chatText.value = evt.message
          break
        case 'phase':
          phase.value = evt.phase
          if (evt.phase === 'approval') {
            const raw = evt.data as Record<string, unknown> | undefined
            const checkpointId = typeof raw?.checkpointId === 'string' ? raw.checkpointId : undefined
            const pending = normalizePendingApproval((raw as any)?.pending ?? raw, checkpointId)
            if (pending) {
              pending.status = 'waiting'
              upsertPendingApproval(pending)
              approvalError.value = null
            }
          }
          break
        case 'plan_update': {
          try {
            const d = evt.data as unknown
            if (d !== null && typeof d === 'object') {
              const p = (d as Record<string, unknown>)['plan']
              if (p !== null && typeof p === 'object') {
                const prec = p as Record<string, unknown>
                const steps = prec['steps']
                if (Array.isArray(steps)) {
                  const versionRaw = prec['version']
                  const version = typeof versionRaw === 'number' ? versionRaw : Number(versionRaw || 0)
                  plan.value = { version, steps: steps as PlanStep[] }
                }
              }
            }
          } catch {}
          break
        }
        case 'error':
          running.value = false
          break
        case 'complete':
          running.value = false
          break
      }
    })
  } catch (err: unknown) {
    const name = (err as { name?: string } | null)?.name
    if (name === 'AbortError') {
      frames.value.push({ type: 'warning', data: { type: 'warning', message: 'Run aborted' }, t: Date.now() })
    } else {
      frames.value.push({ type: 'error', data: { type: 'error', message: String(err) }, t: Date.now() })
    }
    running.value = false
  } finally {
    abortController = null
  }
}

function stopRun() {
  abortController?.abort()
  running.value = false
}

async function submitApprovalDecision(decision: 'approved' | 'rejected') {
  if (approvalBusy.value) return
  const current = waitingApproval.value
  if (!current) return

  approvalBusy.value = true
  approvalError.value = null

  const decidedBy = approvalReviewer.value.trim() || undefined
  const notes = approvalNotes.value.trim() || undefined

  const snapshot: PendingApproval = {
    ...current,
    requiredRoles: [...(current.requiredRoles || [])],
    evidenceRefs: [...(current.evidenceRefs || [])],
    advisory: current.advisory ? { ...current.advisory } : undefined,
  }

  const optimistic: PendingApproval = {
    ...snapshot,
    status: decision,
    decidedBy,
    decisionNotes: notes,
    decidedAt: new Date().toISOString(),
  }
  upsertPendingApproval(optimistic)

  try {
    await postApprovalDecision({
      checkpointId: current.checkpointId,
      decision,
      decidedBy,
      notes,
    })
    approvalNotes.value = ''
    approvalError.value = null
    void refreshApprovalsForThread(true)
  } catch (err) {
    upsertPendingApproval(snapshot)
    approvalError.value = err instanceof Error ? err.message : String(err)
  } finally {
    approvalBusy.value = false
  }
}

async function parseSse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (evt: AgentEventWithSseId) => void
) {
  const decoder = new TextDecoder()
  let buf = ''
  let eventType: string | undefined
  let eventId: string | undefined
  let dataLines: string[] = []

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })

    // process by lines
    while (true) {
      const nl = buf.indexOf('\n')
      if (nl === -1) break
      let line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (line.endsWith('\r')) line = line.slice(0, -1)

      if (line === '') {
        // dispatch event
        if (dataLines.length > 0) {
          const dataStr = dataLines.join('\n')
          let data: unknown
          try {
            data = JSON.parse(dataStr)
          } catch {
            data = { raw: dataStr }
          }
          const partial = (data ?? {}) as Partial<AgentEventWithSseId>
          const t = (partial.type as AgentEvent['type']) ?? (eventType as AgentEvent['type']) ?? 'message'
          const payload: AgentEventWithSseId = { type: t, id: eventId }
          if (typeof partial.message === 'string') payload.message = partial.message
          if (partial.phase) payload.phase = partial.phase as AgentEvent['phase']
          if ('data' in partial) payload.data = (partial as { data?: unknown }).data
          if (typeof partial.tokens === 'number') payload.tokens = partial.tokens
          if (typeof partial.durationMs === 'number') payload.durationMs = partial.durationMs
          if (typeof partial.correlationId === 'string') payload.correlationId = partial.correlationId
          onEvent(payload)
        }
        eventType = undefined
        eventId = undefined
        dataLines = []
        continue
      }

      if (line.startsWith(':')) continue // comment/heartbeat prelude
      if (line.startsWith('event:')) eventType = line.slice(6).trim()
      else if (line.startsWith('id:')) eventId = line.slice(3).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
      // ignore other fields
    }
  }
}

function clearAll() {
  resetRun()
}

function copyCid() {
  if (!correlationId.value) return
  navigator.clipboard?.writeText(correlationId.value).catch(() => {})
}

function formatTimestamp(value?: string | null) {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
}

function approvalStatusColor(status: PendingApproval['status']) {
  if (status === 'approved') return 'success'
  if (status === 'rejected') return 'error'
  return 'warning'
}
onMounted(loadAgents)
onBeforeUnmount(() => abortController?.abort())

// Group frames for the inspector accordion, consolidating all deltas
const groupedFrames = computed(() => {
  const items: Array<
    | { key: string; type: Frame['type']; t: number; data: Frame['data']; message?: string }
    | { key: string; type: 'delta_group'; t: number; count: number; message: string; frames: Frame[] }
  > = []

  const deltas: Frame[] = []
  frames.value.forEach((f, idx) => {
    if (f.type === 'delta') {
      deltas.push(f)
    } else {
      items.push({ key: `f-${idx}`, type: f.type, t: f.t, data: f.data, message: (f.data as AgentEventWithSseId)?.message })
    }
  })

  if (deltas.length > 0) {
    const firstT = deltas[0].t
    const combined = deltas.map((d) => ((d.data as AgentEventWithSseId).message ?? '')).join('')
    items.push({ key: 'delta-group', type: 'delta_group', t: firstT, count: deltas.length, message: combined, frames: deltas })
  }

  // Keep chronological order by time
  items.sort((a, b) => a.t - b.t)
  return items
})
</script>

<template>
  <v-container fluid class="pa-4">
    <v-row>
      <v-col cols="12">
        <v-card variant="tonal">
          <v-card-title class="d-flex align-center">
            <v-icon icon="mdi-flask-outline" class="me-2" />
            Sandbox
            <v-spacer />
            <v-chip size="small" color="info" variant="elevated" class="me-2">
              Base: {{ AGENTS_BASE_URL }}
            </v-chip>
            <v-chip v-if="phase" size="small" color="secondary" variant="flat">
              Phase: {{ phase }}
            </v-chip>
          </v-card-title>

          <v-card-text>
            <v-row dense>
              <v-col cols="12" md="3">
                <v-tooltip
                  v-if="mode==='app'"
                  text="App mode uses the Orchestrator to coordinate specialist agents. Switch to Chat to talk directly to Strategy/Generator/QA."
                  location="bottom"
                >
                  <template #activator="{ props }">
                    <div v-bind="props">
                      <v-select
                        v-model="selectedAgentId"
                        :items="filteredAgents"
                        :loading="agentsLoading"
                        item-title="label"
                        item-value="id"
                        label="Agent"
                        density="comfortable"
                        prepend-inner-icon="mdi-robot-outline"
                        :disabled="agentSelectDisabled"
                        hint="App mode uses Orchestrator"
                        persistent-hint
                      />
                    </div>
                  </template>
                </v-tooltip>
                <v-select
                  v-else
                  v-model="selectedAgentId"
                  :items="filteredAgents"
                  :loading="agentsLoading"
                  item-title="label"
                  item-value="id"
                  label="Agent"
                  density="comfortable"
                  prepend-inner-icon="mdi-robot-outline"
                  :disabled="agentSelectDisabled"
                />
              </v-col>

              <v-col cols="12" md="3">
                <v-select
                  v-model="mode"
                  :items="[{title:'Chat', value:'chat'}, {title:'App', value:'app'}]"
                  label="Mode"
                  density="comfortable"
                  prepend-inner-icon="mdi-swap-horizontal"
                  :disabled="running"
                />
              </v-col>

              <v-col cols="12" md="3">
                <v-select
                  v-model="toolPolicy"
                  :items="[{title:'Auto', value:'auto'}, {title:'Required', value:'required'}, {title:'Off', value:'off'}]"
                  label="Tool policy"
                  density="comfortable"
                  prepend-inner-icon="mdi-tools"
                  :disabled="running"
                />
              </v-col>

              <v-col cols="12" md="3">
                <v-text-field
                  v-model.number="qualityThreshold"
                  type="number"
                  label="qualityThreshold (0..1)"
                  step="0.05"
                  min="0"
                  max="1"
                  density="comfortable"
                  prepend-inner-icon="mdi-gauge"
                  :disabled="running || mode==='chat'"
                  hint="Optional: default 0.7 if unset"
                  persistent-hint
                />
              </v-col>

              <v-col cols="12" md="3">
                <v-text-field
                  v-model.number="maxRevisionCycles"
                  type="number"
                  label="maxRevisionCycles"
                  step="1"
                  min="0"
                  density="comfortable"
                  prepend-inner-icon="mdi-reload"
                  :disabled="running || mode==='chat'"
                  hint="Optional: default 1 if unset"
                  persistent-hint
                />
              </v-col>

              <v-col cols="12" md="3">
                <v-text-field
                  v-model="toolsAllowlistInput"
                  label="Tools allowlist (comma-separated)"
                  density="comfortable"
                  prepend-inner-icon="mdi-format-list-bulleted"
                  :disabled="running"
                />
              </v-col>

              <v-col cols="12">
                <v-textarea
                  v-model="objective"
                  label="Objective / message"
                  auto-grow
                  rows="2"
                  density="comfortable"
                  :disabled="running"
                  prepend-inner-icon="mdi-text-long"
                />
              </v-col>

              <v-col cols="12" class="d-flex align-center">
                <v-switch v-model="trace" label="Trace (if supported)" hide-details class="me-4" />

                <v-btn color="primary" :disabled="running || (!canAgentChat && mode==='chat')" @click="startRun" class="me-2">
                  <v-icon icon="mdi-play" class="me-1" /> Start
                </v-btn>
                <v-btn color="warning" variant="elevated" :disabled="!running" @click="stopRun" class="me-2">
                  <v-icon icon="mdi-stop" class="me-1" /> Stop
                </v-btn>
                <v-btn color="default" variant="text" @click="clearAll">
                  <v-icon icon="mdi-broom" class="me-1" /> Clear
                </v-btn>

                <v-spacer />

                <v-chip v-if="correlationId" size="small" class="me-2" color="primary" variant="tonal">
                  CID: {{ correlationId }}
                </v-chip>
                <v-btn
                  v-if="correlationId"
                  size="small"
                  variant="text"
                  @click="copyCid"
                  :title="'Copy correlationId'"
                >
                  <v-icon icon="mdi-content-copy" />
                </v-btn>
              </v-col>

              <v-col cols="12" v-if="backlog.busy">
                <v-alert type="warning" title="Server busy" variant="tonal" border="start" density="comfortable">
                  Backlog is full ({{ backlog.pending }}/{{ backlog.limit }} pending). Retry after {{ backlog.retryAfter }}s.
                  <v-btn class="ms-2" size="small" color="warning" @click="startRun" :disabled="running">Retry now</v-btn>
                </v-alert>
              </v-col>

              <v-col cols="12" v-if="errorMsg">
                <v-alert type="error" :text="errorMsg" variant="tonal" border="start" density="comfortable" />
              </v-col>

              <v-col cols="12" v-if="waitingApproval">
                <ApprovalCheckpointBanner
                  :pending="waitingApproval"
                  v-model:notes="approvalNotes"
                  v-model:reviewer="approvalReviewer"
                  :busy="approvalBusy"
                  :error="approvalError"
                  @approve="submitApprovalDecision('approved')"
                  @reject="submitApprovalDecision('rejected')"
                />
              </v-col>

              <v-col cols="12" v-if="approvalHistory.length">
                <v-card variant="outlined">
                  <v-card-title class="d-flex align-center">
                    <v-icon icon="mdi-account-check-outline" class="me-2" />
                    Approval history
                  </v-card-title>
                  <v-divider />
                  <v-card-text>
                    <div
                      v-for="(item, idx) in approvalHistory"
                      :key="`${item.checkpointId}-${idx}`"
                      class="mb-3"
                    >
                      <div class="d-flex align-center mb-1">
                        <v-chip size="x-small" :color="approvalStatusColor(item.status)" variant="flat">
                          {{ item.status }}
                        </v-chip>
                        <span class="text-caption text-medium-emphasis ms-2">{{ item.checkpointId }}</span>
                        <span
                          v-if="item.decidedAt"
                          class="text-caption text-medium-emphasis ms-2"
                        >
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
                      <v-divider v-if="idx < approvalHistory.length - 1" class="my-3" />
                    </div>
                  </v-card-text>
                </v-card>
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

  <v-row class="mt-3" align="stretch">
      <v-col cols="12" md="6">
        <v-card>
          <v-card-title class="d-flex align-center">
            <v-icon icon="mdi-chat-processing-outline" class="me-2" />
            Conversation
            <v-spacer />
            <v-chip size="small" :color="running ? 'success' : 'default'" variant="tonal">
              {{ running ? 'Streaming...' : 'Idle' }}
            </v-chip>
          </v-card-title>
          <v-divider />
          <v-card-text>
            <div class="conversation-box">
              <pre class="text-body-2" style="white-space: pre-wrap; margin: 0">{{ chatText || '—' }}</pre>
            </div>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" md="6">
        <v-card>
          <v-card-title class="d-flex align-center">
            <v-icon icon="mdi-timeline-text-outline" class="me-2" />
            Stream Inspector
          </v-card-title>
          <v-divider />
          <v-card-text style="max-height: 520px; overflow: auto">
            <v-expansion-panels variant="accordion" density="comfortable">
              <v-expansion-panel v-for="item in groupedFrames" :key="item.key">
                <v-expansion-panel-title>
                  <div class="d-flex align-center w-100">
                    <v-chip
                      size="x-small"
                      class="me-2"
                      :color="dotColor(item.type === 'delta_group' ? 'delta' : item.type)"
                      variant="flat"
                    >
                      {{ item.type === 'delta_group' ? 'delta' : item.type }}
                    </v-chip>
                    <span class="text-body-2 flex-grow-1">
                      <template v-if="item.type === 'delta_group'">
                        Delta stream ({{ (item as any).count }} chunks)
                      </template>
                      <template v-else-if="(item as any).type === 'metrics'">
                        <template v-if="(item as any).data && (item as any).data.durationMs !== undefined">
                          duration: {{ (item as any).data.durationMs }} ms
                        </template>
                        <template v-else>
                          metrics
                        </template>
                      </template>
                      <template v-else-if="(item as any).type === 'complete'">
                        Run ended
                      </template>
                      <template v-else>
                        {{ (item as any).message || '' }}
                      </template>
                    </span>
                    <span class="text-caption text-medium-emphasis">
                      {{ new Date(item.t).toLocaleTimeString() }}
                    </span>
                  </div>
                </v-expansion-panel-title>
                <v-expansion-panel-text>
                  <template v-if="item.type === 'delta_group'">
                    <div class="mb-2 text-caption text-medium-emphasis">Combined message</div>
                    <pre class="text-caption" style="white-space: pre-wrap; margin: 0">{{ (item as any).message }}</pre>
                    <div class="mt-4 mb-2 text-caption text-medium-emphasis">Raw frames</div>
                    <pre class="text-caption" style="white-space: pre-wrap; margin: 0">{{ stringify(((item as any).frames as any[]).map((f: any) => f.data)) }}</pre>
                  </template>
                  <template v-else>
                    <pre class="text-caption" style="white-space: pre-wrap; margin: 0">{{ stringify((item as any).data) }}</pre>
                  </template>
                </v-expansion-panel-text>
              </v-expansion-panel>
            </v-expansion-panels>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-row class="mt-3">
      <v-col cols="12">
        <v-card>
          <v-card-title class="d-flex align-center">
            <v-icon icon="mdi-clipboard-text-outline" class="me-2" />
            Plan
            <v-spacer />
            <v-chip v-if="plan?.version !== undefined" size="x-small" variant="tonal">v{{ plan?.version ?? 0 }}</v-chip>
          </v-card-title>
          <v-divider />
          <v-card-text>
            <div v-if="!plan" class="plan-table-scroll d-flex align-center justify-center">
              <div class="text-caption text-medium-emphasis">No plan yet</div>
            </div>
            <div v-else class="plan-table-scroll">
              <v-table density="compact">
                <thead>
                  <tr>
                    <th class="text-caption text-medium-emphasis">ID</th>
                    <th class="text-caption text-medium-emphasis">Step</th>
                    <th class="text-caption text-medium-emphasis">Status</th>
                    <th class="text-caption text-medium-emphasis">Note</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="s in plan.steps" :key="s.id">
                    <td class="text-caption">{{ s.id }}</td>
                    <td class="text-caption">
                      <span v-if="s.action">{{ s.action }}</span>
                      <span v-else>{{ s.capabilityId || 'step' }}</span>
                    </td>
                    <td>
                      <v-chip size="x-small" :color="s.status === 'done' ? 'success' : s.status === 'in_progress' ? 'info' : s.status === 'skipped' ? 'warning' : 'default'" variant="flat">
                        {{ s.status }}
                      </v-chip>
                    </td>
                    <td class="text-caption">{{ s.note || '' }}</td>
                  </tr>
                </tbody>
              </v-table>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script lang="ts">
export default {
  methods: {
    dotColor(type: string) {
      switch (type) {
        case 'start':
          return 'primary'
        case 'phase':
          return 'secondary'
        case 'delta':
        case 'message':
          return 'info'
        case 'tool_call':
          return 'warning'
        case 'tool_result':
          return 'success'
        case 'handoff':
          return 'purple'
        case 'metrics':
          return 'teal'
        case 'warning':
          return 'orange'
        case 'error':
          return 'red'
        case 'complete':
          return 'green'
        default:
          return 'default'
      }
    },
    showJsonBlock(type: string) {
      return ['tool_call', 'tool_result', 'handoff', 'metrics', 'warning', 'error', 'complete', 'start', 'phase'].includes(type)
    },
    stringify(obj: unknown) {
      try {
        return JSON.stringify(obj, null, 2)
      } catch {
        return String(obj)
      }
    },
  },
}
</script>

<style scoped>
.conversation-box {
  min-height: 200px;
  max-height: 520px;
  overflow: auto;
}
.plan-table-scroll {
  height: 240px;
  overflow: auto;
  padding: 4px 0;
}
</style>
