<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import type { TaskEnvelope, CapabilityRecord } from '@awesomeposter/shared'
import { TaskEnvelopeSchema } from '@awesomeposter/shared'
import { postFlexEventStream, type FlexEventWithId } from '@/lib/flex-sse'
import FlexSandboxPlanInspector from '@/components/FlexSandboxPlanInspector.vue'
import type { FlexSandboxPlan, FlexSandboxPlanHistoryEntry, FlexSandboxPlanNode } from '@/lib/flexSandboxTypes'
import { appendHistoryEntry, extractPlanPayload } from '@/lib/flexSandboxPlan'
import { isFlexSandboxEnabledClient } from '@/lib/featureFlags'

type FacetDescriptor = {
  name: string
  title: string
  description?: string
  schema?: Record<string, unknown>
  semantics?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

type CapabilityCatalogEntry = {
  id: string
  name: string
  description: string
  prompt?: {
    instructions: string
    toolsAllowlist: string[]
  } | null
}

type TemplateDescriptor = {
  id: string
  filename: string
  modifiedAt: string
  size: number
  envelope?: TaskEnvelope
  error?: string
}

type SandboxMetadata = {
  generatedAt: string
  facets: FacetDescriptor[]
  capabilityCatalog: CapabilityCatalogEntry[]
  capabilities: {
    active: CapabilityRecord[]
    all: CapabilityRecord[]
  }
  templates: TemplateDescriptor[]
}

type StoredDraft = {
  label: string
  content: string
  updatedAt: string
  templateDerived?: boolean
}

type DraftStore = Record<string, StoredDraft>

const FLEX_BASE_URL =
  import.meta.env.VITE_FLEX_AGENTS_BASE_URL ||
  import.meta.env.VITE_AGENTS_BASE_URL ||
  'http://localhost:3003'
const FLEX_AUTH =
  import.meta.env.VITE_FLEX_AGENTS_AUTH_BEARER ||
  import.meta.env.VITE_AGENTS_AUTH_BEARER ||
  undefined
const FLEX_SANDBOX_ENABLED = isFlexSandboxEnabledClient()

const DEFAULT_ENVELOPE: TaskEnvelope = {
  objective: 'Draft objective goes here',
  inputs: {
    planKnobs: {
      formatType: 'text',
      variantCount: 1
    }
  },
  policies: {
    plannerDirectives: {
      disallowStages: []
    }
  },
  specialInstructions: [],
  outputContract: {
    mode: 'json_schema',
    schema: {
      type: 'object',
      additionalProperties: true
    }
  }
}

const draftsKey = 'flex.sandbox.drafts'

const metadata = ref<SandboxMetadata | null>(null)
const metadataLoading = ref(false)
const metadataError = ref<string | null>(null)

const drafts = ref<DraftStore>(loadDrafts())
const selectedTemplateId = ref<string | null>(null)
const draftText = ref('')
const parseError = ref<string | null>(null)
const validationIssues = ref<string[]>([])
const validationWarnings = ref<string[]>([])
const parsedEnvelope = ref<TaskEnvelope | null>(null)

const eventLog = ref<FlexEventWithId[]>([])
const runStatus = ref<'idle' | 'running' | 'hitl' | 'completed' | 'error'>('idle')
const runError = ref<string | null>(null)
const correlationId = ref<string | undefined>()
const runId = ref<string | undefined>()
const plan = ref<FlexSandboxPlan | null>(null)

const backoffNotices = ref<string[]>([])
const expandedEventIds = ref<Set<string>>(new Set())

let saveTimeout: number | null = null
let streamHandle: { abort: () => void; done: Promise<void> } | null = null
const renameDialog = ref<{ open: boolean; id: string | null; label: string }>({ open: false, id: null, label: '' })

const templates = computed(() => metadata.value?.templates ?? [])
const capabilityRecords = computed(() => metadata.value?.capabilities?.all ?? [])
const capabilityMap = computed(() => {
  const map = new Map<string, CapabilityRecord>()
  for (const cap of capabilityRecords.value) {
    map.set(cap.capabilityId, cap)
  }
  return map
})
const facetSet = computed(() => {
  const set = new Set<string>()
  metadata.value?.facets.forEach((facet) => set.add(facet.name))
  return set
})

const selectedTemplate = computed(() => {
  if (!selectedTemplateId.value) return null
  return templates.value.find((tpl) => tpl.id === selectedTemplateId.value) ?? null
})

const localDraftEntries = computed(() => {
  const result: Array<{ id: string; data: StoredDraft }> = []
  const knownTemplateIds = new Set(templates.value.map((tpl) => tpl.id))
  for (const [id, data] of Object.entries(drafts.value)) {
    if (!knownTemplateIds.has(id) || !data.templateDerived) {
      result.push({ id, data })
    }
  }
  return result.sort((a, b) => new Date(b.data.updatedAt).getTime() - new Date(a.data.updatedAt).getTime())
})

const selectedDraftEntry = computed<StoredDraft | null>(() => {
  if (!selectedTemplateId.value) return null
  return drafts.value[selectedTemplateId.value] ?? null
})

const currentTemplateError = computed(() => selectedTemplate.value?.error ?? null)
const runDisabled = computed(() => !parsedEnvelope.value || Boolean(parseError.value) || validationIssues.value.length > 0)

function loadDrafts(): DraftStore {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(draftsKey)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as DraftStore
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed
  } catch {
    return {}
  }
}

