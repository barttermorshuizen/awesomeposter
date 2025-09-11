<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import type { AgentRunRequest } from '@awesomeposter/shared'
import type { Asset } from '@awesomeposter/shared'
import { postEventStream, type AgentEventWithId } from '@/lib/agent-sse'
import type { AppResult } from '@awesomeposter/shared'

type BriefInput = {
  id: string
  clientId: string
  title: string | null
  description?: string | null
  objective?: string | null
  audienceId?: string | null
} | null

type UiKnobs = { [k: string]: unknown }
type UiFinalState = { content?: string; platform?: string; rationale?: string | null; knobSettings?: UiKnobs; qualityReport?: unknown }

type AgentResults = {
  success: boolean
  finalState: UiFinalState
  metrics?: {
    totalDrafts: number
    averageScore: number
    qualityStatus: string
  }
  error?: string
} | null

// Legacy progress type kept so template remains compatible (we don't use server polling anymore)
type WorkflowStatus = {
  success: boolean
  workflowId: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: {
    currentStep: string
    stepNumber: number
    totalSteps: number
    percentage: number
    details: string
    timestamp: number
  }
  result?: UiFinalState
  error?: string
  startedAt: number
  updatedAt: number
}

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

// UI state
const isLoading = ref(false)
const loadingStep = ref<string>('')
const results = ref<AgentResults>(null)
// Retained for compatibility with template (we won't receive percentage/steps from SSE)
const progress = ref<WorkflowStatus['progress'] | null>(null)

// Streaming handle
let streamHandle: { abort: () => void; done: Promise<void> } | null = null
const correlationId = ref<string | undefined>(undefined)
const knobsView = computed<UiKnobs | null>(() => (results.value?.finalState?.knobSettings as UiKnobs | undefined) ?? null)

watch(isOpen, async (open) => {
  if (open && props.brief?.id) {
    reset()
    await runAgentWorkflow()
  } else if (!open) {
    stopStream()
  }
})

onBeforeUnmount(() => {
  stopStream()
})

function reset() {
  results.value = null
  progress.value = null
  isLoading.value = false
  loadingStep.value = ''
  correlationId.value = undefined
}

function close() {
  isOpen.value = false
}

function stopStream() {
  try { streamHandle?.abort() } catch {}
  streamHandle = null
  isLoading.value = false
  loadingStep.value = ''
}

function genCid(): string {
  return 'cid_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
}

function safeJson(v: unknown) {
  try { return JSON.stringify(v, null, 2) } catch { return String(v) }
}
//

function pickBriefObjective(brief: { objective?: string | null; description?: string | null } | null | undefined) {
  const obj = (brief?.objective || '').trim()
  if (obj) return obj
  const desc = (brief?.description || '').trim()
  if (desc) return `Create social post variants based on: ${desc}`
  return 'Create high-quality social post variants.'
}

/**
 * Build a full objective for the orchestrator so it needs no knowledge of our data model.
 * Includes client profile info, brief info, and assets. Also specifies output constraints.
 */
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
  lines.push('')
  // App result constraints (aligned with AppResult)
  lines.push(
    'Output requirements:',
    '- Return a single JSON object only (no code fences, no commentary).',
    '- Shape: { "result": { "content": "<string>", "platform": "<string>" }, "rationale"?: "<string>", "knobSettings"?: { ... }, "quality-report"?: { ... } }',
    '- The "result.content" must be plain text only (no Markdown, no code fences, no embedded JSON).'
  )
  return lines.join('\n')
}

