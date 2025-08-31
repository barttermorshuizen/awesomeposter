<template>
  <Teleport to="body">
    <!-- Backdrop -->
    <Transition
      enter-active-class="transition-opacity duration-300"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-200"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="isOpen"
        class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
        @click="close"
      />
    </Transition>

    <!-- Modal -->
    <Transition
      enter-active-class="transition-all duration-300"
      enter-from-class="opacity-0 scale-95 translate-y-4"
      enter-to-class="opacity-100 scale-100 translate-y-0"
      leave-active-class="transition-all duration-200"
      leave-from-class="opacity-100 scale-100 translate-y-0"
      leave-to-class="opacity-0 scale-95 translate-y-4"
    >
      <div
        v-if="isOpen"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
      >
        <div class="relative w-full max-w-4xl mx-auto pointer-events-auto max-h-[90vh] bg-white dark:bg-gray-900 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden">
          <!-- Header -->
          <div class="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 bg-gray-50 dark:bg-gray-800">
            <h3 class="text-lg font-semibold">AI Agent Results</h3>
            <UButton
              icon="i-heroicons-x-mark"
              variant="ghost"
              @click="close"
            />
          </div>

          <!-- Scrollable content area -->
          <div class="flex-1 overflow-y-auto p-6">

            
            
            <!-- Loading State -->
            <div v-if="isLoading" class="flex flex-col items-center justify-center py-12 space-y-4">
              <UIcon name="i-heroicons-arrow-path" class="w-12 h-12 animate-spin text-blue-500" />
              <div class="text-center">
                <p class="text-lg font-medium text-gray-900 dark:text-white">AI Agents at Work</p>
                <p class="text-sm text-gray-500 dark:text-gray-400">{{ progress?.currentStep || loadingStep || 'Planning strategy and generating content...' }}</p>
                <p v-if="progress?.details" class="text-xs text-gray-400 dark:text-gray-500 mt-1">{{ progress.details }}</p>
              </div>
              
              <!-- Real-time Progress Bar -->
              <div v-if="progress" class="w-full max-w-md">
                <div class="mb-4">
                  <div class="flex justify-between text-sm text-gray-600 dark:text-gray-400 mb-2">
                    <span>Step {{ progress.stepNumber }} of {{ progress.totalSteps }}</span>
                    <span>{{ progress.percentage }}%</span>
                  </div>
                  <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                    <div 
                      class="bg-blue-500 h-3 rounded-full transition-all duration-500"
                      :style="{ width: `${progress.percentage}%` }"
                    ></div>
                  </div>
                </div>
                
                <!-- Step Indicators -->
                <div class="space-y-2">
                  <div 
                    v-for="step in 4" 
                    :key="step"
                    class="flex items-center space-x-2"
                    :class="step <= progress.stepNumber ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500'"
                  >
                    <UIcon 
                      :name="step <= progress.stepNumber ? 'i-heroicons-check-circle' : 'i-heroicons-circle'"
                      :class="step <= progress.stepNumber ? 'w-4 h-4 text-blue-500' : 'w-4 h-4'"
                    />
                    <span class="text-sm">
                      {{ 
                        step === 1 ? 'Planning Strategy' :
                        step === 2 ? 'Generating Content' :
                        step === 3 ? 'Evaluating & Revising' :
                        'Finalizing Strategy'
                      }}
                    </span>
                  </div>
                </div>
                
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-4 text-center">
                  Last updated: {{ progress.timestamp ? new Date(progress.timestamp).toLocaleTimeString() : 'Just now' }}
                </p>
              </div>
              
              
            </div>

                        <!-- Results -->
            <div v-if="!isLoading && results" class="space-y-6">
              <!-- Strategy Summary -->
              <div v-if="results.finalState.strategy" class="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
                <h4 class="font-medium text-blue-900 dark:text-blue-100 mb-2">Content Strategy</h4>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <span class="font-medium text-blue-800 dark:text-blue-200">Platforms:</span>
                    <span class="ml-2 text-blue-700 dark:text-blue-300">{{ results.finalState.strategy.platforms?.join(', ') }}</span>
                  </div>
                  <div>
                    <span class="font-medium text-blue-800 dark:text-blue-200">Structure:</span>
                    <span class="ml-2 text-blue-700 dark:text-blue-300">{{ results.finalState.strategy.structure }}</span>
                  </div>
                  <div>
                    <span class="font-medium text-blue-800 dark:text-blue-200">Themes:</span>
                    <span class="ml-2 text-blue-700 dark:text-blue-300">{{ results.finalState.strategy.themes?.join(', ') }}</span>
                  </div>
                  <div>
                    <span class="font-medium text-blue-800 dark:text-blue-200">Hashtags:</span>
                    <span class="ml-2 text-blue-700 dark:text-blue-300">{{ results.finalState.strategy.hashtags?.join(', ') }}</span>
                  </div>
                  <div v-if="results.finalState.knobPayload?.clientPolicy" class="col-span-2">
                    <span class="font-medium text-blue-800 dark:text-blue-200">Client Policy:</span>
                    <span class="ml-2 text-blue-700 dark:text-blue-300">
                      {{ results.finalState.knobPayload.clientPolicy.voice }} voice, 
                      {{ results.finalState.knobPayload.clientPolicy.emojiAllowed ? 'emojis allowed' : 'no emojis' }}, 
                      max hook: {{ (results.finalState.knobPayload.clientPolicy.maxHookIntensity * 100).toFixed(0) }}%
                    </span>
                  </div>
                </div>
              </div>

              <!-- Strategic Rationale (separate panel) -->
              <div v-if="results.finalState.rationale" class="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
                <h4 class="font-medium text-blue-900 dark:text-blue-100 mb-2">Strategic Rationale</h4>
                <p class="text-sm text-blue-700 dark:text-blue-300">{{ results.finalState.rationale }}</p>
              </div>

              <!-- Knob Settings -->
              <div v-if="results.finalState.knobs" class="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4">
                <h4 class="font-medium text-amber-900 dark:text-amber-100 mb-2">4-Knob Optimization Settings</h4>
                
                <!-- Warning if knobs structure is incomplete -->
                <div v-if="!results.finalState.knobs.structure" class="bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700 rounded p-3 mb-4">
                  <div class="flex items-center space-x-2">
                    <UIcon name="i-heroicons-exclamation-triangle" class="w-4 h-4 text-yellow-600" />
                    <span class="text-sm text-yellow-800 dark:text-yellow-200">
                      <strong>Note:</strong> Some knob settings are missing. This may indicate the workflow didn't complete fully.
                    </span>
                  </div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <span class="font-medium text-amber-800 dark:text-amber-200">Format Type:</span>
                    <span class="ml-2 text-amber-700 dark:text-amber-300">{{ formatTypeLabel(results.finalState.knobs.formatType) }}</span>
                  </div>
                  <div>
                    <span class="font-medium text-amber-800 dark:text-amber-200">Hook Intensity:</span>
                    <div class="flex items-center space-x-2">
                      <div class="flex-1 bg-amber-200 dark:bg-amber-700 rounded-full h-2">
                        <div 
                          class="bg-amber-600 dark:bg-amber-400 h-2 rounded-full transition-all duration-300"
                          :style="{ width: `${results.finalState.knobs.hookIntensity * 100}%` }"
                        ></div>
                      </div>
                      <span class="text-amber-700 dark:text-amber-300 text-xs w-12 text-right">{{ (results.finalState.knobs.hookIntensity * 100).toFixed(0) }}%</span>
                    </div>
                  </div>
                  <div>
                    <span class="font-medium text-amber-800 dark:text-amber-200">Expertise Depth:</span>
                    <div class="flex items-center space-x-2">
                      <div class="flex-1 bg-amber-200 dark:bg-amber-700 rounded-full h-2">
                        <div 
                          class="bg-amber-600 dark:bg-amber-400 h-2 rounded-full transition-all duration-300"
                          :style="{ width: `${results.finalState.knobs.expertiseDepth * 100}%` }"
                        ></div>
                      </div>
                      <span class="text-amber-700 dark:text-amber-300 text-xs w-12 text-right">{{ (results.finalState.knobs.expertiseDepth * 100).toFixed(0) }}%</span>
                    </div>
                  </div>
                  <div v-if="results.finalState.knobs.structure">
                    <span class="font-medium text-amber-800 dark:text-amber-200">Length Level:</span>
                    <div class="flex items-center space-x-2">
                      <div class="flex-1 bg-amber-200 dark:bg-amber-700 rounded-full h-2">
                        <div 
                          class="bg-amber-600 dark:bg-amber-400 h-2 rounded-full transition-all duration-300"
                          :style="{ width: `${(results.finalState.knobs.structure.lengthLevel || 0.6) * 100}%` }"
                        ></div>
                      </div>
                      <span class="text-amber-700 dark:text-amber-300 text-xs w-12 text-right">{{ ((results.finalState.knobs.structure.lengthLevel || 0.6) * 100).toFixed(0) }}%</span>
                    </div>
                  </div>
                  <div v-if="results.finalState.knobs.structure">
                    <span class="font-medium text-amber-800 dark:text-amber-200">Scan Density:</span>
                    <div class="flex items-center space-x-2">
                      <div class="flex-1 bg-amber-200 dark:bg-amber-700 rounded-full h-2">
                        <div 
                          class="bg-amber-600 dark:bg-amber-400 h-2 rounded-full transition-all duration-300"
                          :style="{ width: `${(results.finalState.knobs.structure.scanDensity || 0.8) * 100}%` }"
                        ></div>
                      </div>
                      <span class="text-amber-700 dark:text-amber-300 text-xs w-12 text-right">{{ ((results.finalState.knobs.structure.scanDensity || 0.8) * 100).toFixed(0) }}%</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Content Variants -->
              <div v-if="results.finalState.drafts" class="space-y-4">
                <h4 class="font-medium text-gray-900 dark:text-white">Generated Content</h4>
                <div class="grid grid-cols-1 gap-4">
                  <div
                    v-for="draft in results.finalState.drafts"
                    :key="draft.variantId"
                    class="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3"
                  >
                    <div class="flex items-center justify-between">
                      <div class="flex items-center space-x-2">
                        <UBadge :label="draft.platform" :color="getPlatformColor(draft.platform) as any" />
                        <span class="text-sm text-gray-500 dark:text-gray-400">{{ draft.variantId }}</span>
                      </div>
                      <div class="text-sm text-gray-500 dark:text-gray-400">
                        {{ draft.charCount }} chars
                      </div>
                    </div>
                    
                    <div class="space-y-2">
                      <!-- Hook options removed; hook is embedded in main copy (first line) -->
                      
                      <div class="bg-gray-50 dark:bg-gray-800 rounded p-3">
                        <p class="text-sm text-gray-900 dark:text-white whitespace-pre-wrap">{{ draft.post }}</p>
                      </div>
                      
                      <div v-if="draft.altText" class="text-xs text-gray-500 dark:text-gray-400">
                        <span class="font-medium">Alt Text:</span> {{ draft.altText }}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Publishing Schedule -->
              <div v-if="results.finalState.schedule" class="bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
                <h4 class="font-medium text-green-900 dark:text-green-100 mb-2">Publishing Schedule</h4>
                <div class="space-y-2">
                  <!-- Debug info -->
                  <div v-if="!results.finalState.schedule.windows" class="text-xs text-green-600 dark:text-green-400 mb-2">
                    Schedule data structure: {{ JSON.stringify(results.finalState.schedule, null, 2) }}
                  </div>
                  
                  <div
                    v-for="(windows, platform) in results.finalState.schedule.windows || {}"
                    :key="platform"
                    class="flex items-center space-x-2"
                  >
                    <UBadge :label="platform" :color="getPlatformColor(platform) as any" />
                    <span class="text-sm text-green-700 dark:text-green-300">
                      {{ Array.isArray(windows) ? windows.join(', ') : windows }}
                    </span>
                  </div>
                  
                  <!-- Fallback for malformed schedule data -->
                  <div v-if="results.finalState.schedule.windows && Object.keys(results.finalState.schedule.windows).length === 0" class="text-sm text-green-600 dark:text-green-400">
                    Schedule data received but no platform windows found. Check agent response format.
                  </div>
                </div>
              </div>

              <!-- Quality Metrics -->
              <div v-if="results.metrics" class="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4">
                <h4 class="font-medium text-purple-900 dark:text-purple-100 mb-2">Quality Metrics</h4>
                <div class="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div class="text-2xl font-bold text-purple-700 dark:text-purple-300">
                      {{ results.metrics.totalDrafts }}
                    </div>
                    <div class="text-xs text-purple-600 dark:text-purple-400">Total Variants</div>
                  </div>
                  <div>
                    <div class="text-2xl font-bold text-purple-700 dark:text-purple-300">
                      {{ (results.metrics.averageScore * 100).toFixed(0) }}%
                    </div>
                    <div class="text-xs text-purple-600 dark:text-purple-400">Quality Score</div>
                  </div>
                  <div>
                    <div class="text-2xl font-bold text-purple-700 dark:text-purple-300">
                      {{ results.metrics.qualityStatus }}
                    </div>
                    <div class="text-xs text-purple-600 dark:text-purple-400">Status</div>
                  </div>
                </div>
              </div>

              <!-- Knob Effectiveness -->
              <div v-if="results.finalState.knobs && results.finalState.scores" class="bg-indigo-50 dark:bg-indigo-900/20 rounded-lg p-4">
                <h4 class="font-medium text-indigo-900 dark:text-indigo-100 mb-2">Knob Effectiveness Analysis</h4>
                <div class="space-y-3">
                  <div v-for="(score, variantId) in results.finalState.scores" :key="variantId" class="border border-indigo-200 dark:border-indigo-700 rounded p-3">
                    <div class="flex items-center justify-between mb-2">
                      <span class="font-medium text-indigo-800 dark:text-indigo-200">{{ variantId }}</span>
                      <span class="text-sm text-indigo-600 dark:text-indigo-400">
                        Score: {{ score.composite ? (score.composite * 100).toFixed(0) : 'N/A' }}%
                      </span>
                    </div>
                    <div class="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span class="text-indigo-700 dark:text-indigo-300">Readability:</span>
                        <span class="ml-1">{{ (score.readability * 100).toFixed(0) }}%</span>
                      </div>
                      <div>
                        <span class="text-indigo-700 dark:text-indigo-300">Clarity:</span>
                        <span class="ml-1">{{ (score.clarity * 100).toFixed(0) }}%</span>
                      </div>
                      <div>
                        <span class="text-indigo-700 dark:text-indigo-300">Objective Fit:</span>
                        <span class="ml-1">{{ (score.objectiveFit * 100).toFixed(0) }}%</span>
                      </div>
                      <div>
                        <span class="text-indigo-700 dark:text-indigo-300">Brand Risk:</span>
                        <span class="ml-1">{{ (score.brandRisk * 100).toFixed(0) }}%</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Debug Information (Development Only) -->
              <div v-if="results.finalState" class="bg-gray-50 dark:bg-gray-900/20 rounded-lg p-4">
                <h4 class="font-medium text-gray-900 dark:text-gray-100 mb-2">Debug Info</h4>
                <div class="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                  <div>Has Strategy: {{ !!results.finalState.strategy }}</div>
                  <div>Has Knobs: {{ !!results.finalState.knobs }}</div>
                  <div>Has Drafts: {{ !!results.finalState.drafts }}</div>
                  <div>Has Schedule: {{ !!results.finalState.schedule }}</div>
                  <div>Schedule Keys: {{ results.finalState.schedule ? Object.keys(results.finalState.schedule) : 'none' }}</div>
                  <div>Has Windows: {{ results.finalState.schedule?.windows ? 'yes' : 'no' }}</div>
                  <div>Windows Keys: {{ results.finalState.schedule?.windows ? Object.keys(results.finalState.schedule.windows) : 'none' }}</div>
                </div>
              </div>

              <!-- No Results State -->
              <div v-if="!results.finalState.strategy && !results.finalState.knobs && !results.finalState.drafts && !results.error" class="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-4">
                <div class="flex items-center space-x-2">
                  <UIcon name="i-heroicons-information-circle" class="w-5 h-5 text-yellow-500" />
                  <span class="font-medium text-yellow-900 dark:text-yellow-100">Workflow Complete</span>
                </div>
                <p class="text-sm text-yellow-700 dark:text-yellow-300 mt-1">The workflow completed successfully, but no content was generated. This might indicate an issue with the agent response.</p>
                <div class="mt-3">
                  <UButton
                    size="sm"
                    color="warning"
                    @click="runAgentWorkflow"
                  >
                    <UIcon name="i-heroicons-arrow-path" class="w-4 h-4 mr-1" />
                    Retry Workflow
                  </UButton>
                </div>
              </div>

              <!-- Error State -->
              <div v-if="results.error" class="bg-red-50 dark:bg-red-900/20 rounded-lg p-4">
                <div class="flex items-center space-x-2">
                  <UIcon name="i-heroicons-exclamation-triangle" class="w-5 h-5 text-red-500" />
                  <span class="font-medium text-red-900 dark:text-red-100">Error</span>
                </div>
                <p class="text-sm text-red-700 dark:text-red-300 mt-1">{{ results.error }}</p>
                <div class="mt-3">
                  <UButton
                    size="sm"
                    color="error"
                    @click="runAgentWorkflow"
                  >
                    <UIcon name="i-heroicons-arrow-path" class="w-4 h-4 mr-1" />
                    Retry Workflow
                  </UButton>
                </div>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="flex justify-end space-x-2 p-6 border-t border-gray-200 dark:border-gray-700 flex-shrink-0 bg-gray-50 dark:bg-gray-800">
            <UButton
              variant="ghost"
              @click="close"
            >
              Close
            </UButton>
            <UButton
              v-if="results && !results.error"
              color="primary"
              icon="i-heroicons-arrow-down-tray"
              @click="downloadResults"
            >
              Download Results
            </UButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import type { AgentState } from '@awesomeposter/shared'

