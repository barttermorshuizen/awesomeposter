<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import type { AgentState } from '@awesomeposter/shared'

type BriefInput = {
  id: string
  clientId: string
  title: string | null
  description?: string | null
  objective?: string | null
  audienceId?: string | null
} | null

type AgentResults = {
  success: boolean
  finalState: Partial<AgentState>
  metrics?: {
    totalDrafts: number
    averageScore: number
    qualityStatus: string
  }
  error?: string
} | null

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
  result?: Partial<AgentState>
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

const isLoading = ref(false)
const loadingStep = ref<string>('')
const results = ref<AgentResults>(null)
const workflowId = ref<string | null>(null)
const progress = ref<WorkflowStatus['progress'] | null>(null)
let pollTimer: ReturnType<typeof setInterval> | null = null

watch(isOpen, async (open) => {
  if (open && props.brief?.id) {
    results.value = null
    progress.value = null
    await runAgentWorkflow()
  } else if (!open) {
    cleanupPolling()
  }
})

onBeforeUnmount(() => {
  cleanupPolling()
})

function close() {
  isOpen.value = false
}

function cleanupPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  workflowId.value = null
  isLoading.value = false
  loadingStep.value = ''
  progress.value = null
}

async function runAgentWorkflow() {
  if (!props.brief?.id || !props.brief.clientId) return
  try {
    isLoading.value = true
    loadingStep.value = 'Loading client profile...'

    // 1) Load client profile for the given brief's client
    const profRes = await fetch(`/api/clients/${props.brief.clientId}/profile`, {
      headers: { accept: 'application/json' }
    })
    const profData = await profRes.json().catch(() => ({}))
    if (!profRes.ok || profData?.ok !== true) {
      throw new Error(profData?.statusMessage || profData?.error || 'Failed to load client profile')
    }

    // 2) Build minimal agent state from brief + profile
    loadingStep.value = 'Starting AI workflow...'
    const state: AgentState = {
      objective: props.brief.objective || 'Create high-quality social post variants',
      inputs: {
        brief: {
          id: props.brief.id,
          title: props.brief.title || '',
          description: props.brief.description || '',
          objective: props.brief.objective || '',
          audienceId: props.brief.audienceId || undefined
        },
        clientProfile: {
          primaryCommunicationLanguage: profData.profile?.primaryLanguage,
          objectivesJson: profData.profile?.objectives || {},
          audiencesJson: profData.profile?.audiences || {},
          toneJson: profData.profile?.tone || {},
          specialInstructionsJson: profData.profile?.specialInstructions || {},
          guardrailsJson: profData.profile?.guardrails || {},
          platformPrefsJson: profData.profile?.platformPrefs || {}
        }
      }
    }

    // 3) Start progressive workflow
    const startRes = await fetch('/api/agent/execute-workflow-progress', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ state })
    })
    const startData = await startRes.json().catch(() => ({}))
    if (!startRes.ok || startData?.success !== true || !startData?.workflowId) {
      throw new Error(startData?.statusMessage || startData?.error || 'Failed to start workflow')
    }

    workflowId.value = startData.workflowId
    loadingStep.value = 'AI agents running...'

    // 4) Poll status
    pollTimer = setInterval(async () => {
      try {
        const res = await fetch(`/api/agent/workflow-status?id=${encodeURIComponent(workflowId.value!)}`, {
          headers: { accept: 'application/json' }
        })
        if (!res.ok) {
          // 404 until orchestrator updates status is possible; ignore brief glitches
          if (res.status === 404) return
          throw new Error(`Status HTTP ${res.status}`)
        }
        const data = await res.json() as WorkflowStatus
        progress.value = data.progress

        if (data.status === 'completed') {
          cleanupPolling()
          results.value = {
            success: true,
            finalState: data.result || {}
          }
          isLoading.value = false
        } else if (data.status === 'failed') {
          cleanupPolling()
          results.value = {
            success: false,
            finalState: {},
            error: data.error || 'Workflow failed'
          }
          isLoading.value = false
        }
      } catch {
        // Non-fatal while polling; keep UI responsive
      }
    }, 1500)
  } catch (e: unknown) {
    cleanupPolling()
    results.value = {
      success: false,
      finalState: {},
      error: (e as Error)?.message || 'Unknown error'
    }
  } finally {
    // Keep loading active while polling is ongoing; it will be cleared on completion/failure
  }
}

function getPlatformColor(platform: string): string {
  switch (platform) {
    case 'linkedin': return 'primary'
    case 'x': return 'grey'
    default: return 'secondary'
  }
}