async function runAgentWorkflow() {
  if (!props.brief?.id || !props.brief.clientId) return
  try {
    isLoading.value = true
    loadingStep.value = 'Loading client profile...'

    // 1) Load client profile
    const profRes = await fetch(`/api/clients/${props.brief.clientId}/profile`, {
      headers: { accept: 'application/json' }
    })
    const profData = await profRes.json().catch(() => ({}))
    if (!profRes.ok || profData?.ok !== true) {
      throw new Error(profData?.statusMessage || profData?.error || 'Failed to load client profile')
    }

    // 2) Load full brief
    loadingStep.value = 'Loading brief details...'
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
    loadingStep.value = 'Loading assets...'
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

    // 4) Build complete objective (no briefId, no state)
    loadingStep.value = 'Starting agents...'
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
        // Keep the structure close to what the orchestrator can reason about
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

    const cid = genCid()
    const body: AgentRunRequest = {
      mode: 'app',
      objective,
      // Do not send briefId; provide all context in objective
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
      onBackoff: ({ retryAfter }) => {
        loadingStep.value = `Server busy. Retrying in ${retryAfter}s...`
      },
      onEvent: (evt: AgentEventWithId) => {
        switch (evt.type) {
          case 'phase': {
            const label = evt.phase === 'analysis' ? 'Planning strategy'
              : evt.phase === 'generation' ? 'Generating content'
              : evt.phase === 'qa' ? 'Evaluating & revising'
              : evt.phase === 'finalization' ? 'Finalizing'
              : 'Running'
            loadingStep.value = label
            break
          }
          case 'warning': {
            // Non-fatal; keep running
            break
          }
          case 'error': {
            // Stop and show error
            stopStream()
            results.value = {
              success: false,
              finalState: {},
              error: evt.message || 'Unknown error'
            }
            break
          }
          case 'complete': {
            // Finalize and map to simplified UI state
            const data = (evt.data as AppResult)
            const fs: UiFinalState = {
              content: data.result.content,
              platform: data.result.platform,
              rationale: data.rationale ?? null
            }
            const ks = (data as unknown as { knobSettings?: unknown }).knobSettings
            if (ks != null) {
              fs.knobSettings = ks as UiKnobs
            }
            const qr = (data as unknown as { ['quality-report']?: unknown })['quality-report']
            if (qr != null) fs.qualityReport = qr
            results.value = { success: true, finalState: fs }
            stopStream()
            break
          }
        }
      }
    });

    await streamHandle.done
  } catch (e: unknown) {
    stopStream()
    results.value = {
      success: false,
      finalState: {},
      error: (e as Error)?.message || 'Unknown error'
    }
  } finally {
    // Keep loading active while streaming; stopStream() will clear it on completion/error
  }
}

function getPlatformColor(platform: string): string {
  switch (platform) {
    case 'linkedin': return 'primary'
    case 'x': return 'grey'
    default: return 'secondary'
  }
}

//

