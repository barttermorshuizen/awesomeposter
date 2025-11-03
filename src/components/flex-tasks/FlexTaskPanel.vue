<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { getFacetCatalog, getMarketingCapabilitiesSnapshot, type FacetDefinition } from '@awesomeposter/shared'
import type { Component } from 'vue'
import { useFlexTasksStore, type FlexTaskRecord } from '@/stores/flexTasks'
import { getInputFacetWidgetComponent, getOutputFacetWidgetComponent } from './widgets/registry'
import DefaultFacetWidget from './widgets/DefaultFacetWidget.vue'

const flexTasksStore = useFlexTasksStore()
const { pendingTasks, activeTask, loading, error } = storeToRefs(flexTasksStore)

const submissionNote = ref('')
const validationError = ref<string | null>(null)

const declineDialog = ref(false)
const declineReason = ref('')

type DraftMap = Map<string, unknown>
const draftValues = ref<DraftMap>(new Map())

const facetCatalog = getFacetCatalog()

const capabilityOutputFacetMap = (() => {
  const snapshot = getMarketingCapabilitiesSnapshot()
  return new Map<string, string[]>(
    snapshot.all.map((record) => [record.capabilityId, Array.isArray(record.outputFacets) ? [...record.outputFacets] : []])
  )
})()
const inputFacetPanels = ref<number[]>([])
const fallbackOutputPanels = ref<number[]>([])

function sanitizeFacetNames(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return values
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry): entry is string => entry.length > 0)
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    output.push(value)
  }
  return output
}

function resolveOutputFacetNames(task: FlexTaskRecord): string[] {
  const fromFacets = sanitizeFacetNames(task.facets?.output ?? [])
  const contract = task.contracts?.output
  const fromContract = contract?.mode === 'facets' ? sanitizeFacetNames(contract.facets) : []
  const fromCapability =
    task.capabilityId && capabilityOutputFacetMap.has(task.capabilityId)
      ? capabilityOutputFacetMap.get(task.capabilityId) ?? []
      : []
  const union = uniqueStrings([...fromFacets, ...fromContract, ...fromCapability])
  const allowed = new Set<string>([...fromContract, ...fromCapability])
  if (allowed.size === 0) {
    return union
  }
  return union.filter((name) => allowed.has(name))
}

type FacetProvenanceEntry = {
  facet: string
  pointer?: string
}

function buildRunContextOutput(task: FlexTaskRecord): Record<string, unknown> | null {
  const metadata = isRecord(task.metadata) ? task.metadata : null
  const snapshot = metadata && isRecord((metadata as Record<string, unknown>).runContextSnapshot)
    ? ((metadata as Record<string, unknown>).runContextSnapshot as Record<string, unknown>)
    : null
  if (!snapshot) return null

  const facets = isRecord(snapshot.facets) ? (snapshot.facets as Record<string, unknown>) : null
  if (!facets) return null

  const provenance = Array.isArray(task.facetProvenance?.output)
    ? (task.facetProvenance?.output as FacetProvenanceEntry[])
    : []

  const output: Record<string, unknown> = {}

  for (const [facetName, entry] of Object.entries(facets)) {
    if (!isRecord(entry)) continue
    const value = (entry as Record<string, unknown>).value
    if (value === undefined) continue
    const pointerCandidate =
      provenance.find((item) => item.facet === facetName)?.pointer ?? `/${facetName}`
    const pointer = pointerCandidate?.startsWith('/') ? pointerCandidate : `/${pointerCandidate ?? facetName}`
    try {
      setValueAtPointer(output, pointer, value)
    } catch {
      output[facetName] = cloneValue(value)
    }
  }

  return Object.keys(output).length ? output : null
}

type FacetBinding = {
  name: string
  definition: FacetDefinition
  pointer: string
  component: Component
  schema: Record<string, unknown>
  context: Record<string, unknown> | null
  isDefault: boolean
}

type InputFacetBinding = {
  name: string
  definition: FacetDefinition
  pointer: string
  value: unknown
  component: Component | null
  schema: Record<string, unknown>
  context: Record<string, unknown> | null
}