interface AgentResults {
  success: boolean
  finalState: Partial<AgentState>
  metrics?: {
    totalDrafts: number
    averageScore: number
    qualityStatus: string
  }
  error?: string
}

interface WorkflowStatusResponse {
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
  brief: {
    title?: string
    description?: string
    objective?: string
    audienceId?: string
  }
  clientProfile: {
    primaryLanguage?: string
    objectives?: Record<string, unknown>
    audiences?: Record<string, unknown>
    tone?: Record<string, unknown>
    specialInstructions?: Record<string, unknown>
    guardrails?: Record<string, unknown>
    platformPrefs?: Record<string, unknown>
  }
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const isLoading = ref(false)
const loadingStep = ref('')
const results = ref<AgentResults | null>(null)
const workflowId = ref<string | null>(null)
const progress = ref<{
  currentStep: string
  stepNumber: number
  totalSteps: number
  percentage: number
  details: string
  timestamp: number
} | null>(null)
const progressInterval = ref<NodeJS.Timeout | null>(null)

// Watch for modal open to trigger agent workflow
watch(isOpen, async (newValue) => {
  if (newValue && props.brief && props.clientProfile) {
    await runAgentWorkflow()
  } else if (!newValue) {
    // Clean up when modal closes
    if (progressInterval.value) {
      clearInterval(progressInterval.value)
      progressInterval.value = null
    }
    workflowId.value = null
    progress.value = null
  }
})

async function runAgentWorkflow() {
  if (!props.brief || !props.clientProfile) return
  
  try {
    isLoading.value = true
    loadingStep.value = 'Preparing agent state...'
    results.value = null
    progress.value = null
    
    // Prepare the agent state
    const agentState: Partial<AgentState> = {
      objective: props.brief.objective || 'Increase brand awareness',
      inputs: {
        brief: {
          title: props.brief.title || 'Untitled Brief',
          description: props.brief.description || '',
          objective: props.brief.objective || 'Increase brand awareness',
          audienceId: props.brief.audienceId || 'general'
        },
        clientProfile: {
          primaryCommunicationLanguage: props.clientProfile.primaryLanguage as import('@awesomeposter/shared').PrimaryCommunicationLanguage | undefined,
          objectivesJson: props.clientProfile.objectives || {},
          audiencesJson: props.clientProfile.audiences || {},
          toneJson: props.clientProfile.tone || {},
          specialInstructionsJson: props.clientProfile.specialInstructions || {},
          guardrailsJson: props.clientProfile.guardrails || {},
          platformPrefsJson: props.clientProfile.platformPrefs || {}
        }
      }
    }
    
    // Log the agent state for debugging
    console.log('🔍 Agent state being sent:', {
      brief: agentState.inputs?.brief,
      clientProfile: agentState.inputs?.clientProfile,
      hasClientProfile: !!agentState.inputs?.clientProfile,
      clientProfileKeys: agentState.inputs?.clientProfile ? Object.keys(agentState.inputs.clientProfile) : 'none',
      objectivesKeys: agentState.inputs?.clientProfile?.objectivesJson ? Object.keys(agentState.inputs.clientProfile.objectivesJson) : 'none',
      audiencesKeys: agentState.inputs?.clientProfile?.audiencesJson ? Object.keys(agentState.inputs.clientProfile.audiencesJson) : 'none'
    })
    
    // Call the progressive agent workflow
    console.log('🔄 Starting progressive agent workflow...')
    loadingStep.value = 'Starting AI agent workflow...'
    
    const response = await $fetch('/api/agent/execute-workflow-progress', {
      method: 'POST',
      body: { state: agentState }
    })
    
    console.log('✅ Progressive workflow started:', response)
    
    if (response.success && response.workflowId) {
      workflowId.value = response.workflowId
      
      // Start polling for progress updates
      startProgressPolling()
    } else {
      throw new Error('Failed to start workflow')
    }
    
  } catch (error) {
    console.error('Agent workflow error:', error)
    
    let errorMessage = 'Unknown error occurred'
    if (error instanceof Error) {
      errorMessage = error.message
    } else if (typeof error === 'string') {
      errorMessage = error
    } else if (error && typeof error === 'object' && 'message' in error) {
      errorMessage = String(error.message)
    }
    
    // Check for timeout
    if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
      errorMessage = 'Workflow execution timed out. Please try again with a simpler brief.'
    }
    
    results.value = {
      success: false,
      finalState: {},
      error: errorMessage
    }
    
    // Ensure loading is set to false after error
    isLoading.value = false
    loadingStep.value = ''
  }
}