function formatTypeLabel(type?: string) {
  switch (type) {
    case 'text': return 'Text'
    case 'single_image': return 'Single image'
    case 'multi_image': return 'Carousel'
    case 'document_pdf': return 'Document'
    case 'video': return 'Video'
    default: return type || '—'
  }
}

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
          <!-- Strategy -->
          <v-alert type="info" variant="tonal" class="mb-4" v-if="results?.finalState?.strategy">
            <div class="text-subtitle-2 mb-2">Content Strategy</div>
            <div class="d-flex flex-wrap ga-2 mb-2">
              <template v-for="p in (results?.finalState?.strategy?.platforms || [])" :key="p">
                <v-chip :color="getPlatformColor(p)" size="small" label>{{ p }}</v-chip>
              </template>
            </div>
            <div class="text-body-2">
              <div><strong>Structure:</strong> {{ results?.finalState?.strategy?.structure }}</div>
              <div><strong>Themes:</strong> {{ (results?.finalState?.strategy?.themes || []).join(', ') }}</div>
              <div><strong>Hashtags:</strong> {{ (results?.finalState?.strategy?.hashtags || []).join(', ') }}</div>
            </div>
          </v-alert>

          <!-- Rationale -->
          <v-alert type="info" variant="outlined" class="mb-4" v-if="results?.finalState?.rationale">
            <div class="text-subtitle-2 mb-1">Strategic Rationale</div>
            <div class="text-body-2">{{ results?.finalState?.rationale }}</div>
          </v-alert>

          <!-- Knobs -->
          <v-card variant="tonal" class="mb-4" v-if="results?.finalState?.knobs">
            <v-card-title class="text-subtitle-2">4-Knob Optimization Settings</v-card-title>
            <v-card-text>
              <div class="text-body-2 mb-2"><strong>Format:</strong> {{ formatTypeLabel(results?.finalState?.knobs?.formatType) }}</div>
              <div class="mb-2">
                <div class="d-flex justify-space-between text-caption mb-1">
                  <span>Hook Intensity</span><span>{{ Math.round((results?.finalState?.knobs?.hookIntensity || 0) * 100) }}%</span>
                </div>
                <v-progress-linear :model-value="(results?.finalState?.knobs?.hookIntensity || 0) * 100" color="amber" height="8" rounded />
              </div>
              <div class="mb-2">
                <div class="d-flex justify-space-between text-caption mb-1">
                  <span>Expertise Depth</span><span>{{ Math.round((results?.finalState?.knobs?.expertiseDepth || 0) * 100) }}%</span>
                </div>
                <v-progress-linear :model-value="(results?.finalState?.knobs?.expertiseDepth || 0) * 100" color="deep-purple" height="8" rounded />
              </div>
              <div class="mb-2" v-if="results?.finalState?.knobs?.structure">
                <div class="d-flex justify-space-between text-caption mb-1">
                  <span>Length Level</span><span>{{ Math.round(((results?.finalState?.knobs?.structure?.lengthLevel ?? 0.6) * 100)) }}%</span>
                </div>
                <v-progress-linear :model-value="((results?.finalState?.knobs?.structure?.lengthLevel ?? 0.6) * 100)" color="blue" height="8" rounded />
              </div>
              <div class="mb-2" v-if="results?.finalState?.knobs?.structure">
                <div class="d-flex justify-space-between text-caption mb-1">
                  <span>Scan Density</span><span>{{ Math.round(((results?.finalState?.knobs?.structure?.scanDensity ?? 0.8) * 100)) }}%</span>
                </div>
                <v-progress-linear :model-value="((results?.finalState?.knobs?.structure?.scanDensity ?? 0.8) * 100)" color="teal" height="8" rounded />
              </div>
            </v-card-text>
          </v-card>

          <!-- Drafts -->
          <div v-if="results?.finalState?.drafts?.length">
            <div class="text-subtitle-2 mb-2">Generated Content</div>
            <div class="d-flex flex-column ga-3">
              <v-card v-for="draft in results?.finalState?.drafts" :key="draft.variantId || draft.platform" variant="outlined">
                <v-card-text>
                  <div class="d-flex justify-space-between align-center mb-2">
                    <div class="d-flex align-center ga-2">
                      <v-chip :color="getPlatformColor(draft.platform)" size="small" label>{{ draft.platform }}</v-chip>
                      <span class="text-caption text-medium-emphasis">{{ draft.variantId }}</span>
                    </div>
                    <div class="text-caption text-medium-emphasis">
                      {{ draft.charCount || (draft.post?.length || 0) }} chars
                    </div>
                  </div>
                  <div class="pa-3 rounded" style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06)">
                    <pre style="white-space: pre-wrap; font-family: inherit; margin: 0;" class="text-body-2">{{ draft.post }}</pre>
                  </div>
                  <div v-if="draft.altText" class="text-caption text-medium-emphasis mt-2"><strong>Alt Text:</strong> {{ draft.altText }}</div>
                </v-card-text>
              </v-card>
            </div>
          </div>

          <!-- Schedule -->
          <v-card variant="tonal" class="mt-4" v-if="results?.finalState?.schedule">
            <v-card-title class="text-subtitle-2">Publishing Schedule</v-card-title>
            <v-card-text class="d-flex flex-column ga-2">
              <template v-for="(windows, platform) in (results?.finalState?.schedule?.windows || {})" :key="platform">
                <div class="d-flex align-center ga-2">
                  <v-chip :color="getPlatformColor(String(platform))" size="x-small" label>{{ platform }}</v-chip>
                  <span class="text-body-2">{{ Array.isArray(windows) ? windows.join(', ') : String(windows) }}</span>
                </div>
              </template>
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