function decodePointer(pointer: string): string[] {
  if (!pointer || pointer === '/') return []
  return pointer
    .split('/')
    .slice(1)
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
}

function cloneValue<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  try {
    return JSON.parse(JSON.stringify(value)) as T
  } catch {
    return value
  }
}

function getValueAtPointer(source: Record<string, unknown> | null, pointer: string): unknown {
  if (!source) return undefined
  const segments = decodePointer(pointer)
  if (!segments.length) return source
  let current: any = source
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined
      current = current[index]
    } else if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment]
    } else {
      return undefined
    }
  }
  return current
}

function setValueAtPointer(target: Record<string, unknown>, pointer: string, value: unknown) {
  const segments = decodePointer(pointer)
  if (!segments.length) {
    if (typeof value === 'object' && value !== null) {
      Object.assign(target, cloneValue(value))
    }
    return
  }
  let current: any = target
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    const isLast = index === segments.length - 1
    if (isLast) {
      if (Array.isArray(current)) {
        const idx = Number(segment)
        if (!Number.isInteger(idx)) throw new Error(`Invalid array index in pointer: ${pointer}`)
        current[idx] = cloneValue(value)
      } else if (typeof current === 'object' && current !== null) {
        ;(current as Record<string, unknown>)[segment] = cloneValue(value)
      }
      return
    }

    const nextSegment = segments[index + 1]
    const needsArray = Number.isInteger(Number(nextSegment))

    if (Array.isArray(current)) {
      const idx = Number(segment)
      if (!Number.isInteger(idx)) throw new Error(`Invalid array index in pointer: ${pointer}`)
      if (!current[idx] || typeof current[idx] !== 'object') {
        current[idx] = needsArray ? [] : {}
      }
      current = current[idx]
    } else if (typeof current === 'object' && current !== null) {
      if (!(segment in current) || typeof current[segment] !== 'object') {
        ;(current as Record<string, unknown>)[segment] = needsArray ? [] : {}
      }
      current = (current as Record<string, unknown>)[segment]
    } else {
      throw new Error(`Unable to traverse pointer "${pointer}"`)
    }
  }
}

function pointerForFacet(task: FlexTaskRecord, facetName: string, direction: 'input' | 'output'): string {
  const provenanceEntries =
    direction === 'output' ? task.facetProvenance?.output : task.facetProvenance?.input
  const candidate =
    provenanceEntries?.find((entry) => entry.facet === facetName)?.pointer ?? `/${facetName}`
  return candidate.startsWith('/') ? candidate : `/${candidate}`
}

const outputFacetBindings = computed<FacetBinding[]>(() => {
  const task = activeTask.value
  if (!task) return []
  const names = resolveOutputFacetNames(task)
  return names
    .map((name) => {
      const definition = facetCatalog.tryGet(name)
      if (!definition) return null
      const metadata = isRecord(task.metadata) ? task.metadata : null
      const component = getOutputFacetWidgetComponent(name)
      return {
        name,
        definition,
        pointer: pointerForFacet(task, name, 'output'),
        component,
        schema: definition.schema as Record<string, unknown>,
        context: metadata,
        isDefault: component === DefaultFacetWidget
      }
    })
    .filter((entry): entry is FacetBinding => Boolean(entry))
})

const customOutputFacetBindings = computed(() =>
  outputFacetBindings.value.filter((binding) => !binding.isDefault)
)

const postVisualBinding = computed<FacetBinding | null>(() => {
  return customOutputFacetBindings.value.find((binding) => binding.name === 'post_visual') ?? null
})

const otherCustomOutputFacetBindings = computed(() =>
  customOutputFacetBindings.value.filter((binding) => binding.name !== 'post_visual')
)

const fallbackOutputFacetBindings = computed(() =>
  outputFacetBindings.value.filter((binding) => binding.isDefault)
)

const postVisualPanels = ref<number[]>([])