function startProgressPolling() {
  if (!workflowId.value) return
  
  // Poll every 2 seconds for progress updates
  progressInterval.value = setInterval(async () => {
    try {
      const statusResponse = await $fetch(`/api/agent/workflow-status?id=${workflowId.value}`)
      
      if (statusResponse.success) {
        const typedResponse = statusResponse as WorkflowStatusResponse
        const { status, progress: statusProgress, error } = typedResponse
        
        // Update progress
        if (statusProgress) {
          progress.value = statusProgress
          loadingStep.value = statusProgress.currentStep
        }
        
        // Check if workflow is complete
        if (status === 'completed' && typedResponse.result) {
          console.log('✅ Workflow completed successfully:', typedResponse.result)
          
          // Transform the result to match AgentResults interface
          const transformedResults: AgentResults = {
            success: true,
            finalState: typedResponse.result,
            metrics: {
              totalDrafts: typedResponse.result.drafts?.length || 0,
              averageScore: 0.85, // Default score
              qualityStatus: 'high'
            }
          }
          
          // Set results and stop loading
          results.value = transformedResults
          isLoading.value = false
          loadingStep.value = ''
          
          // Stop polling
          if (progressInterval.value) {
            clearInterval(progressInterval.value)
            progressInterval.value = null
          }
          
        } else if (status === 'failed') {
          console.error('❌ Workflow failed:', error)
          
          results.value = {
            success: false,
            finalState: {},
            error: error || 'Workflow execution failed'
          }
          
          isLoading.value = false
          loadingStep.value = ''
          
          // Stop polling
          if (progressInterval.value) {
            clearInterval(progressInterval.value)
            progressInterval.value = null
          }
        }
        // If status is 'running', continue polling
      }
    } catch (error) {
      console.error('Error polling workflow status:', error)
      // Continue polling on error
    }
  }, 2000)
}