function downloadResults() {
  if (!results.value) return
  const blob = new Blob([JSON.stringify(results.value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const safeTitle = (props.brief?.title || 'results').replace(/[^a-z0-9-_]+/gi, '_')
  a.download = `agent_results_${safeTitle}.json`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <v-dialog v-model="isOpen" max-width="980" scrollable>
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon icon="mdi-robot-outline" class="me-2" />
        <div class="d-flex flex-column">
          <span class="text-h6">Create Post</span>
          <small class="text-medium-emphasis">{{ props.brief?.title || '(untitled brief)' }}</small>
        </div>
        <v-spacer />
        <v-btn icon variant="text" @click="close">
          <v-icon icon="mdi-close" />
        </v-btn>
      </v-card-title>

      <v-divider />

      <v-card-text style="max-height: 70vh;">
        <!-- Loading / Progress -->
        <div v-if="isLoading" class="py-6 d-flex flex-column align-center">
          <v-progress-circular indeterminate color="primary" size="36" class="mb-4" />
          <div class="text-body-2 mb-2">{{ progress?.currentStep || loadingStep || 'Planning strategy and generating content...' }}</div>

          <div v-if="progress" class="w-100" style="max-width: 520px">
            <div class="d-flex justify-space-between text-caption text-medium-emphasis mb-1">
              <span>Step {{ progress.stepNumber }} of {{ progress.totalSteps }}</span>
              <span>{{ progress.percentage }}%</span>
            </div>
            <v-progress-linear :model-value="progress.percentage" color="primary" height="10" rounded />

            <div class="mt-3">
              <div class="d-flex align-center mb-1" v-for="step in 4" :key="step">
                <v-icon
                  :icon="step <= (progress?.stepNumber || 0) ? 'mdi-check-circle-outline' : 'mdi-checkbox-blank-circle-outline'"
                  :color="step <= (progress?.stepNumber || 0) ? 'primary' : undefined"
                  size="18"
                  class="me-2"
                />
                <span class="text-caption">
                  {{
                    step === 1 ? 'Planning Strategy' :
                    step === 2 ? 'Generating Content' :
                    step === 3 ? 'Evaluating & Revising' :
                    'Finalizing Strategy'
                  }}
                </span>
              </div>
              <div class="text-caption text-medium-emphasis mt-1">
                Last updated: {{ progress?.timestamp ? new Date(progress.timestamp).toLocaleTimeString() : '—' }}
              </div>
            </div>
          </div>
        </div>

        <!-- Results -->
        <div v-if="!isLoading && results?.success" class="d-flex flex-column ga-4">
          <!-- Generated Post -->
          <v-card variant="outlined" v-if="results?.finalState?.content">
            <v-card-title class="d-flex align-center text-subtitle-2">
              <v-icon icon="mdi-post-outline" class="me-2" />
              Generated Post
              <v-spacer />
              <v-chip v-if="results?.finalState?.platform" :color="getPlatformColor(String(results?.finalState?.platform))" size="x-small" variant="flat">
                {{ results?.finalState?.platform }}
              </v-chip>
            </v-card-title>
            <v-card-text>
              <div class="pa-3 rounded" style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06)">
                <pre style="white-space: pre-wrap; font-family: inherit; margin: 0;" class="text-body-2">{{ results?.finalState?.content }}</pre>
              </div>
            </v-card-text>
          </v-card>

          <!-- Rationale -->
          <v-alert type="info" variant="outlined" class="mb-2" v-if="results?.finalState?.rationale">
            <div class="text-subtitle-2 mb-1">Strategic Rationale</div>
            <div class="text-body-2">{{ results?.finalState?.rationale }}</div>
          </v-alert>

          <!-- Knob Settings -->
          <v-card variant="tonal" class="mb-2" v-if="knobsView">
            <v-card-title class="text-subtitle-2">Knob Settings</v-card-title>
            <v-card-text>
              <pre class="text-caption" style="white-space: pre-wrap; margin: 0">{{ JSON.stringify(knobsView, null, 2) }}</pre>
            </v-card-text>
          </v-card>

          <!-- Quality Report -->
          <v-card variant="outlined" class="mb-2" v-if="results?.finalState?.qualityReport">
            <v-card-title class="text-subtitle-2">Quality Report</v-card-title>
            <v-card-text>
              <pre class="text-caption" style="white-space: pre-wrap; margin: 0">{{ JSON.stringify(results?.finalState?.qualityReport, null, 2) }}</pre>
            </v-card-text>
          </v-card>

          <!-- Debug -->
          <v-expansion-panels density="compact" class="mt-4">
            <v-expansion-panel>
              <v-expansion-panel-title>Debug Info</v-expansion-panel-title>
              <v-expansion-panel-text>
                <pre style="white-space: pre-wrap;" class="text-caption text-medium-emphasis">{{ JSON.stringify(results?.finalState, null, 2) }}</pre>
              </v-expansion-panel-text>
            </v-expansion-panel>
          </v-expansion-panels>
        </div>

        <!-- Error -->
        <v-alert v-if="!isLoading && results?.error" type="error" variant="tonal">
          {{ results?.error }}
        </v-alert>
      </v-card-text>

      <v-divider />

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">Close</v-btn>
        <v-btn color="primary" @click="downloadResults" :disabled="!results || !!results?.error">
          <v-icon icon="mdi-tray-arrow-down" class="me-1" /> Download Results
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.ga-2 { gap: 8px; }
.ga-3 { gap: 12px; }
.ga-4 { gap: 16px; }
</style>