function getInputFacetRoot(task: FlexTaskRecord): Record<string, unknown> | null {
  const metadata = isRecord(task.metadata) ? (task.metadata as Record<string, unknown>) : null
  if (metadata) {
    const currentInputs =
      (metadata.currentInputs as Record<string, unknown> | undefined) ??
      (metadata.inputs as Record<string, unknown> | undefined) ??
      (metadata.input as Record<string, unknown> | undefined) ??
      null
    if (currentInputs && isRecord(currentInputs)) {
      return currentInputs
    }
  }
  if (isRecord(task.defaults)) {
    const defaults = task.defaults as Record<string, unknown>
    const defaultInputs =
      (defaults.input as Record<string, unknown> | undefined) ??
      (defaults.inputs as Record<string, unknown> | undefined) ??
      null
    if (defaultInputs && isRecord(defaultInputs)) {
      return defaultInputs
    }
  }
  return null
}

const inputFacetBindings = computed<InputFacetBinding[]>(() => {
  const task = activeTask.value
  if (!task) return []
  const names = task.facets?.input ?? []
  const root = getInputFacetRoot(task)
  const metadata = isRecord(task.metadata) ? task.metadata : null
  return names
    .map((name) => {
      const definition = facetCatalog.tryGet(name)
      if (!definition) return null
      const pointer = pointerForFacet(task, name, 'input')
      const rawValue = root ? getValueAtPointer(root, pointer) : undefined
      const value = flexTasksStore.normalizeInputFacetValue(name, rawValue)
      const component = getInputFacetWidgetComponent(name)
      const schema =
        definition.schema && typeof definition.schema === 'object'
          ? (definition.schema as Record<string, unknown>)
          : {}
      return {
        name,
        definition,
        pointer,
        value,
        component,
        schema,
        context: metadata
      }
    })
    .filter((entry): entry is InputFacetBinding => Boolean(entry))
})

const customInputFacetBindings = computed(() =>
  inputFacetBindings.value.filter((binding) => Boolean(binding.component))
)

const fallbackInputFacetBindings = computed(() =>
  inputFacetBindings.value.filter((binding) => !binding.component)
)

const submissionDisabled = computed(() => {
  const task = activeTask.value
  if (!task) return true
  if (task.awaitingConfirmation) return true
  return task.submissionState === 'submitting'
})

const declineDisabled = computed(() => {
  const task = activeTask.value
  if (!task) return true
  if (task.awaitingConfirmation) return true
  return task.declineState === 'submitting'
})

function initializeDraft(task: FlexTaskRecord | null) {
  const seeded = new Map<string, unknown>()
  submissionNote.value = ''
  validationError.value = null
  fallbackOutputPanels.value = []
  inputFacetPanels.value = []
  if (!task) {
    draftValues.value = seeded
    return
  }

  let payload: Record<string, unknown> | null = null
  if (task.lastSubmittedPayload && typeof task.lastSubmittedPayload === 'object') {
    payload = cloneValue(task.lastSubmittedPayload as Record<string, unknown>)
  } else if (isRecord(task.metadata)) {
    const candidate = (task.metadata as Record<string, unknown>)['currentOutput']
    if (isRecord(candidate)) {
      payload = cloneValue(candidate)
    }
  }

  const runContextPayload = buildRunContextOutput(task)
  const sources = [payload, runContextPayload].filter(
    (entry): entry is Record<string, unknown> => Boolean(entry)
  )
  const inputRoot = getInputFacetRoot(task)

  for (const binding of outputFacetBindings.value) {
    let existing: unknown = undefined

    for (const source of sources) {
      const candidate = getValueAtPointer(source, binding.pointer)
      if (candidate !== undefined && candidate !== null) {
        existing = candidate
        break
      }

      const fallbackPointer = `/${binding.name}`
      if (fallbackPointer !== binding.pointer) {
        const fallbackCandidate = getValueAtPointer(source, fallbackPointer)
        if (fallbackCandidate !== undefined && fallbackCandidate !== null) {
          existing = fallbackCandidate
          break
        }
      }

      if (Object.prototype.hasOwnProperty.call(source, binding.name)) {
        const directCandidate = (source as Record<string, unknown>)[binding.name]
        if (directCandidate !== undefined && directCandidate !== null) {
          existing = directCandidate
          break
        }
      }
    }

    if ((existing === undefined || existing === null) && inputRoot) {
      const inputPointer = pointerForFacet(task, binding.name, 'input')
      existing = getValueAtPointer(inputRoot, inputPointer)
      if ((existing === undefined || existing === null) && Object.prototype.hasOwnProperty.call(inputRoot, binding.name)) {
        existing = (inputRoot as Record<string, unknown>)[binding.name]
      }
    }

    if (existing !== undefined && existing !== null) {
      seeded.set(binding.pointer, cloneValue(existing))
    }
  }

  draftValues.value = seeded
  fallbackOutputPanels.value = fallbackOutputFacetBindings.value.length ? [0] : []
}