function persistDraftStore(store: DraftStore) {
  drafts.value = store
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(draftsKey, JSON.stringify(store))
  } catch {
    // Ignore storage failures (private mode, quota, etc.)
  }
}

function persistDraftContent(id: string, content: string, options: { label?: string; templateDerived?: boolean } = {}) {
  const existing = drafts.value[id]
  const next: StoredDraft = {
    label: options.label ?? existing?.label ?? (selectedTemplate.value?.filename ?? `Draft ${id}`),
    content,
    updatedAt: new Date().toISOString(),
    templateDerived: options.templateDerived ?? existing?.templateDerived
  }
  persistDraftStore({
    ...drafts.value,
    [id]: next
  })
}

function removeDraft(id: string) {
  if (!(id in drafts.value)) return
  const next = { ...drafts.value }
  delete next[id]
  persistDraftStore(next)
}

function displayLabelForTemplate(template: TemplateDescriptor): string {
  return `${template.filename} • ${template.id}`
}

function displayLabelForDraft(id: string, entry: StoredDraft | undefined): string {
  if (entry?.label) return entry.label
  return `Draft ${id}`
}

function openRenameDraft(id: string, entry: StoredDraft | undefined) {
  renameDialog.value = {
    open: true,
    id,
    label: entry?.label || displayLabelForDraft(id, entry)
  }
}

function applyRenameDraft() {
  const { id, label } = renameDialog.value
  if (!id) {
    renameDialog.value.open = false
    return
  }
  const existing = drafts.value[id]
  if (!existing) {
    renameDialog.value.open = false
    return
  }
  const trimmed = label.trim()
  const finalLabel = trimmed.length > 0 ? trimmed : displayLabelForDraft(id, existing)
  const next: StoredDraft = {
    ...existing,
    label: finalLabel,
    updatedAt: new Date().toISOString()
  }
  persistDraftStore({
    ...drafts.value,
    [id]: next
  })
  renameDialog.value.open = false
  if (selectedTemplateId.value === id) {
    draftText.value = draftText.value // trigger watchers (noop)
  }
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size)) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function selectTemplateById(id: string, options: { skipPersist?: boolean } = {}) {
  selectedTemplateId.value = id
  const saved = drafts.value[id]?.content
  const template = templates.value.find((tpl) => tpl.id === id)
  if (saved) {
    draftText.value = saved
  } else if (template?.envelope) {
    draftText.value = JSON.stringify(template.envelope, null, 2)
    if (!options.skipPersist) {
      persistDraftContent(id, draftText.value, { templateDerived: true, label: displayLabelForTemplate(template) })
    }
  } else {
    draftText.value = JSON.stringify(DEFAULT_ENVELOPE, null, 2)
    if (!options.skipPersist) {
      persistDraftContent(id, draftText.value, { templateDerived: true })
    }
  }
  updateValidation()
}