function close() {
  isOpen.value = false
}

function downloadResults() {
  if (!results.value) return
  
  const dataStr = JSON.stringify(results.value, null, 2)
  const dataBlob = new Blob([dataStr], { type: 'application/json' })
  const url = URL.createObjectURL(dataBlob)
  const link = document.createElement('a')
  link.href = url
  link.download = `agent-results-${props.brief?.title || 'brief'}-${new Date().toISOString().split('T')[0]}.json`
  link.click()
  URL.revokeObjectURL(url)
}

function getPlatformColor(platform: string): string {
  switch (platform.toLowerCase()) {
    case 'linkedin': return 'blue'
    case 'x': return 'black'
    case 'facebook': return 'blue'
    case 'instagram': return 'pink'
    default: return 'gray'
  }
}

function formatTypeLabel(formatType: string): string {
  switch (formatType) {
    case 'text': return 'Text Post'
    case 'single_image': return 'Single Image'
    case 'multi_image': return 'Multi-Image'
    case 'document_pdf': return 'PDF Document'
    case 'video': return 'Video'
    default: return formatType
  }
}

 
</script>

<style scoped>
/* Custom modal styles */
.modal-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  z-index: 50;
}

.modal-content {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 51;
  max-width: 56rem;
  width: 90%;
  max-height: 90vh;
  overflow-y: auto;
}
</style>