watch(
  activeTask,
  (task) => {
    initializeDraft(task)
  },
  { immediate: true }
)

watch(
  fallbackOutputFacetBindings,
  (bindings) => {
    if (!bindings.length) {
      fallbackOutputPanels.value = []
      return
    }
    if (!fallbackOutputPanels.value.length) {
      fallbackOutputPanels.value = [0]
    }
  },
  { immediate: true }
)

watch(
  postVisualBinding,
  (binding) => {
    postVisualPanels.value = binding ? [0] : []
  },
  { immediate: true }
)

function selectTask(taskId: string) {
  flexTasksStore.setActiveTask(taskId)
}

function facetValue(pointer: string) {
  return draftValues.value.get(pointer) ?? null
}

function inputFacetValueJson(binding: InputFacetBinding): string {
  if (binding.value === undefined) {
    return 'No input payload provided.'
  }
  try {
    return JSON.stringify(binding.value, null, 2)
  } catch {
    return String(binding.value)
  }
}

function updateFacetValue(pointer: string, value: unknown) {
  const next = new Map(draftValues.value)
  if (value === null || value === undefined) {
    next.delete(pointer)
  } else {
    next.set(pointer, cloneValue(value))
  }
  draftValues.value = next
}

function isValueFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0
  return true
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

const VALID_CLARIFICATION_STATUSES = new Set(['answered', 'declined', 'needs_follow_up'])

type ClarificationAttachment = { label: string; uri: string }
type ClarificationResponseEntry = {
  questionId: string
  status?: string
  response?: string
  notes?: string
  attachments?: ClarificationAttachment[]
}

function isValidAttachment(value: unknown): value is ClarificationAttachment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return isNonEmptyString(record.label) && isNonEmptyString(record.uri)
}

