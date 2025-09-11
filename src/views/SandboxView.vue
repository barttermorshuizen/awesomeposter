<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import type { AgentEvent, AgentMode, AgentRunRequest } from '@awesomeposter/shared'
// Temporary local alias while shared package builds
type TargetAgentId = 'orchestrator' | 'strategy' | 'generator' | 'qa'

type AgentInfo = { id: TargetAgentId; label: string; supports: ('app' | 'chat')[] }

const AGENTS_BASE_URL = import.meta.env.VITE_AGENTS_BASE_URL || 'http://localhost:3002'

// Controls
const agents = ref<AgentInfo[]>([])
const agentsLoading = ref(true)
const selectedAgentId = ref<TargetAgentId>('orchestrator')
const mode = ref<AgentMode>('chat')
const objective = ref('Say hello and explain what you can do for AwesomePoster.')
const toolPolicy = ref<'auto' | 'required' | 'off'>('auto')
const toolsAllowlistInput = ref('')
const trace = ref(false)

// Run state
const running = ref(false)
const chatText = ref('')
type AgentEventWithSseId = AgentEvent & { id?: string }
type Frame = { id?: string; type: AgentEvent['type']; data: AgentEventWithSseId; t: number }
const frames = ref<Frame[]>([])
const correlationId = ref<string | undefined>(undefined)
const phase = ref<string | undefined>(undefined)
const errorMsg = ref<string | null>(null)

const backlog = reactive({ busy: false, retryAfter: 0, pending: 0, limit: 0 })
let abortController: AbortController | null = null

const canAgentChat = computed(() => {
  const a = agents.value.find((x) => x.id === selectedAgentId.value)
  return !!a && a.supports.includes('chat')
})

function parseAllowlist() {
  return toolsAllowlistInput.value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

async function loadAgents() {
  agentsLoading.value = true
  try {
    const res = await fetch(`${AGENTS_BASE_URL}/api/v1/agent/agents`, {
      headers: { Accept: 'application/json' },
    })
    const json = await res.json()
    agents.value = (json?.agents || []) as AgentInfo[]
  } catch (e) {
    errorMsg.value = `Failed to load agents: ${String(e)}`
  } finally {
    agentsLoading.value = false
  }
}

function resetRun() {
  chatText.value = ''
  frames.value = []
  correlationId.value = undefined
  phase.value = undefined
  backlog.busy = false
  backlog.retryAfter = 0
  backlog.pending = 0
  backlog.limit = 0
  errorMsg.value = null
}

async function startRun() {
  if (running.value) return
  resetRun()
  running.value = true
  abortController = new AbortController()

  const body: AgentRunRequest = {
    mode: mode.value,
    objective: objective.value,
    options: {
      toolPolicy: toolPolicy.value,
      toolsAllowlist: parseAllowlist(),
      trace: trace.value,
      ...(mode.value === 'chat' ? { targetAgentId: selectedAgentId.value } : {}),
    },
  }

  try {
    // Debug: log outgoing request in Sandbox
    console.debug('[Sandbox] startRun', {
      baseUrl: AGENTS_BASE_URL,
      selectedAgentId: selectedAgentId.value,
      mode: mode.value,
      body
    })
    const res = await fetch(`${AGENTS_BASE_URL}/api/v1/agent/run.stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
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
        case 'delta':
          if (evt.message) chatText.value += evt.message
          break
        case 'message':
          if (evt.message) chatText.value = evt.message
          break
        case 'phase':
          phase.value = evt.phase
          break
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
      items.push({ key: `f-${idx}`, type: f.type, t: f.t, data: f.data, message: (f.data as any)?.message })
    }
  })

  if (deltas.length > 0) {
    const firstT = deltas[0].t
    const combined = deltas.map((d) => (d.data as any)?.message || '').join('')
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
                <v-select
                  v-model="selectedAgentId"
                  :items="agents"
                  :loading="agentsLoading"
                  item-title="label"
                  item-value="id"
                  label="Agent"
                  density="comfortable"
                  prepend-inner-icon="mdi-robot-outline"
                  :disabled="running"
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
</style>
