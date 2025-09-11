<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import type { AgentRunRequest, AgentEvent, AppResult, Asset } from '@awesomeposter/shared'
import { postEventStream, type AgentEventWithId } from '@/lib/agent-sse'
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

const AGENTS_BASE_URL = import.meta.env.VITE_AGENTS_BASE_URL || 'http://localhost:3002'
const AGENTS_AUTH = import.meta.env.VITE_AGENTS_AUTH_BEARER || undefined

// Run state
const running = ref(false)
const frames = ref<Array<{ id?: string; type: AgentEvent['type']; data: AgentEventWithId; t: number }>>([])
const phase = ref<string | undefined>(undefined)
const correlationId = ref<string | undefined>(undefined)
const errorMsg = ref<string | null>(null)
const backlog = ref<{ busy: boolean; retryAfter: number; pending: number; limit: number }>({ busy: false, retryAfter: 0, pending: 0, limit: 0 })

// Streaming handle
let streamHandle: { abort: () => void; done: Promise<void> } | null = null

// AppResult payload from orchestrator
const appResult = ref<AppResult | null>(null)

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
  phase.value = undefined
  correlationId.value = undefined
  errorMsg.value = null
  backlog.value = { busy: false, retryAfter: 0, pending: 0, limit: 0 }
  appResult.value = null
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
          case 'phase':
            phase.value = evt.phase
            break
          case 'warning':
            // keep running
            break
          case 'error':
            running.value = false
            errorMsg.value = evt.message || 'Unknown error'
            break
          case 'complete': {
            running.value = false
            const data = (evt.data ?? null) as unknown as AppResult
            appResult.value = data
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

//

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
        <v-chip v-if="phase" size="small" color="secondary" variant="flat" class="me-2">
          Phase: {{ phase }}
        </v-chip>
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

        <!-- Live timeline and result two-column layout -->
        <v-row align="stretch" dense>
          <v-col cols="12" md="6">
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
              <v-card-text style="max-height: 480px; overflow: auto">
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
</style>