function isValidClarificationResponseValue(value: unknown): value is { responses: ClarificationResponseEntry[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const responses = (value as { responses?: unknown }).responses
  if (!Array.isArray(responses) || responses.length === 0) return false
  return responses.every((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
    const record = entry as Record<string, unknown>
    if (!isNonEmptyString(record.questionId)) return false
    const rawStatus = record.status
    if (rawStatus !== undefined) {
      if (!isNonEmptyString(rawStatus)) return false
      const normalizedStatus = rawStatus.trim()
      if (!VALID_CLARIFICATION_STATUSES.has(normalizedStatus)) return false
    }
    if (record.response !== undefined && typeof record.response !== 'string') return false
    if (record.notes !== undefined && typeof record.notes !== 'string') return false
    if (
      record.attachments !== undefined &&
      (!Array.isArray(record.attachments) || record.attachments.some((attachment) => !isValidAttachment(attachment)))
    ) {
      return false
    }
    return true
  })
}

function validateDraft(): boolean {
  const missing: string[] = []
  const invalidMessages: string[] = []
  for (const binding of outputFacetBindings.value) {
    const value = draftValues.value.get(binding.pointer)
    if (!isValueFilled(value)) {
      missing.push(binding.definition.title)
      continue
    }
    if (binding.name === 'clarificationResponse' && !isValidClarificationResponseValue(value)) {
      invalidMessages.push('Add at least one response with a question ID before submitting.')
    }
  }
  if (missing.length) {
    validationError.value = `Provide values for: ${missing.join(', ')}`
    return false
  }
  if (invalidMessages.length) {
    validationError.value = invalidMessages.join(' ')
    return false
  }
  validationError.value = null
  return true
}

async function submitTask() {
  const task = activeTask.value
  if (!task) return
  if (!validateDraft()) return

  const payload: Record<string, unknown> = {}
  for (const [pointer, value] of draftValues.value.entries()) {
    setValueAtPointer(payload, pointer, value)
  }

  await flexTasksStore.submitTask(task.taskId, {
    output: payload,
    note: submissionNote.value.trim().length ? submissionNote.value.trim() : undefined
  })
}

async function confirmDecline() {
  const task = activeTask.value
  if (!task) return
  const reason = declineReason.value.trim()
  if (!reason) {
    validationError.value = 'Decline reason is required.'
    return
  }
  validationError.value = null
  await flexTasksStore.declineTask(task.taskId, { reason })
  declineDialog.value = false
  declineReason.value = ''
}

function openDeclineDialog() {
  declineReason.value = ''
  validationError.value = null
  declineDialog.value = true
}

async function refreshBacklog() {
  await flexTasksStore.hydrateFromBacklog({ syncLegacyHitl: false })
}

function taskStatusChipColor(task: FlexTaskRecord): string {
  if (task.awaitingConfirmation) return 'info'
  if (task.status === 'submitted') return 'primary'
  if (task.status === 'awaiting_submission') return 'warning'
  if (task.status === 'pending') return 'info'
  if (task.status === 'in_progress') return 'secondary'
  if (task.status === 'error') return 'error'
  return 'surface-variant'
}

function priorityColor(priority: FlexTaskRecord['priority']): string {
  switch (priority) {
    case 'urgent':
      return 'error'
    case 'high':
      return 'warning'
    case 'normal':
      return 'info'
    case 'low':
      return 'secondary'
    default:
      return 'default'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
</script>

<template>
  <v-card variant="outlined">
    <v-card-title class="d-flex align-center ga-4">
      <v-icon icon="mdi-briefcase-account" />
      Flex Human Tasks
      <v-spacer />
      <v-btn
        icon
        variant="text"
        :loading="loading"
        :disabled="loading"
        @click="refreshBacklog"
      >
        <v-icon icon="mdi-refresh" />
      </v-btn>
    </v-card-title>

    <v-divider />

    <v-card-text>
      <v-alert
        v-if="error"
        type="error"
        border="start"
        class="mb-4"
        variant="tonal"
      >
        {{ error }}
      </v-alert>

      <v-alert
        v-if="activeTask?.submissionError"
        type="error"
        border="start"
        class="mb-4"
        variant="tonal"
      >
        {{ activeTask.submissionError }}
      </v-alert>

      <v-alert
        v-if="validationError"
        type="warning"
        border="start"
        class="mb-4"
        variant="tonal"
      >
        {{ validationError }}
      </v-alert>

      <div class="flex-task-container">
        <aside class="task-list">
          <v-list density="compact" nav>
            <v-list-item
              v-for="task in pendingTasks"
              :key="task.taskId"
              :value="task.taskId"
              :active="task.taskId === activeTask?.taskId"
              @click="selectTask(task.taskId)"
            >
              <template #prepend>
                <v-icon icon="mdi-account-group-outline" />
              </template>
              <v-list-item-title>
                {{ task.label || task.capabilityId || task.nodeId }}
              </v-list-item-title>
              <v-list-item-subtitle>
                {{ task.runId }}
              </v-list-item-subtitle>
              <template #append>
                <v-chip
                  size="small"
                  :color="taskStatusChipColor(task)"
                  variant="tonal"
                  class="text-uppercase"
                >
                  {{ task.status }}
                </v-chip>
              </template>
            </v-list-item>
          </v-list>
          <p v-if="!pendingTasks.length && !loading" class="text-body-2 text-medium-emphasis pa-3">
            No pending flex tasks.
          </p>
        </aside>

        <section class="task-detail">
          <div v-if="!activeTask" class="empty-state">
            <v-icon icon="mdi-clipboard-text-outline" size="36" class="mb-2" />
            <p>Select a task to begin.</p>
          </div>

          <div v-else class="task-content">
            <div class="meta">
              <div class="meta-row">
                <span class="meta-label">Capability</span>
                <span class="meta-value">{{ activeTask.capabilityId || 'Human Assignment' }}</span>
              </div>
              <div class="meta-row" v-if="activeTask.role">
                <span class="meta-label">Role</span>
                <span class="meta-value">{{ activeTask.role }}</span>
              </div>
              <div class="meta-row" v-if="activeTask.assignedTo">
                <span class="meta-label">Assigned To</span>
                <span class="meta-value">{{ activeTask.assignedTo }}</span>
              </div>
              <div class="meta-row" v-if="activeTask.dueAt">
                <span class="meta-label">Due</span>
                <span class="meta-value">{{ new Date(activeTask.dueAt).toLocaleString() }}</span>
              </div>
              <div class="meta-row" v-if="activeTask.priority">
                <span class="meta-label">Priority</span>
                <v-chip
                  size="small"
                  :color="priorityColor(activeTask.priority)"
                  variant="flat"
                >
                  {{ activeTask.priority }}
                </v-chip>
              </div>
            </div>

            <div v-if="inputFacetBindings.length" class="input-facets">
              <h4 class="section-title">Input Facets</h4>
              <div
                v-if="customInputFacetBindings.length"
                class="custom-input-widgets"
              >
                <component
                  v-for="binding in customInputFacetBindings"
                  :key="binding.pointer"
                  :is="binding.component"
                  :definition="binding.definition"
                  :schema="binding.schema"
                  :model-value="binding.value"
                  :readonly="true"
                  :task-context="binding.context"
                  data-test="input-facet-widget"
                />
              </div>
              <v-expansion-panels
                v-if="fallbackInputFacetBindings.length"
                v-model="inputFacetPanels"
                multiple
                density="compact"
                class="facet-panels"
              >
                <v-expansion-panel
                  v-for="(binding, index) in fallbackInputFacetBindings"
                  :key="binding.pointer"
                  :value="index"
                  data-test="input-facet-panel"
                >
                  <v-expansion-panel-title>
                    {{ binding.definition.title }}
                  </v-expansion-panel-title>
                  <v-expansion-panel-text>
                    <p
                      v-if="binding.definition.description"
                      class="text-body-2 text-medium-emphasis mb-3"
                    >
                      {{ binding.definition.description }}
                    </p>
                    <pre class="facet-json" data-test="input-facet-json">{{ inputFacetValueJson(binding) }}</pre>
                  </v-expansion-panel-text>
                </v-expansion-panel>
              </v-expansion-panels>
            </div>

            <div v-if="outputFacetBindings.length" class="widgets">
              <h4 class="section-title">Output Facets</h4>
              <div v-if="customOutputFacetBindings.length" class="custom-widgets">
                <div
                  v-if="postVisualBinding"
                  class="custom-widget"
                >
                  <v-expansion-panels
                    v-model="postVisualPanels"
                    multiple
                    density="comfortable"
                    class="facet-panels"
                    data-test="post-visual-output-panel"
                  >
                    <v-expansion-panel :value="0">
                      <v-expansion-panel-title>
                        {{ postVisualBinding.definition.title }}
                      </v-expansion-panel-title>
                      <v-expansion-panel-text>
                        <component
                          :is="postVisualBinding.component"
                          :definition="postVisualBinding.definition"
                          :schema="postVisualBinding.schema"
                          :model-value="facetValue(postVisualBinding.pointer)"
                          :readonly="submissionDisabled"
                          :task-context="postVisualBinding.context"
                          @update:model-value="updateFacetValue(postVisualBinding.pointer, $event)"
                        />
                      </v-expansion-panel-text>
                    </v-expansion-panel>
                  </v-expansion-panels>
                </div>
                <component
                  v-for="binding in otherCustomOutputFacetBindings"
                  :key="binding.pointer"
                  :is="binding.component"
                  :definition="binding.definition"
                  :schema="binding.schema"
                  :model-value="facetValue(binding.pointer)"
                  :readonly="submissionDisabled"
                  :task-context="binding.context"
                  @update:model-value="updateFacetValue(binding.pointer, $event)"
                />
              </div>

              <v-expansion-panels
                v-if="fallbackOutputFacetBindings.length"
                v-model="fallbackOutputPanels"
                multiple
                density="comfortable"
                class="facet-panels"
              >
                <v-expansion-panel
                  v-for="(binding, index) in fallbackOutputFacetBindings"
                  :key="binding.pointer"
                  :value="index"
                  data-test="fallback-output-panel"
                >
                  <v-expansion-panel-title>
                    {{ binding.definition.title }}
                  </v-expansion-panel-title>
                  <v-expansion-panel-text>
                    <p
                      v-if="binding.definition.description"
                      class="text-body-2 text-medium-emphasis mb-3"
                    >
                      {{ binding.definition.description }}
                    </p>
                    <component
                      :is="binding.component"
                      :definition="binding.definition"
                      :schema="binding.schema"
                      :model-value="facetValue(binding.pointer)"
                      :readonly="submissionDisabled"
                      :task-context="binding.context"
                      @update:model-value="updateFacetValue(binding.pointer, $event)"
                    />
                  </v-expansion-panel-text>
                </v-expansion-panel>
              </v-expansion-panels>
            </div>

            <v-textarea
              v-model="submissionNote"
              label="Submission Note (optional)"
              variant="outlined"
              auto-grow
              :readonly="submissionDisabled"
              :disabled="submissionDisabled"
            />

            <div class="actions">
              <v-btn
                color="primary"
                class="me-2"
                :loading="activeTask.submissionState === 'submitting'"
                :disabled="submissionDisabled"
                data-test="flex-task-submit"
                @click="submitTask"
              >
                Submit Task
              </v-btn>

              <v-btn
                color="error"
                variant="outlined"
                :loading="activeTask.declineState === 'submitting'"
                :disabled="declineDisabled"
                data-test="flex-task-decline"
                @click="openDeclineDialog"
              >
                Decline Task
              </v-btn>
            </div>

            <v-alert
              v-if="activeTask.awaitingConfirmation"
              type="info"
              class="mt-4"
              variant="tonal"
              border="start"
            >
              Awaiting orchestrator confirmation…
            </v-alert>
          </div>
        </section>
      </div>
    </v-card-text>
  </v-card>

  <v-dialog v-model="declineDialog" max-width="480">
    <v-card>
      <v-card-title>Decline Task</v-card-title>
      <v-card-text>
        <v-textarea
          v-model="declineReason"
          label="Reason"
          variant="outlined"
          auto-grow
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="declineDialog = false">Cancel</v-btn>
        <v-btn color="error" :loading="activeTask?.declineState === 'submitting'" @click="confirmDecline">
          Decline
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.flex-task-container {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  width: 100%;
}

.task-list {
  flex: none;
  border-right: none;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  padding-right: 0;
  padding-bottom: 1rem;
  max-height: none;
  overflow-y: visible;
  width: 100%;
}

.task-detail {
  flex: 1 1 auto;
  min-height: 320px;
  width: 100%;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 3rem 1rem;
  color: rgba(0, 0, 0, 0.6);
}

.task-content {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.meta {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 0.75rem;
}

.meta-row {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.meta-label {
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(0, 0, 0, 0.6);
}

.meta-value {
  font-weight: 500;
}

.section-title {
  font-size: 0.95rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
}

.input-facets {
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  padding: 0.75rem;
}

.widgets {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.custom-input-widgets {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.custom-widgets {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.facet-panels :deep(.v-expansion-panel) {
  border-radius: 6px;
}

.facet-json {
  background: rgba(0, 0, 0, 0.04);
  border-radius: 6px;
  padding: 0.75rem;
  font-family: var(--v-code-font, 'SFMono-Regular', 'Roboto Mono', monospace);
  font-size: 0.85rem;
  line-height: 1.45;
  overflow-x: auto;
  white-space: pre;
}
</style>