function createLocalDraft() {
  const id = `draft-${Date.now()}`
  const label = `Scratch ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  const content = JSON.stringify(DEFAULT_ENVELOPE, null, 2)
  persistDraftContent(id, content, { label, templateDerived: false })
  selectTemplateById(id, { skipPersist: true })
}

function resetTemplateDraft() {
  if (!selectedTemplateId.value) return
  const template = selectedTemplate.value
  if (!template?.envelope) return
  persistDraftContent(selectedTemplateId.value, JSON.stringify(template.envelope, null, 2), {
    templateDerived: true,
    label: displayLabelForTemplate(template)
  })
  draftText.value = JSON.stringify(template.envelope, null, 2)
  updateValidation()
}

function formatDraft() {
  if (!parsedEnvelope.value) return
  draftText.value = JSON.stringify(parsedEnvelope.value, null, 2)
  updateValidation()
}

function updateValidation() {
  parseError.value = null
  validationIssues.value = []
  validationWarnings.value = []
  parsedEnvelope.value = null

  const text = draftText.value
  if (!text || text.trim().length === 0) {
    parseError.value = 'Draft is empty'
    return
  }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    parseError.value = err instanceof Error ? err.message : 'Invalid JSON payload'
    return
  }

  const parsed = TaskEnvelopeSchema.safeParse(raw)
  if (!parsed.success) {
    validationIssues.value = parsed.error.issues.map((issue) => {
      const path = issue.path?.join('.') ?? ''
      return path ? `${path}: ${issue.message}` : issue.message
    })
    return
  }

  parsedEnvelope.value = parsed.data
  const results = runDomainValidation(parsed.data)
  validationIssues.value = results.errors
  validationWarnings.value = results.warnings
}

function runDomainValidation(envelope: TaskEnvelope): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []

  const capabilities = capabilityMap.value
  if (capabilities.size > 0) {
    const directives = (envelope.policies as Record<string, unknown> | undefined)?.plannerDirectives as
      | Record<string, unknown>
      | undefined
    const preferred = Array.isArray(directives?.preferredCapabilities)
      ? (directives!.preferredCapabilities as unknown[])
      : []
    for (const entry of preferred) {
      if (typeof entry !== 'string') {
        errors.push(`Preferred capability entries must be strings; received ${String(entry)}`)
        continue
      }
      const record = capabilities.get(entry)
      if (!record) {
        errors.push(`Preferred capability "${entry}" is not registered`)
      } else if (record.status !== 'active') {
        warnings.push(`Preferred capability "${entry}" is currently ${record.status}`)
      }
    }
  }

  const facets = facetSet.value
  if (facets.size > 0) {
    if (envelope.outputContract.mode === 'facets') {
      for (const facet of envelope.outputContract.facets) {
        if (!facets.has(facet)) {
          errors.push(`Output facet "${facet}" is not defined in the registry`)
        }
      }
    }
    const metadataFacets = ((envelope.metadata as Record<string, unknown> | undefined)?.facets ??
      {}) as Record<string, unknown>
    for (const [scope, value] of Object.entries(metadataFacets)) {
      if (!Array.isArray(value)) continue
      for (const facet of value) {
        if (typeof facet === 'string' && !facets.has(facet)) {
          errors.push(`Metadata facet "${facet}" (${scope}) is not defined`)
        }
      }
    }
  }

  return { errors, warnings }
}

function schedulePersist() {
  if (!selectedTemplateId.value) return
  if (saveTimeout) {
    clearTimeout(saveTimeout)
    saveTimeout = null
  }
  if (typeof window === 'undefined') return
  saveTimeout = window.setTimeout(() => {
    if (!selectedTemplateId.value) return
    persistDraftContent(selectedTemplateId.value, draftText.value, {
      templateDerived: Boolean(selectedTemplate.value),
      label: selectedTemplate.value ? displayLabelForTemplate(selectedTemplate.value) : drafts.value[selectedTemplateId.value]?.label
    })
  }, 400)
}

function resetRunState() {
  eventLog.value = []
  backoffNotices.value = []
  runStatus.value = 'idle'
  runError.value = null
  correlationId.value = undefined
  runId.value = undefined
  plan.value = null
}

function updatePlanFromGenerated(payload: unknown, timestamp: string) {
  const record = extractPlanPayload(payload)
  if (!record) return
  const previousHistory = plan.value?.history ?? []
  const newEntry: FlexSandboxPlanHistoryEntry = {
    version: record.version ?? plan.value?.version ?? 1,
    timestamp,
    trigger: 'initial'
  }
  const history = appendHistoryEntry(previousHistory, newEntry)
  plan.value = {
    runId: record.runId ?? plan.value?.runId ?? null,
    version: record.version ?? plan.value?.version,
    metadata: record.metadata ?? null,
    nodes: record.nodes.map((node) => ({
      ...node,
      lastUpdatedAt: timestamp
    })),
    history
  }
}

function updatePlanFromUpdate(payload: unknown, timestamp: string) {
  const current = plan.value ?? {
    runId: undefined,
    version: undefined,
    metadata: null,
    nodes: [],
    history: []
  }
  const triggerInfo =
    payload && typeof payload === 'object' ? (payload as Record<string, unknown>).trigger : undefined
  const record = extractPlanPayload(payload)
  if (!record) return
  const nodeMap = new Map(record.nodes.map((node) => [node.id, node]))
  const mergedNodes: FlexSandboxPlanNode[] = current.nodes.map((node) => {
    const incoming = nodeMap.get(node.id)
    if (!incoming) return node
    nodeMap.delete(node.id)
    return {
      ...node,
      ...incoming,
      lastUpdatedAt: timestamp
    }
  })

  for (const node of nodeMap.values()) {
    mergedNodes.push({
      ...node,
      lastUpdatedAt: timestamp
    })
  }

  const updatedPlan = {
    runId: record.runId ?? current.runId,
    version: record.version ?? current.version,
    metadata: record.metadata ?? current.metadata,
    nodes: mergedNodes,
    history: appendHistoryEntry(current.history ?? [], {
      version: record.version ?? current.version ?? 1,
      timestamp,
      trigger: triggerInfo ?? 'planner_update'
    })
  }
  plan.value = updatedPlan
}

function updateNodeStatus(nodeId: string | undefined, status: FlexSandboxPlanNode['status'], timestamp: string) {
  if (!nodeId) return
  if (!plan.value) {
    plan.value = {
      runId: runId.value ?? null,
      version: undefined,
      metadata: null,
      nodes: [],
      history: []
    }
  }
  const nodes = plan.value.nodes.slice()
  const index = nodes.findIndex((node) => node.id === nodeId)
  if (index === -1) {
    nodes.push({
      id: nodeId,
      capabilityId: null,
      label: nodeId,
      status,
      lastUpdatedAt: timestamp
    })
  } else {
    nodes[index] = {
      ...nodes[index],
      status,
      lastUpdatedAt: timestamp
    }
  }
  plan.value = {
    ...plan.value,
    nodes
  }
}

function appendEvent(evt: FlexEventWithId) {
  eventLog.value = [...eventLog.value, evt]
}

function handleEvent(evt: FlexEventWithId) {
  appendEvent(evt)
  if (evt.correlationId && !correlationId.value) {
    correlationId.value = evt.correlationId
  }
  if (evt.runId) {
    runId.value = evt.runId
  }
  switch (evt.type) {
    case 'start':
      runStatus.value = 'running'
      break
    case 'plan_generated':
      updatePlanFromGenerated(evt.payload, evt.timestamp)
      break
    case 'plan_updated':
      updatePlanFromUpdate(evt.payload, evt.timestamp)
      break
    case 'node_start':
      updateNodeStatus(evt.nodeId, 'running', evt.timestamp)
      break
    case 'node_complete':
      updateNodeStatus(evt.nodeId, 'completed', evt.timestamp)
      break
    case 'node_error':
      updateNodeStatus(evt.nodeId, 'error', evt.timestamp)
      if (!runError.value && evt.message) {
        runError.value = evt.message
      }
      break
    case 'hitl_request':
      runStatus.value = 'hitl'
      updateNodeStatus(evt.nodeId, 'awaiting_hitl', evt.timestamp)
      break
    case 'validation_error': {
      runStatus.value = 'error'
      const payload = (evt.payload ?? {}) as Record<string, unknown>
      const scope = typeof payload.scope === 'string' ? payload.scope : 'unknown scope'
      const errors = Array.isArray(payload.errors)
        ? (payload.errors as Array<Record<string, unknown>>)
        : []
      const message = errors.find((entry) => typeof entry.message === 'string')?.message
      runError.value = message ? `Validation error (${scope}): ${message}` : `Validation error (${scope})`
      break
    }
    case 'log':
      if (evt.message && evt.message.toLowerCase().includes('error')) {
        runError.value = evt.message
      }
      break
    case 'complete':
      if (runStatus.value !== 'error') {
        runStatus.value = 'completed'
      }
      break
  }
}

function toggleEventExpansion(id: string | undefined) {
  if (!id) return
  const next = new Set(expandedEventIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedEventIds.value = next
}

function isEventExpanded(id: string | undefined): boolean {
  if (!id) return false
  return expandedEventIds.value.has(id)
}

function handleBackoff(info: { retryAfter: number; attempt: number; pending?: number; limit?: number }) {
  const detail = [
    `Backlog (attempt ${info.attempt + 1})`,
    info.pending !== undefined ? `pending: ${info.pending}` : null,
    info.limit !== undefined ? `limit: ${info.limit}` : null,
    `retry in ${info.retryAfter}s`
  ]
    .filter(Boolean)
    .join(' • ')
  backoffNotices.value = [...backoffNotices.value, `${new Date().toLocaleTimeString()}: ${detail}`]
}

async function runEnvelope() {
  if (!parsedEnvelope.value) {
    updateValidation()
    if (!parsedEnvelope.value) return
  }
  if (runStatus.value === 'running') {
    return
  }
  resetRunState()
  runStatus.value = 'running'
  const headers: Record<string, string> = {}
  if (FLEX_AUTH) headers.authorization = `Bearer ${FLEX_AUTH}`

  streamHandle = postFlexEventStream({
    url: `${FLEX_BASE_URL}/api/v1/flex/run.stream`,
    body: parsedEnvelope.value,
    headers,
    onEvent: handleEvent,
    onCorrelationId: (cid) => {
      correlationId.value = cid
    },
    onBackoff: handleBackoff,
    maxRetries: 2
  })
  try {
    await streamHandle.done
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      runStatus.value = 'idle'
    } else {
      runStatus.value = 'error'
      runError.value = err instanceof Error ? err.message : 'Run failed'
    }
  } finally {
    streamHandle = null
  }
}

function abortRun() {
  if (!streamHandle) return
  try {
    streamHandle.abort()
  } catch {
    // ignore
  } finally {
    streamHandle = null
  }
}

async function loadMetadata(force = false) {
  if (!FLEX_SANDBOX_ENABLED) return
  if (metadataLoading.value && !force) return
  metadataLoading.value = true
  metadataError.value = null
  try {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (FLEX_AUTH) headers.authorization = `Bearer ${FLEX_AUTH}`
    const res = await fetch(`${FLEX_BASE_URL}/api/v1/flex/sandbox/metadata`, {
      headers
    })
    if (!res.ok) {
      throw new Error(`Failed to load metadata (${res.status})`)
    }
    const json = (await res.json()) as SandboxMetadata
    metadata.value = json
    if (!selectedTemplateId.value && json.templates.length > 0) {
      selectTemplateById(json.templates[0].id, { skipPersist: true })
    }
  } catch (err) {
    metadataError.value = err instanceof Error ? err.message : 'Unable to load metadata'
  } finally {
    metadataLoading.value = false
  }
}

function formatTimestamp(ts: string | undefined): string {
  if (!ts) return ''
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ts
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

onMounted(() => {
  if (FLEX_SANDBOX_ENABLED) {
    void loadMetadata()
  }
})

onBeforeUnmount(() => {
  if (saveTimeout) {
    clearTimeout(saveTimeout)
    saveTimeout = null
  }
  abortRun()
})

watch(draftText, () => {
  updateValidation()
  schedulePersist()
})

watch(
  () => metadata.value?.templates,
  (templatesValue) => {
    if (!templatesValue || !templatesValue.length) return
    if (selectedTemplateId.value) return
    selectTemplateById(templatesValue[0].id, { skipPersist: true })
  },
  { immediate: true }
)
</script>

<template>
  <v-container fluid class="pa-4 flex-sandbox">
    <v-alert
      v-if="!FLEX_SANDBOX_ENABLED"
      type="error"
      variant="tonal"
      title="Sandbox disabled"
      text="Enable the USE_FLEX_DEV_SANDBOX flag to access the flex planner workspace."
    />
    <template v-else>
      <v-row>
        <v-col cols="12" md="3" class="d-flex flex-column ga-4">
          <v-card>
            <v-card-title class="text-subtitle-1 d-flex align-center justify-space-between">
              <span>Payload Templates</span>
              <v-btn icon="mdi-refresh" variant="text" density="comfortable" @click="loadMetadata(true)" :loading="metadataLoading" />
            </v-card-title>
            <v-card-subtitle>Existing envelopes & local drafts</v-card-subtitle>
            <v-divider />
            <v-card-text class="pa-0">
              <v-list nav density="compact">
                <v-list-subheader v-if="templates.length">Templates</v-list-subheader>
                <v-list-item
                  v-for="template in templates"
                  :key="template.id"
                  :value="template.id"
                  :active="template.id === selectedTemplateId"
                  @click="selectTemplateById(template.id)"
                >
                  <v-list-item-title>{{ displayLabelForTemplate(template) }}</v-list-item-title>
                  <v-list-item-subtitle>
                    {{ formatTimestamp(template.modifiedAt) }} · {{ formatBytes(template.size) }}
                  </v-list-item-subtitle>
                  <template #append>
                    <div class="d-flex align-center ga-1">
                      <v-btn
                        v-if="drafts[template.id]"
                        icon="mdi-pencil-outline"
                        size="small"
                        variant="text"
                        @click.stop="openRenameDraft(template.id, drafts[template.id])"
                      />
                      <v-icon v-if="drafts[template.id]" size="16" icon="mdi-content-save" color="primary" />
                    </div>
                  </template>
                </v-list-item>
                <v-divider v-if="localDraftEntries.length" class="my-2" />
                <v-list-subheader v-if="localDraftEntries.length">Local drafts</v-list-subheader>
                <v-list-item
                  v-for="entry in localDraftEntries"
                  :key="entry.id"
                  :value="entry.id"
                  :active="entry.id === selectedTemplateId"
                  @click="selectTemplateById(entry.id)"
                >
                  <v-list-item-title>{{ displayLabelForDraft(entry.id, entry.data) }}</v-list-item-title>
                  <v-list-item-subtitle>{{ formatTimestamp(entry.data.updatedAt) }}</v-list-item-subtitle>
                  <template #append>
                    <div class="d-flex align-center ga-1">
                      <v-btn
                        icon="mdi-pencil-outline"
                        variant="text"
                        size="small"
                        @click.stop="openRenameDraft(entry.id, entry.data)"
                      />
                      <v-btn icon="mdi-delete-outline" variant="text" size="small" @click.stop="removeDraft(entry.id)" />
                    </div>
                  </template>
                </v-list-item>
              </v-list>
            </v-card-text>
            <v-card-actions>
              <v-btn color="primary" prepend-icon="mdi-plus" @click="createLocalDraft">New draft</v-btn>
              <v-spacer />
              <v-btn
                v-if="selectedTemplate && selectedTemplate.envelope"
                prepend-icon="mdi-restore"
                variant="text"
                @click="resetTemplateDraft"
              >
                Restore template
              </v-btn>
            </v-card-actions>
          </v-card>

          <v-card>
            <v-card-title class="text-subtitle-1">Registry Snapshot</v-card-title>
            <v-card-subtitle v-if="metadata?.generatedAt">
              Updated {{ formatTimestamp(metadata?.generatedAt) }}
            </v-card-subtitle>
            <v-card-text>
              <div class="text-body-2 mb-2">
                <strong>Capabilities:</strong>
                {{ metadata?.capabilities?.active.length ?? 0 }} active /
                {{ metadata?.capabilities?.all.length ?? 0 }} total
              </div>
              <div class="text-body-2 mb-2">
                <strong>Facets:</strong> {{ metadata?.facets.length ?? 0 }}
              </div>
              <div v-if="metadata?.capabilityCatalog?.length" class="text-body-2">
                <strong>Catalog:</strong>
                <v-chip
                  v-for="cap in metadata.capabilityCatalog"
                  :key="cap.id"
                  size="small"
                  color="primary"
                  class="me-1 mb-1"
                  variant="outlined"
                >
                  {{ cap.name }}
                </v-chip>
              </div>
              <v-alert
                v-if="metadataError"
                type="error"
                variant="tonal"
                border="start"
                class="mt-4"
                :text="metadataError"
              />
            </v-card-text>
          </v-card>
        </v-col>

        <v-col cols="12" md="5" class="d-flex flex-column ga-4">
          <v-card class="flex-grow-1 d-flex flex-column">
            <v-card-title class="text-subtitle-1 d-flex align-center justify-space-between">
              <span>TaskEnvelope Editor</span>
              <div class="d-flex ga-2">
                <v-btn icon="mdi-format-align-justify" variant="text" @click="formatDraft" :disabled="!parsedEnvelope">
                  <v-icon icon="mdi-code-tags" />
                </v-btn>
              </div>
            </v-card-title>
            <v-card-text class="flex-grow-1 d-flex flex-column">
              <v-alert
                v-if="parseError"
                type="error"
                variant="tonal"
                border="start"
                class="mb-3"
                :text="parseError"
              />
              <v-alert
                v-for="issue in validationIssues"
                :key="issue"
                type="error"
                variant="tonal"
                border="start"
                class="mb-2"
                :text="issue"
              />
              <v-alert
                v-for="warning in validationWarnings"
                :key="warning"
                type="warning"
                variant="tonal"
                border="start"
                class="mb-2"
                :text="warning"
              />
              <v-alert
                v-if="currentTemplateError"
                type="warning"
                variant="tonal"
                border="start"
                class="mb-2"
                :text="`Template parsing error: ${currentTemplateError}`"
              />
              <v-textarea
                v-model="draftText"
                class="font-mono sandbox-editor"
                variant="outlined"
                :no-resize="true"
                row-height="18"
                rows="22"
                spellcheck="false"
                placeholder="Edit TaskEnvelope JSON here"
              />
            </v-card-text>
            <v-divider />
            <v-card-actions>
              <v-btn color="primary" prepend-icon="mdi-play" @click="runEnvelope" :disabled="runDisabled">
                Run plan
              </v-btn>
              <v-btn
                v-if="runStatus === 'running'"
                prepend-icon="mdi-stop-circle-outline"
                variant="text"
                @click="abortRun"
              >
                Stop
              </v-btn>
              <v-spacer />
              <div class="d-flex flex-column text-caption text-medium-emphasis">
                <span>Status: {{ runStatus }}</span>
                <span v-if="runError" class="text-error">Error: {{ runError }}</span>
                <span v-if="correlationId">CID: {{ correlationId }}</span>
              </div>
            </v-card-actions>
          </v-card>

          <v-card>
            <v-card-title class="text-subtitle-1">Event Stream</v-card-title>
            <v-card-subtitle>Latest planner telemetry</v-card-subtitle>
            <v-divider />
            <v-card-text class="event-log">
              <div v-if="!eventLog.length" class="text-medium-emphasis text-caption">
                Run the planner to view live SSE events.
              </div>
              <v-timeline v-else density="compact" side="end">
                <v-timeline-item
                  v-for="frame in eventLog"
                  :key="`${frame.timestamp}-${frame.id ?? ''}-${frame.type}`"
                  size="x-small"
                  :dot-color="frame.type === 'error' || frame.type === 'validation_error' ? 'error' : 'primary'"
                >
                  <div class="d-flex align-center justify-space-between">
                    <div class="text-body-2">
                      <strong>{{ frame.type }}</strong>
                      <span class="text-caption text-medium-emphasis ms-2">{{ formatTimestamp(frame.timestamp) }}</span>
                    </div>
                    <v-btn
                      icon
                      size="x-small"
                      variant="text"
                      :title="isEventExpanded(frame.id) ? 'Collapse details' : 'Expand details'"
                      @click="toggleEventExpansion(frame.id)"
                    >
                      <v-icon :icon="isEventExpanded(frame.id) ? 'mdi-chevron-up' : 'mdi-chevron-down'" />
                    </v-btn>
                  </div>
                  <transition name="expand">
                    <div v-if="isEventExpanded(frame.id)" class="mt-2">
                      <div v-if="frame.message" class="text-caption mb-2">{{ frame.message }}</div>
                      <pre v-if="frame.payload" class="payload-preview">{{ JSON.stringify(frame.payload, null, 2) }}</pre>
                      <div v-else class="text-caption text-medium-emphasis">No payload</div>
                    </div>
                  </transition>
                </v-timeline-item>
              </v-timeline>
            </v-card-text>
            <v-divider />
            <v-card-text v-if="backoffNotices.length" class="text-caption text-warning">
              <div class="mb-1"><strong>Backoff notices</strong></div>
              <div v-for="notice in backoffNotices" :key="notice">{{ notice }}</div>
            </v-card-text>
          </v-card>
        </v-col>

        <v-col cols="12" md="4" class="d-flex flex-column ga-4">
          <FlexSandboxPlanInspector
            :plan="plan"
            :capability-catalog="capabilityRecords"
          />
        </v-col>
      </v-row>
    </template>
  </v-container>

  <v-dialog v-model="renameDialog.open" max-width="420">
    <v-card>
      <v-card-title class="text-subtitle-1">Rename draft</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="renameDialog.label"
          label="Draft name"
          density="comfortable"
          autofocus
          hint="Use a descriptive name to identify this payload"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="renameDialog.open = false">Cancel</v-btn>
        <v-btn color="primary" @click="applyRenameDraft">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.flex-sandbox {
  min-height: calc(100vh - 64px);
}
.font-mono {
  font-family: 'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
}
.event-log {
  max-height: 360px;
  overflow-y: auto;
}
.payload-preview {
  background-color: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  padding: 8px;
  font-size: 12px;
  margin-top: 6px;
  white-space: pre-wrap;
  word-break: break-word;
}
.expand-enter-active,
.expand-leave-active {
  transition: all 0.15s ease;
}
.expand-enter-from,
.expand-leave-to {
  max-height: 0;
  opacity: 0;
}
.sandbox-editor :deep(textarea) {
  height: 420px !important;
  max-height: 420px;
  overflow-y: auto !important;
}
</style>
