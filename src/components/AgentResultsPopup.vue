<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import type { AgentRunRequest, AgentEvent, AppResult } from '@awesomeposter/shared'
import { postEventStream, type AgentEventWithId } from '@/lib/agent-sse'
import { normalizeAppResult, type NormalizedAppResult } from '@/lib/normalize-app-result'

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

// Final normalized result
const normalized = ref<NormalizedAppResult | null>(null)
const rawComplete = ref<AppResult | null>(null)

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
  normalized.value = null
  rawComplete.value = null
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

function buildObjective(): string {
  const base = (props.brief?.objective || '').trim() || 'Create high-quality social post variants.'
  const constraint = [
    'Return a single JSON object with shape:',
    '{ "result": { "drafts": [',
    '{ "platform": "text", "variantId": "1", "post": "<plain text>" },',
    '{ "platform": "text", "variantId": "2", "post": "<plain text>" },',
    '{ "platform": "text", "variantId": "3", "post": "<plain text>" }',
    '] }, "rationale"?: "<string>" }.',
    'Use exactly 3 drafts.',
    'The post fields must be plain text only (no Markdown, no code fences, no JSON or objects inside strings).',
    'Do not include any commentary or wrapping outside the JSON.'
  ].join(' ')
  const already = /exactly\s+3\s+distinct|Return a single JSON object with shape/i.test(base)
  return already ? base : `${base} ${constraint}`
}

async function startRun() {
  if (!props.brief?.id) {
    errorMsg.value = 'No brief selected'
    return
  }
  running.value = true
  const cid = genCid()

  const body: AgentRunRequest = {
    mode: 'app',
    objective: buildObjective(),
    briefId: props.brief.id,
    options: {
      schemaName: 'AppResult'
    }
  }

  const url = `${AGENTS_BASE_URL}/api/v1/agent/run.stream`
  const headers: Record<string, string> = {
    'x-correlation-id': cid
  }
  if (AGENTS_AUTH) headers['authorization'] = `Bearer ${AGENTS_AUTH}`

  try {
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
            rawComplete.value = data
            // App mode expected: { result, rationale? }
            try {
              const result = data?.result
              const rationale = data?.rationale ?? null
              normalized.value = normalizeAppResult(result, rationale)
            } catch {
              normalized.value = { drafts: [{ platform: 'generic', variantId: '1', post: '', charCount: 0 }, { platform: 'generic', variantId: '2', post: '', charCount: 0 }, { platform: 'generic', variantId: '3', post: '', charCount: 0 }], rationale: null }
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
  normalized.value = null
  rawComplete.value = null
  startRun()
}

function downloadJson() {
  const payload = {
    correlationId: correlationId.value,
    frames: frames.value.map(f => f.data),
    complete: rawComplete.value,
    normalized: normalized.value
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

function draftColor(platform: string): string {
  switch ((platform || '').toLowerCase()) {
    case 'linkedin': return 'primary'
    case 'x':
    case 'twitter': return 'grey'
    case 'instagram': return 'pink'
    case 'facebook': return 'blue'
    default: return 'secondary'
  }
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
                Generated Variants
              </v-card-title>
              <v-divider />
              <v-card-text>
                <div v-if="!normalized">
                  <div class="d-flex flex-column align-center py-6">
                    <v-progress-circular indeterminate color="primary" size="32" class="mb-2" v-if="running" />
                    <div class="text-medium-emphasis">{{ running ? 'Generating...' : 'No result yet' }}</div>
                  </div>
                </div>

                <div v-else class="d-flex flex-column ga-3">
                  <v-alert
                    v-if="normalized?.rationale"
                    type="info"
                    variant="outlined"
                    class="mb-2"
                  >
                    <div class="text-subtitle-2 mb-1">Rationale</div>
                    <div class="text-body-2">{{ normalized?.rationale }}</div>
                  </v-alert>

                  <v-card
                    v-for="d in normalized.drafts"
                    :key="d.variantId + '_' + d.platform"
                    variant="outlined"
                  >
                    <v-card-text>
                      <div class="d-flex justify-space-between align-center mb-2">
                        <div class="d-flex align-center ga-2">
                          <v-chip :color="draftColor(d.platform)" size="small" label>{{ d.platform }}</v-chip>
                          <span class="text-caption text-medium-emphasis">Variant {{ d.variantId }}</span>
                        </div>
                        <div class="text-caption text-medium-emphasis">{{ d.charCount }} chars</div>
                      </div>
                      <div class="pa-3 rounded" style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06)">
                        <pre style="white-space: pre-wrap; font-family: inherit; margin: 0;" class="text-body-2">{{ d.post }}</pre>
                      </div>
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
        <v-btn color="default" variant="tonal" @click="downloadJson" :disabled="!normalized">
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