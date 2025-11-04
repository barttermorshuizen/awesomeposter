<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import {
  TaskEnvelopeSchema,
  HitlOriginAgentEnum,
  HitlRequestPayloadSchema,
  HitlContractSummarySchema,
  type TaskEnvelope,
  type CapabilityRecord,
  type FacetDirection,
  type HitlOriginAgent,
  type HitlRequestPayload,
  type HitlContractSummary
} from '@awesomeposter/shared'
import { postFlexEventStream, type FlexEventWithId } from '@/lib/flex-sse'
import { addFlexEventListener } from '@/lib/flex-event-bus'
import FlexSandboxPlanInspector from '@/components/FlexSandboxPlanInspector.vue'
import FlexTaskPanel from '@/components/flex-tasks/FlexTaskPanel.vue'
import HitlPromptPanel from '@/components/HitlPromptPanel.vue'
import VueJsonPretty from 'vue-json-pretty'
import 'vue-json-pretty/lib/styles.css'
import type { FlexSandboxPlan, FlexSandboxPlanHistoryEntry, FlexSandboxPlanNode } from '@/lib/flexSandboxTypes'
import { appendHistoryEntry, extractPlanPayload } from '@/lib/flexSandboxPlan'
import { isFlexSandboxEnabledClient } from '@/lib/featureFlags'
import { useHitlStore } from '@/stores/hitl'
import { useNotificationsStore } from '@/stores/notifications'
import { useFlexTasksStore } from '@/stores/flexTasks'
import { useFlexEnvelopeBuilderStore } from '@/stores/flexEnvelopeBuilder'

type FacetMetadataDescriptor = {
  direction?: FacetDirection
  [key: string]: unknown
}

type FacetDescriptor = {
  name: string
  title: string
  description?: string
  schema?: Record<string, unknown>
  semantics?: Record<string, unknown>
  metadata?: FacetMetadataDescriptor
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

type HitlResumeTrigger = {
  nodeId: string | null
  responseType: 'approval' | 'rejection' | 'freeform'
  approved?: boolean
  selectedOptionId?: string | null
  freeformText?: string | null
}

type FlexResumeSubmission = {
  nodeId: string
  output?: Record<string, unknown>
  decline?: { reason: string; note?: string | null }
  submittedAt?: string
  note?: string | null
}

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
    planner: {
      directives: {
        disallowStages: []
      }
    },
    runtime: []
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
let externalEventCleanup: (() => void) | null = null

const metadata = ref<SandboxMetadata | null>(null)
const metadataLoading = ref(false)
const metadataError = ref<string | null>(null)

const drafts = ref<DraftStore>(loadDrafts())
const selectedTemplateId = ref<string | null>(null)
const draftText = ref('')
const parseError = ref<string | null>(null)
const validationIssues = ref<string[]>([])
const validationWarnings = ref<string[]>([])
const conversationMissingFields = ref<string[]>([])
const parsedEnvelope = ref<TaskEnvelope | null>(null)

const eventLog = ref<FlexEventWithId[]>([])
const runStatus = ref<'idle' | 'running' | 'hitl' | 'completed' | 'error'>('idle')
const runError = ref<string | null>(null)
const correlationId = ref<string | undefined>()
const runId = ref<string | undefined>()
const plan = ref<FlexSandboxPlan | null>(null)
const planStreamError = ref<string | null>(null)
const notifications = useNotificationsStore()
const envelopeBuilder = useFlexEnvelopeBuilderStore()
const flexTasksStore = useFlexTasksStore()
const { hasPendingTasks: hasFlexTasks, loading: flexTasksLoading } = storeToRefs(flexTasksStore)

const hitlStore = useHitlStore()
const { pendingRun, hasActiveRequest, operatorProfile } = storeToRefs(hitlStore)

const backoffNotices = ref<string[]>([])
const expandedEventIds = ref<Set<string>>(new Set())
const showCapabilitySnapshot = ref(false)
const showFacetSnapshot = ref(false)
const showCatalogSnapshot = ref(false)
const rawEditorOpen = ref(false)
const rawEditorText = ref('')
const rawEditorParseError = ref<string | null>(null)
const rawEditorValidationErrors = ref<string[]>([])
const builderInput = ref('')

const showHitlPanel = computed(() => hasActiveRequest.value || Boolean(pendingRun.value.pendingRequestId))

let saveTimeout: number | null = null
let streamHandle: { abort: () => void; done: Promise<void> } | null = null
const envelopeEditorOpen = ref(false)
const envelopeEditorFocus = ref<'envelope' | 'label'>('envelope')
const envelopeEditorLabel = ref('')
const envelopeLabelField = ref<{ focus: () => void } | null>(null)
const activeRunEnvelopeId = ref<string | null>(null)

const templates = computed(() => metadata.value?.templates ?? [])
const capabilityRecords = computed(() => metadata.value?.capabilities?.all ?? [])
const capabilityMap = computed(() => {
  const map = new Map<string, CapabilityRecord>()
  const active = metadata.value?.capabilities?.active ?? []
  for (const cap of active) {
    map.set(cap.capabilityId, cap)
  }
  for (const cap of capabilityRecords.value) {
    if (!map.has(cap.capabilityId)) {
      map.set(cap.capabilityId, cap)
    }
  }
  return map
})
const facetSet = computed(() => {
  const set = new Set<string>()
  metadata.value?.facets.forEach((facet) => set.add(facet.name))
  return set
})

const capabilitySnapshot = computed(() => {
  const all = metadata.value?.capabilities?.all ?? []
  return [...all].sort((a, b) => a.displayName.localeCompare(b.displayName))
})

const facetCatalogEntries = computed(() => {
  const facets = metadata.value?.facets ?? []
  return [...facets].sort((a, b) => {
    const aLabel = a.title || a.name
    const bLabel = b.title || b.name
    return aLabel.localeCompare(bLabel)
  })
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
const runDisabled = computed(
  () =>
    !parsedEnvelope.value ||
    Boolean(parseError.value) ||
    validationIssues.value.length > 0 ||
    conversationMissingFields.value.length > 0
)

const isEnvelopeActive = computed(() => (id: string) => activeRunEnvelopeId.value === id)

const runStateForEnvelope = computed(() => (id: string) => (activeRunEnvelopeId.value === id ? runStatus.value : 'idle'))

const runStatusChipColor = computed(() => {
  switch (runStatus.value) {
    case 'running':
      return 'primary'
    case 'hitl':
      return 'warning'
    case 'completed':
      return 'success'
    case 'error':
      return 'error'
    default:
      return undefined
  }
})

const runStatusChipLabel = computed(() => {
  switch (runStatus.value) {
    case 'hitl':
      return 'Awaiting HITL'
    case 'completed':
      return 'Completed'
    case 'running':
      return 'Running'
    case 'error':
      return 'Error'
    default:
      return 'Idle'
  }
})

const runStatusTooltip = computed(() => {
  if (runStatus.value === 'error' && runError.value) {
    return runError.value
  }
  if (runStatus.value === 'hitl') {
    return 'Flex run paused for human-in-the-loop input.'
  }
  if (runStatus.value === 'running') {
    return correlationId.value ? `In progress · CID: ${correlationId.value}` : 'Flex run in progress.'
  }
  if (runStatus.value === 'completed') {
    return correlationId.value ? `Completed · CID: ${correlationId.value}` : 'Flex run finished successfully.'
  }
  if (correlationId.value) {
    return `Last CID: ${correlationId.value}`
  }
  return 'Planner is idle.'
})

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

function defaultDraftLabel(id: string, entry: StoredDraft | undefined): string {
  if (entry?.label) return entry.label
  if (selectedTemplateId.value === id && selectedTemplate.value) {
    return displayLabelForTemplate(selectedTemplate.value)
  }
  return `Draft ${id}`
}

async function openEnvelopeEditor(options: { id?: string; focus?: 'envelope' | 'label' } = {}) {
  const id = options.id ?? selectedTemplateId.value
  if (!id) return
  if (selectedTemplateId.value !== id) {
    selectTemplateById(id, { skipPersist: true })
    await nextTick()
  }
  envelopeEditorFocus.value = options.focus ?? 'envelope'
  envelopeEditorOpen.value = true
}

function closeEnvelopeEditor() {
  commitEnvelopeLabel()
  envelopeEditorOpen.value = false
}

function commitEnvelopeLabel() {
  const id = selectedTemplateId.value
  if (!id) return
  const existing = drafts.value[id]
  const trimmed = envelopeEditorLabel.value.trim()
  const fallback = defaultDraftLabel(id, existing)
  const finalLabel = trimmed.length > 0 ? trimmed : fallback
  if (!existing) {
    persistDraftContent(id, draftText.value, {
      label: finalLabel,
      templateDerived: Boolean(selectedTemplate.value)
    })
    envelopeEditorLabel.value = finalLabel
    return
  }
  if (existing.label === finalLabel) {
    envelopeEditorLabel.value = finalLabel
    return
  }
  const next: StoredDraft = {
    ...existing,
    label: finalLabel,
    updatedAt: new Date().toISOString()
  }
  persistDraftStore({
    ...drafts.value,
    [id]: next
  })
  envelopeEditorLabel.value = finalLabel
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

async function createLocalDraft() {
  const id = `draft-${Date.now()}`
  const label = `Scratch ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  const content = JSON.stringify(DEFAULT_ENVELOPE, null, 2)
  persistDraftContent(id, content, { label, templateDerived: false })
  selectTemplateById(id, { skipPersist: true })
  await openEnvelopeEditor({ id })
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

function openRawJsonEditor() {
  rawEditorText.value = draftText.value
  rawEditorParseError.value = null
  rawEditorValidationErrors.value = []
  rawEditorOpen.value = true
}

function closeRawJsonEditor() {
  rawEditorOpen.value = false
}

function applyRawJsonEditor() {
  rawEditorParseError.value = null
  rawEditorValidationErrors.value = []
  let parsed: unknown
  try {
    parsed = JSON.parse(rawEditorText.value)
  } catch (error) {
    rawEditorParseError.value = error instanceof Error ? error.message : 'Invalid JSON payload'
    return
  }
  const result = TaskEnvelopeSchema.safeParse(parsed)
  if (!result.success) {
    rawEditorValidationErrors.value = result.error.issues.map((issue) => {
      const path = issue.path?.join('.') ?? ''
      return path ? `${path}: ${issue.message}` : issue.message
    })
    return
  }
  draftText.value = JSON.stringify(result.data, null, 2)
  rawEditorOpen.value = false
  notifications.notifySuccess('TaskEnvelope updated from raw JSON.')
}

async function copyEnvelopeJson() {
  const envelope = parsedEnvelope.value
  if (!envelope) {
    notifications.enqueue({ message: 'Nothing to copy yet — envelope is not valid.', kind: 'warning' })
    return
  }
  const serialized = JSON.stringify(envelope, null, 2)
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(serialized)
    } else {
      fallbackCopy(serialized)
    }
    notifications.notifySuccess('TaskEnvelope JSON copied to clipboard.')
  } catch (error) {
    console.warn('[Flex Sandbox] Failed to copy envelope JSON', error)
    notifications.notifyError('Unable to copy TaskEnvelope JSON on this browser.')
  }
}

function fallbackCopy(text: string) {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'absolute'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

function resolveCurrentEnvelope(): TaskEnvelope | null {
  if (parsedEnvelope.value) {
    return parsedEnvelope.value
  }
  try {
    const raw = JSON.parse(draftText.value)
    const result = TaskEnvelopeSchema.safeParse(raw)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

function formatConversationRole(role: 'assistant' | 'user' | 'system'): string {
  switch (role) {
    case 'assistant':
      return 'Assistant'
    case 'user':
      return 'You'
    case 'system':
      return 'System'
    default:
      return role
  }
}

async function startEnvelopeConversation() {
  if (envelopeBuilder.pending) return
  try {
    const envelope = resolveCurrentEnvelope()
    const updated = await envelopeBuilder.startConversation({
      baseUrl: FLEX_BASE_URL,
      authToken: FLEX_AUTH,
      envelope: envelope ?? undefined
    })
    if (updated) {
      draftText.value = JSON.stringify(updated, null, 2)
    }
    builderInput.value = ''
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start conversational builder.'
    notifications.notifyError(message)
  }
}

async function sendEnvelopeBuilderMessage() {
  const trimmed = builderInput.value.trim()
  if (!trimmed) return
  if (envelopeBuilder.pending) return
  try {
    const envelope = resolveCurrentEnvelope()
    const delta = await envelopeBuilder.sendOperatorResponse({
      baseUrl: FLEX_BASE_URL,
      authToken: FLEX_AUTH,
      envelope: envelope ?? undefined,
      message: trimmed
    })
    if (delta?.envelope) {
      draftText.value = JSON.stringify(delta.envelope, null, 2)
    }
    builderInput.value = ''
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Conversation request failed.'
    notifications.notifyError(message)
  }
}

function undoLastBuilderDelta() {
  const snapshot = envelopeBuilder.undoLastDelta()
  if (snapshot) {
    draftText.value = JSON.stringify(snapshot, null, 2)
    builderInput.value = ''
    notifications.notifyInfo('Reverted the last assistant change.')
  }
}

function resetEnvelopeConversation() {
  envelopeBuilder.reset()
  builderInput.value = ''
  conversationMissingFields.value = []
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
  if (validationIssues.value.length === 0) {
    conversationMissingFields.value = []
    envelopeBuilder.acknowledgeEnvelopeValidity()
  }
}

function runDomainValidation(envelope: TaskEnvelope): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []

  const capabilities = capabilityMap.value
  if (capabilities.size > 0) {
    const planner = envelope.policies?.planner
    const canonicalPreferred = planner?.selection?.prefer ?? []
    const directivePreferred = Array.isArray(
      (planner?.directives as Record<string, unknown> | undefined)?.preferredCapabilities
    )
      ? ((planner!.directives as Record<string, unknown>).preferredCapabilities as unknown[])
      : []
    const preferred = Array.from(new Set([...canonicalPreferred, ...directivePreferred]))
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
  planStreamError.value = null
  hitlStore.resetAll()
}

function updatePlanFromGenerated(payload: unknown, timestamp: string) {
  let record: ReturnType<typeof extractPlanPayload> | null = null
  try {
    record = extractPlanPayload(payload)
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Planner plan payload is invalid.'
    const userMessage = `${detail} Retry the resume request or rerun the planner.`
    if (planStreamError.value !== userMessage) {
      planStreamError.value = userMessage
      notifications.notifyError(userMessage)
    }
    return
  }
  if (!record) return
  if (planStreamError.value) {
    planStreamError.value = null
  }
  const previousHistory = plan.value?.history ?? []
  const newEntry: FlexSandboxPlanHistoryEntry = {
    version: record.version ?? 1,
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
  let record: ReturnType<typeof extractPlanPayload> | null = null
  try {
    record = extractPlanPayload(payload)
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Planner plan payload is invalid.'
    const userMessage = `${detail} Retry the resume request or rerun the planner.`
    if (planStreamError.value !== userMessage) {
      planStreamError.value = userMessage
      notifications.notifyError(userMessage)
    }
    return
  }
  if (!record) return
  if (planStreamError.value) {
    planStreamError.value = null
  }
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
    hitlStore.setRunId(evt.runId)
  }
  switch (evt.type) {
    case 'start':
      runStatus.value = 'running'
      hitlStore.resetAll()
      {
        const payload = evt.payload as Record<string, unknown> | undefined
        const startedRunId = typeof payload?.runId === 'string' ? payload.runId : undefined
        if (startedRunId) {
          runId.value = startedRunId
          hitlStore.setRunId(startedRunId)
        } else if (evt.runId) {
          hitlStore.setRunId(evt.runId)
        }
        const thread = typeof payload?.threadId === 'string' ? payload.threadId : undefined
        if (thread) {
          hitlStore.setThreadId(thread)
        }
      }
      void flexTasksStore.hydrateFromBacklog({ syncLegacyHitl: false })
      break
    case 'plan_generated':
      updatePlanFromGenerated(evt.payload, evt.timestamp)
      break
    case 'plan_updated':
      updatePlanFromUpdate(evt.payload, evt.timestamp)
      break
    case 'node_start':
      updateNodeStatus(evt.nodeId, 'running', evt.timestamp)
      flexTasksStore.handleNodeStart(evt)
      break
    case 'node_complete':
      updateNodeStatus(evt.nodeId, 'completed', evt.timestamp)
      flexTasksStore.handleNodeComplete(evt)
      break
    case 'node_error':
      updateNodeStatus(evt.nodeId, 'error', evt.timestamp)
      if (!runError.value && evt.message) {
        runError.value = evt.message
      }
      flexTasksStore.handleNodeError(evt)
      break
    case 'hitl_request':
      runStatus.value = 'hitl'
      updateNodeStatus(evt.nodeId, 'awaiting_hitl', evt.timestamp)
      {
        const request = extractHitlRequest(evt.payload)
        if (request) {
          const receivedAt = request.createdAt ? new Date(request.createdAt) : new Date(evt.timestamp)
          const threadHint = pendingRun.value.threadId ?? runId.value ?? null
          hitlStore.startTrackingRequest({
            requestId: request.id,
            payload: request.requestPayload,
            originAgent: request.originAgent,
            receivedAt,
            threadId: threadHint,
            pendingNodeId: request.pendingNodeId ?? null,
            operatorPrompt: request.operatorPrompt ?? null,
            contractSummary: request.contractSummary ?? null
          })
          hitlStore.markAwaiting(request.id)
        }
      }
      break
    case 'hitl_resolved': {
      runStatus.value = 'running'
      const resolution = extractHitlResolution(evt.payload)
      if (resolution) {
        hitlStore.completeRequest({ requestId: resolution.id })
      } else {
        hitlStore.clearRequest('resolved')
      }
      break
    }
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
      if (evt.message === 'hitl_request_denied') {
        const payload = evt.payload as Record<string, unknown> | undefined
        const reason = typeof payload?.reason === 'string' ? payload.reason : undefined
        hitlStore.handleDenial(reason)
        runStatus.value = 'running'
      } else if (evt.message && evt.message.toLowerCase().includes('error')) {
        runError.value = evt.message
      }
      break
    case 'complete': {
      const payload = (evt.payload ?? {}) as Record<string, unknown>
      const status = typeof payload.status === 'string' ? payload.status : null
      if (status === 'failed') {
        runStatus.value = 'error'
        if (typeof payload.error === 'string' && !runError.value) {
          runError.value = payload.error
        }
      } else if (runStatus.value !== 'error') {
        runStatus.value = 'completed'
      }
      hitlStore.resetAll()
      break
    }
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

async function runEnvelope(options?: {
  envelope?: TaskEnvelope
  resumeContext?: { runId?: string | null; threadId?: string | null }
  mode?: 'start' | 'resume'
  resumeSubmission?: FlexResumeSubmission | null
}) {
  if (runStatus.value === 'running') {
    return
  }

  const mode = options?.mode ?? 'start'
  const headers: Record<string, string> = {}
  if (FLEX_AUTH) headers.authorization = `Bearer ${FLEX_AUTH}`

  if (mode === 'resume') {
    const resumeRunId =
      options?.resumeContext?.runId ?? pendingRun.value.runId ?? runId.value ?? null
    const resumeThreadId = options?.resumeContext?.threadId ?? pendingRun.value.threadId ?? null
    if (!resumeRunId) {
      runError.value = 'No flex run is available for resume.'
      return
    }

    // Close any existing stream before starting the resume flow
    abortRun()

    const expectedPlanVersion =
      typeof plan.value?.version === 'number' ? plan.value.version : undefined
    const resumePayload: Record<string, unknown> = { runId: resumeRunId }
    if (typeof expectedPlanVersion === 'number') {
      resumePayload.expectedPlanVersion = expectedPlanVersion
    }
    if (options?.resumeSubmission) {
      const submission = options.resumeSubmission
      const payloadBody: Record<string, unknown> = {
        nodeId: submission.nodeId
      }
      if (submission.output) {
        payloadBody.output = submission.output
      }
      if (submission.decline) {
        payloadBody.decline = submission.decline
      }
      if (submission.submittedAt) {
        payloadBody.submittedAt = submission.submittedAt
      }
      if (submission.note) {
        payloadBody.note = submission.note
      }
      resumePayload.payload = payloadBody
    }
    const profile = operatorProfile.value
    if (profile && (profile.id || profile.displayName || profile.email)) {
      resumePayload.operator = {
        ...(profile.id ? { id: profile.id } : {}),
        ...(profile.displayName ? { displayName: profile.displayName } : {}),
        ...(profile.email ? { email: profile.email } : {})
      }
    }
    if (correlationId.value) {
      resumePayload.correlationId = correlationId.value
    }

    resetRunState()
    runStatus.value = 'running'
    hitlStore.setRunId(resumeRunId)
    hitlStore.setThreadId(resumeThreadId ?? null)

    streamHandle = postFlexEventStream({
      url: `${FLEX_BASE_URL}/api/v1/flex/run.resume`,
      body: resumePayload,
      headers,
      onEvent: handleEvent,
      onCorrelationId: (cid) => {
        correlationId.value = cid
      },
      onBackoff: handleBackoff,
      maxRetries: 2
    })
  } else {
    // Ensure we don't have a lingering stream from a previous run
    abortRun()
    let envelope = options?.envelope
    if (!envelope) {
      if (!parsedEnvelope.value) {
        updateValidation()
        if (!parsedEnvelope.value) return
      }
      envelope = parsedEnvelope.value
    }
    resetRunState()
    if (options?.resumeContext) {
      const resumeRunId = options.resumeContext.runId ?? null
      const resumeThreadId = options.resumeContext.threadId ?? null
      if (resumeRunId) {
        hitlStore.setRunId(resumeRunId)
      }
      if (resumeThreadId) {
        hitlStore.setThreadId(resumeThreadId)
      }
    }
    runStatus.value = 'running'

    streamHandle = postFlexEventStream({
      url: `${FLEX_BASE_URL}/api/v1/flex/run.stream`,
      body: envelope,
      headers,
      onEvent: handleEvent,
      onCorrelationId: (cid) => {
        correlationId.value = cid
      },
      onBackoff: handleBackoff,
      maxRetries: 2
    })
  }

  try {
    await streamHandle!.done
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

async function runPlanForTemplate(id: string) {
  if (!id) return
  if (selectedTemplateId.value !== id) {
    selectTemplateById(id, { skipPersist: true })
    await nextTick()
  }
  updateValidation()
  if (runStatus.value === 'running') {
    notifications.notifyInfo('A flex run is already in progress.')
    return
  }
  if (runDisabled.value) {
    notifications.enqueue({
      message: 'Resolve validation issues in the TaskEnvelope before running.',
      kind: 'warning'
    })
    await openEnvelopeEditor({ id })
    return
  }
  activeRunEnvelopeId.value = id
  await runEnvelope()
}

async function handleHitlResume(trigger?: HitlResumeTrigger) {
  if (runStatus.value === 'running') return
  const resumeRunId = pendingRun.value.runId ?? runId.value ?? null
  const threadId = pendingRun.value.threadId ?? null
  if (!resumeRunId) {
    runError.value = 'No flex run is available for resume.'
    return
  }
  const resumeSubmission = buildResumeSubmission(trigger)
  await runEnvelope({
    mode: 'resume',
    resumeContext: {
      runId: resumeRunId,
      threadId
    },
    resumeSubmission
  })
}

function abortRun() {
  if (!streamHandle) return
  try {
    streamHandle.abort()
  } catch {
    // ignore
  } finally {
    streamHandle = null
    hitlStore.resetAll()
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

function formatCapabilityName(cap: CapabilityRecord): string {
  const versionSuffix = cap.version ? ` (v${cap.version})` : ''
  return `${cap.displayName}${versionSuffix}`
}

function formatCapabilityDetails(cap: CapabilityRecord): string {
  const parts: string[] = []
  if (cap.capabilityId) parts.push(cap.capabilityId)
  if (cap.status) parts.push(formatCapabilityStatusLabel(cap.status))
  return parts.join(' | ')
}

function formatCapabilityStatusLabel(status?: CapabilityRecord['status']): string {
  if (!status) return ''
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function formatFacetLabel(facet: FacetDescriptor): string {
  if (facet.title && facet.title !== facet.name) {
    return `${facet.title} (${facet.name})`
  }
  return facet.title ?? facet.name
}

function formatFacetDirectionLabel(direction?: FacetDirection): string {
  if (!direction) return ''
  switch (direction) {
    case 'input':
      return 'Input'
    case 'output':
      return 'Output'
    case 'bidirectional':
      return 'Bidirectional'
    default:
      return direction
  }
}

function facetDirectionColor(direction?: FacetDirection): string | undefined {
  switch (direction) {
    case 'input':
      return 'primary'
    case 'output':
      return 'success'
    case 'bidirectional':
      return 'secondary'
    default:
      return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function extractHitlRequest(payload: unknown): {
  id: string
  originAgent: HitlOriginAgent
  requestPayload: HitlRequestPayload
  createdAt?: string
  pendingNodeId?: string | null
  operatorPrompt?: string | null
  contractSummary?: HitlContractSummary | null
} | null {
  if (!isRecord(payload)) return null
  const request = payload.request
  if (!isRecord(request)) return null
  const id = typeof request.id === 'string' ? request.id : null
  if (!id) return null
  const originAgentValue = typeof request.originAgent === 'string' ? request.originAgent : ''
  const originAgentResult = HitlOriginAgentEnum.safeParse(originAgentValue)
  const payloadResult = HitlRequestPayloadSchema.safeParse(request.payload)
  if (!payloadResult.success) return null
  let originAgent: HitlOriginAgent = 'generation'
  if (originAgentResult.success) {
    originAgent = originAgentResult.data
  } else if (originAgentValue) {
    const normalized = originAgentValue.toLowerCase()
    if (normalized.includes('strategy')) originAgent = 'strategy'
    else if (normalized.includes('qa')) originAgent = 'qa'
    else originAgent = 'generation'
  }
  const createdRaw = request.createdAt
  const createdAt =
    typeof createdRaw === 'string'
      ? createdRaw
      : createdRaw instanceof Date
      ? createdRaw.toISOString()
      : undefined
  const pendingNodeId =
    typeof request.pendingNodeId === 'string' && request.pendingNodeId.trim().length
      ? request.pendingNodeId
      : null
  const operatorPrompt =
    typeof request.operatorPrompt === 'string' && request.operatorPrompt.trim().length
      ? request.operatorPrompt
      : null
  let contractSummary: HitlContractSummary | null = null
  if (request.contractSummary) {
    const contractResult = HitlContractSummarySchema.safeParse(request.contractSummary)
    if (contractResult.success) {
      contractSummary = contractResult.data
    }
  }
  return {
    id,
    originAgent,
    requestPayload: payloadResult.data,
    createdAt,
    pendingNodeId,
    operatorPrompt,
    contractSummary
  }
}

function extractHitlResolution(payload: unknown): { id: string } | null {
  if (!isRecord(payload)) return null
  const request = payload.request
  if (!isRecord(request)) return null
  const id = typeof request.id === 'string' ? request.id : null
  if (!id) return null
  return { id }
}

function buildResumeSubmission(trigger?: HitlResumeTrigger | null): FlexResumeSubmission | null {
  if (!trigger || !trigger.nodeId) return null
  const submittedAt = new Date().toISOString()
  const note = trigger.freeformText?.trim() ?? ''
  if (trigger.responseType === 'rejection' || trigger.approved === false) {
    const reason = note || 'Operator rejected request'
    return {
      nodeId: trigger.nodeId,
      decline: {
        reason,
        note: note ? note : null
      },
      submittedAt,
      note: note || undefined
    }
  }
  const output: Record<string, unknown> = {}
  if (trigger.responseType === 'approval') {
    output.decision = trigger.approved ? 'approved' : 'rejected'
    output.approved = trigger.approved ?? false
    if (note) {
      output.note = note
    }
  } else {
    if (note) {
      output.response = note
    }
    if (trigger.selectedOptionId) {
      output.selectedOptionId = trigger.selectedOptionId
    }
  }
  if (!Object.keys(output).length) {
    return null
  }
  return {
    nodeId: trigger.nodeId,
    output,
    submittedAt,
    note: note || undefined
  }
}

async function hydrateHitlState(options?: { force?: boolean }) {
  if (typeof window === 'undefined') return
  try {
    await hitlStore.hydrateFromPending({ force: options?.force ?? false })
    if (pendingRun.value.runId) {
      runId.value = pendingRun.value.runId ?? undefined
    }
    if (
      (pendingRun.value.pendingRequestId || hasActiveRequest.value) &&
      runStatus.value !== 'running'
    ) {
      runStatus.value = 'hitl'
    }
  } catch (err) {
    console.warn('Failed to hydrate HITL state', err)
  }
}

onMounted(() => {
  void hydrateHitlState({ force: true })
  if (FLEX_SANDBOX_ENABLED) {
    void loadMetadata()
  }
  void flexTasksStore.hydrateFromBacklog({ syncLegacyHitl: false })
  externalEventCleanup = addFlexEventListener((evt) => {
    if (evt.runId && runId.value && evt.runId !== runId.value) return
    handleEvent(evt)
  })
})

onBeforeUnmount(() => {
  if (saveTimeout) {
    clearTimeout(saveTimeout)
    saveTimeout = null
  }
  abortRun()
  externalEventCleanup?.()
  externalEventCleanup = null
})

watch(
  () => envelopeBuilder.lastMissingFields,
  (fields) => {
    conversationMissingFields.value = [...fields]
  },
  { deep: true }
)

watch(
  selectedDraftEntry,
  (entry) => {
    if (entry?.label) {
      envelopeEditorLabel.value = entry.label
    } else if (selectedTemplateId.value && selectedTemplate.value) {
      envelopeEditorLabel.value = displayLabelForTemplate(selectedTemplate.value)
    } else if (selectedTemplateId.value) {
      envelopeEditorLabel.value = `Draft ${selectedTemplateId.value}`
    } else {
      envelopeEditorLabel.value = ''
    }
  },
  { immediate: true }
)

watch(
  () => pendingRun.value.runId,
  (nextRunId) => {
    if (nextRunId) {
      runId.value = nextRunId
    } else if (!pendingRun.value.pendingRequestId && runStatus.value === 'idle') {
      runId.value = undefined
    }
  },
  { immediate: true }
)

watch(
  () => pendingRun.value.pendingRequestId,
  (pendingRequestId) => {
    if (pendingRequestId) {
      if (runStatus.value !== 'running') {
        runStatus.value = 'hitl'
      }
    } else if (!hasActiveRequest.value && runStatus.value === 'hitl') {
      runStatus.value = 'idle'
    }
  },
  { immediate: true }
)

watch(
  hasActiveRequest,
  (active) => {
    if (active) {
      if (runStatus.value !== 'running') {
        runStatus.value = 'hitl'
      }
    } else if (!pendingRun.value.pendingRequestId && runStatus.value === 'hitl') {
      runStatus.value = 'idle'
    }
  },
  { immediate: true }
)

watch(runStatus, (status) => {
  if (status === 'idle') {
    activeRunEnvelopeId.value = null
  }
})

watch(
  () => envelopeEditorOpen.value,
  (open) => {
    if (!open) return
    if (envelopeEditorFocus.value === 'label') {
      nextTick(() => {
        envelopeLabelField.value?.focus()
      })
    }
  }
)

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
        <v-col cols="12" md="5" class="d-flex flex-column ga-4">
          <v-card>
            <v-card-title class="text-subtitle-1 d-flex align-center justify-space-between">
              <span>Task Envelopes</span>
              <v-btn icon="mdi-refresh" variant="text" density="comfortable" @click="loadMetadata(true)" :loading="metadataLoading" />
            </v-card-title>
            <v-card-subtitle>Existing envelopes & local drafts</v-card-subtitle>
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
                    <div class="d-flex align-center ga-2">
                      <div class="d-flex align-center ga-1">
                        <v-btn
                          v-if="runStateForEnvelope(template.id) === 'running'"
                          icon="mdi-stop-circle-outline"
                          size="small"
                          variant="text"
                          :title="'Stop current run'"
                          @click.stop="abortRun"
                        />
                        <v-btn
                          v-else-if="runStateForEnvelope(template.id) === 'hitl'"
                          icon="mdi-reload"
                          size="small"
                          variant="text"
                          :title="'Resume run'"
                          @click.stop="handleHitlResume"
                        />
                        <v-btn
                          v-else
                          icon="mdi-play"
                          size="small"
                          variant="text"
                          :title="'Run plan'"
                          :disabled="runStatus !== 'idle' && !isEnvelopeActive(template.id)"
                          @click.stop="runPlanForTemplate(template.id)"
                        />
                      </div>
                      <v-tooltip v-if="runStateForEnvelope(template.id) !== 'idle'" location="bottom">
                        <template #activator="{ props }">
                          <v-chip
                            size="small"
                            v-bind="props"
                            :color="runStatusChipColor"
                            variant="tonal"
                            class="text-caption"
                          >
                            {{ runStatusChipLabel }}
                          </v-chip>
                        </template>
                        <span>{{ runStatusTooltip }}</span>
                      </v-tooltip>
                      <v-menu>
                        <template #activator="{ props }">
                          <v-btn
                            icon="mdi-dots-vertical"
                            size="small"
                            variant="text"
                            v-bind="props"
                            @click.stop
                          />
                        </template>
                        <v-list density="compact">
                          <v-list-item @click.stop="openEnvelopeEditor({ id: template.id })">
                            <v-list-item-title>Edit envelope</v-list-item-title>
                          </v-list-item>
                          <v-list-item
                            v-if="drafts[template.id]"
                            @click.stop="openEnvelopeEditor({ id: template.id, focus: 'label' })"
                          >
                            <v-list-item-title>Rename draft</v-list-item-title>
                          </v-list-item>
                        </v-list>
                      </v-menu>
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
                    <div class="d-flex align-center ga-2">
                      <div class="d-flex align-center ga-1">
                        <v-btn
                          v-if="runStateForEnvelope(entry.id) === 'running'"
                          icon="mdi-stop-circle-outline"
                          size="small"
                          variant="text"
                          :title="'Stop current run'"
                          @click.stop="abortRun"
                        />
                        <v-btn
                          v-else-if="runStateForEnvelope(entry.id) === 'hitl'"
                          icon="mdi-reload"
                          size="small"
                          variant="text"
                          :title="'Resume run'"
                          @click.stop="handleHitlResume"
                        />
                        <v-btn
                          v-else
                          icon="mdi-play"
                          size="small"
                          variant="text"
                          :title="'Run plan'"
                          :disabled="runStatus !== 'idle' && !isEnvelopeActive(entry.id)"
                          @click.stop="runPlanForTemplate(entry.id)"
                        />
                      </div>
                      <v-tooltip v-if="runStateForEnvelope(entry.id) !== 'idle'" location="bottom">
                        <template #activator="{ props }">
                          <v-chip
                            size="small"
                            v-bind="props"
                            :color="runStatusChipColor"
                            variant="tonal"
                            class="text-caption"
                          >
                            {{ runStatusChipLabel }}
                          </v-chip>
                        </template>
                        <span>{{ runStatusTooltip }}</span>
                      </v-tooltip>
                      <v-menu>
                        <template #activator="{ props }">
                          <v-btn
                            icon="mdi-dots-vertical"
                            size="small"
                            variant="text"
                            v-bind="props"
                            @click.stop
                          />
                        </template>
                        <v-list density="compact">
                          <v-list-item @click.stop="openEnvelopeEditor({ id: entry.id })">
                            <v-list-item-title>Edit envelope</v-list-item-title>
                          </v-list-item>
                          <v-list-item @click.stop="openEnvelopeEditor({ id: entry.id, focus: 'label' })">
                            <v-list-item-title>Rename draft</v-list-item-title>
                          </v-list-item>
                          <v-divider />
                          <v-list-item @click.stop="removeDraft(entry.id)">
                            <v-list-item-title class="text-error">Delete draft</v-list-item-title>
                          </v-list-item>
                        </v-list>
                      </v-menu>
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
            <v-expansion-panels variant="accordion">
              <v-expansion-panel value="registry" :model-value="[]">
                <v-expansion-panel-title class="text-subtitle-1">
                  <div class="d-flex flex-column">
                    <span>Registry Snapshot</span>
                    <span v-if="metadata?.generatedAt" class="text-caption text-medium-emphasis">
                      Updated {{ formatTimestamp(metadata?.generatedAt) }}
                    </span>
                  </div>
                </v-expansion-panel-title>
                <v-expansion-panel-text>
                  <div class="text-body-2 mb-2">
                    <strong>Capabilities:</strong>
                    {{ metadata?.capabilities?.active.length ?? 0 }} active /
                    {{ metadata?.capabilities?.all.length ?? 0 }} total
                  </div>
                  <div v-if="capabilitySnapshot.length" class="mt-3">
                    <div class="d-flex align-center justify-space-between mb-1">
                      <div class="text-caption text-medium-emphasis text-uppercase">Registered capabilities</div>
                      <v-btn
                        icon
                        size="x-small"
                        variant="text"
                        :aria-label="showCapabilitySnapshot ? 'Collapse capabilities' : 'Expand capabilities'"
                        @click="showCapabilitySnapshot = !showCapabilitySnapshot"
                      >
                        <v-icon :icon="showCapabilitySnapshot ? 'mdi-chevron-up' : 'mdi-chevron-down'" />
                      </v-btn>
                    </div>
                    <v-expand-transition>
                      <v-list
                        v-if="showCapabilitySnapshot"
                        density="compact"
                        class="registry-overview-list"
                      >
                        <v-list-item
                          v-for="cap in capabilitySnapshot"
                          :key="cap.capabilityId"
                          class="py-1"
                        >
                          <v-list-item-title>{{ formatCapabilityName(cap) }}</v-list-item-title>
                          <v-list-item-subtitle>
                            {{ formatCapabilityDetails(cap) }}
                          </v-list-item-subtitle>
                        </v-list-item>
                      </v-list>
                    </v-expand-transition>
                  </div>
                  <div class="text-body-2 mt-4 mb-2">
                    <strong>Facets:</strong> {{ metadata?.facets.length ?? 0 }}
                  </div>
                  <div v-if="facetCatalogEntries.length" class="mt-1">
                    <div class="d-flex align-center justify-space-between mb-1">
                      <div class="text-caption text-medium-emphasis text-uppercase">Facet catalog</div>
                      <v-btn
                        icon
                        size="x-small"
                        variant="text"
                        :aria-label="showFacetSnapshot ? 'Collapse facets' : 'Expand facets'"
                        @click="showFacetSnapshot = !showFacetSnapshot"
                      >
                        <v-icon :icon="showFacetSnapshot ? 'mdi-chevron-up' : 'mdi-chevron-down'" />
                      </v-btn>
                    </div>
                    <v-expand-transition>
                      <div v-if="showFacetSnapshot" class="registry-facets">
                        <v-chip
                          v-for="facet in facetCatalogEntries"
                          :key="facet.name"
                          size="small"
                          class="me-1 mb-1"
                          variant="outlined"
                          :color="facetDirectionColor(facet.metadata?.direction)"
                        >
                          <span>{{ formatFacetLabel(facet) }}</span>
                          <span
                            v-if="facet.metadata?.direction"
                            class="ms-2 text-caption text-medium-emphasis"
                          >
                            {{ formatFacetDirectionLabel(facet.metadata?.direction) }}
                          </span>
                        </v-chip>
                      </div>
                    </v-expand-transition>
                  </div>
                  <div v-if="metadata?.capabilityCatalog?.length" class="mt-4">
                    <div class="d-flex align-center justify-space-between mb-1">
                      <div class="text-caption text-medium-emphasis text-uppercase">Capability catalog prompts</div>
                      <v-btn
                        icon
                        size="x-small"
                        variant="text"
                        :aria-label="showCatalogSnapshot ? 'Collapse catalog prompts' : 'Expand catalog prompts'"
                        @click="showCatalogSnapshot = !showCatalogSnapshot"
                      >
                        <v-icon :icon="showCatalogSnapshot ? 'mdi-chevron-up' : 'mdi-chevron-down'" />
                      </v-btn>
                    </div>
                    <v-expand-transition>
                      <div v-if="showCatalogSnapshot" class="d-flex flex-wrap">
                        <v-chip
                          v-for="cap in metadata.capabilityCatalog"
                          :key="cap.id"
                          size="small"
                          color="primary"
                          class="me-1 mb-1"
                          variant="outlined"
                        >
                          {{ cap.name }} <span class="text-caption text-medium-emphasis ms-2">({{ cap.id }})</span>
                        </v-chip>
                      </div>
                    </v-expand-transition>
                  </div>
                  <v-alert
                    v-if="metadataError"
                    type="error"
                    variant="tonal"
                    border="start"
                    class="mt-4"
                    :text="metadataError"
                  />
                </v-expansion-panel-text>
              </v-expansion-panel>
            </v-expansion-panels>
          </v-card>
          <v-alert
            v-if="planStreamError"
            type="error"
            variant="tonal"
            border="start"
            class="mb-4"
          >
            <div class="font-weight-medium">Plan Snapshot Rejected</div>
            <div>{{ planStreamError }}</div>
          </v-alert>
          <FlexSandboxPlanInspector
            :plan="plan"
            :capability-catalog="capabilityRecords"
          />
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
                  :dot-color="frame.type === 'node_error' || frame.type === 'validation_error' ? 'error' : 'primary'"
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

        <v-col cols="12" md="7" class="d-flex flex-column ga-4">
          <FlexTaskPanel
            v-if="hasFlexTasks || flexTasksLoading"
          />
          <HitlPromptPanel
            v-if="showHitlPanel"
            @resume="handleHitlResume"
          />
        </v-col>
      </v-row>
    </template>
  </v-container>

  <v-dialog
    :model-value="envelopeEditorOpen"
    @update:model-value="(value) => {
      if (!value) {
        closeEnvelopeEditor()
      }
    }"
    max-width="1200"
    scrollable
  >
    <v-card class="envelope-editor-dialog d-flex flex-column">
      <v-card-title class="text-subtitle-1 d-flex align-center justify-space-between">
        <span>TaskEnvelope Workspace</span>
        <v-btn icon="mdi-close" variant="text" @click="closeEnvelopeEditor">
          <v-icon icon="mdi-close" />
        </v-btn>
      </v-card-title>
      <v-card-text>
        <v-row class="ga-4">
          <v-col cols="12" md="7" class="d-flex flex-column">
            <v-card class="flex-grow-1 d-flex flex-column">
              <v-card-title class="text-subtitle-1 d-flex align-center justify-space-between">
                <span>TaskEnvelope Editor</span>
                <div class="d-flex ga-2">
                  <v-btn icon="mdi-code-braces" variant="text" @click="openRawJsonEditor">
                    <v-icon icon="mdi-code-braces" />
                  </v-btn>
                  <v-btn icon="mdi-content-copy" variant="text" @click="copyEnvelopeJson">
                    <v-icon icon="mdi-content-copy" />
                  </v-btn>
                  <v-btn icon="mdi-format-align-justify" variant="text" @click="formatDraft" :disabled="!parsedEnvelope">
                    <v-icon icon="mdi-code-tags" />
                  </v-btn>
                </div>
              </v-card-title>
              <v-card-text class="flex-grow-1 d-flex flex-column ga-4">
                <v-text-field
                  ref="envelopeLabelField"
                  v-model="envelopeEditorLabel"
                  label="Draft name"
                  variant="outlined"
                  density="comfortable"
                  :disabled="!selectedTemplateId"
                  @blur="commitEnvelopeLabel"
                  @keydown.enter.prevent="commitEnvelopeLabel"
                />
                <v-alert
                  v-if="parseError"
                  type="error"
                  variant="tonal"
                  border="start"
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
                  v-for="field in conversationMissingFields"
                  :key="`missing-${field}`"
                  type="warning"
                  variant="tonal"
                  border="start"
                  class="mb-2"
                >
                  <div class="text-body-2">
                    Missing required field: <span class="font-mono">{{ field }}</span>
                  </div>
                </v-alert>
                <v-alert
                  v-if="currentTemplateError"
                  type="warning"
                  variant="tonal"
                  border="start"
                  class="mb-2"
                  :text="`Template parsing error: ${currentTemplateError}`"
                />
                <div class="envelope-preview flex-grow-1">
                  <VueJsonPretty
                    v-if="parsedEnvelope"
                    :data="parsedEnvelope"
                    :deep="2"
                    :show-length="false"
                    class="envelope-json-tree font-mono"
                  />
                  <div v-else class="envelope-preview-placeholder font-mono">
                    // Provide inputs via the conversational builder or raw JSON editor to render an envelope preview.
                  </div>
                </div>
              </v-card-text>
              <v-divider />
              <v-card-actions>
                <div class="text-caption text-medium-emphasis">
                  Run controls now live in the template actions menu.
                </div>
                <v-spacer />
                <v-btn variant="text" @click="closeEnvelopeEditor">Close</v-btn>
              </v-card-actions>
            </v-card>
          </v-col>
          <v-col cols="12" md="5" class="d-flex flex-column">
            <v-card class="conversation-card">
              <v-card-title class="text-subtitle-1 d-flex align-center justify-space-between">
                <span>Conversational Builder</span>
                <div class="d-flex ga-2">
                  <v-btn
                    icon="mdi-undo"
                    variant="text"
                    :disabled="!envelopeBuilder.canUndo"
                    @click="undoLastBuilderDelta"
                    :title="envelopeBuilder.canUndo ? 'Undo last assistant change' : 'No changes to undo'"
                  >
                    <v-icon icon="mdi-undo" />
                  </v-btn>
                  <v-btn
                    icon="mdi-refresh"
                    variant="text"
                    :disabled="envelopeBuilder.pending"
                    @click="resetEnvelopeConversation"
                    title="Reset conversation"
                  >
                    <v-icon icon="mdi-refresh" />
                  </v-btn>
                </div>
              </v-card-title>
              <v-card-subtitle>Guide GPT-5 to refine TaskEnvelope fields one response at a time.</v-card-subtitle>
              <v-divider />
              <v-card-text class="conversation-card__body d-flex flex-column ga-3">
                <v-alert
                  v-if="envelopeBuilder.error"
                  type="error"
                  variant="tonal"
                  border="start"
                >
                  {{ envelopeBuilder.error }}
                </v-alert>

                <div v-if="envelopeBuilder.messages.length" class="conversation-history">
                  <div
                    v-for="message in envelopeBuilder.messages"
                    :key="message.id"
                    :class="[
                      'conversation-entry',
                      `conversation-entry--${message.role}`,
                      { 'conversation-entry--error': message.error }
                    ]"
                  >
                    <div class="conversation-entry__meta">
                      <span class="conversation-entry__role">{{ formatConversationRole(message.role) }}</span>
                      <span class="conversation-entry__timestamp">{{ formatTimestamp(message.timestamp) }}</span>
                    </div>
                    <div class="conversation-entry__content">{{ message.content }}</div>
                  </div>
                </div>
                <div v-else class="conversation-placeholder text-body-2 text-medium-emphasis">
                  Start a guided conversation to collect objectives, knobs, and policies without hand-editing JSON.
                </div>

                <div v-if="envelopeBuilder.lastDeltaSummary.length" class="conversation-delta">
                  <div class="text-caption text-medium-emphasis mb-1">Recent updates</div>
                  <ul class="ma-0 ps-4 text-body-2">
                    <li v-for="item in envelopeBuilder.lastDeltaSummary" :key="item">{{ item }}</li>
                  </ul>
                </div>

                <div v-if="envelopeBuilder.lastWarnings.length" class="conversation-warnings">
                  <v-alert
                    v-for="warning in envelopeBuilder.lastWarnings"
                    :key="warning"
                    type="warning"
                    variant="tonal"
                    border="start"
                    class="mb-2"
                  >
                    {{ warning }}
                  </v-alert>
                </div>

                <div v-if="envelopeBuilder.hasConversation" class="conversation-input">
                  <v-textarea
                    v-model="builderInput"
                    variant="outlined"
                    class="font-mono"
                    auto-grow
                    rows="3"
                    :disabled="envelopeBuilder.pending"
                    label="Your response"
                    placeholder="Describe objectives, constraints, or adjustments..."
                    @keydown.enter.exact.prevent="sendEnvelopeBuilderMessage"
                    @keydown.enter.shift.stop
                  />
                  <div class="d-flex justify-end mt-2 ga-2">
                    <v-btn
                      variant="text"
                      @click="builderInput = ''"
                      :disabled="!builderInput"
                    >
                      Clear
                    </v-btn>
                    <v-btn
                      color="primary"
                      prepend-icon="mdi-send"
                      :loading="envelopeBuilder.pending"
                      :disabled="!builderInput.trim() || envelopeBuilder.pending"
                      @click="sendEnvelopeBuilderMessage"
                    >
                      Send
                    </v-btn>
                  </div>
                </div>
                <div v-else class="conversation-start">
                  <v-btn
                    color="primary"
                    prepend-icon="mdi-message-plus"
                    :loading="envelopeBuilder.pending"
                    @click="startEnvelopeConversation"
                  >
                    Start guided builder
                  </v-btn>
                </div>
              </v-card-text>
              <v-divider />
              <v-card-actions class="d-flex align-center">
                <div class="text-caption text-medium-emphasis" v-if="envelopeBuilder.conversationId">
                  Conversation ID: {{ envelopeBuilder.conversationId }}
                </div>
                <v-spacer />
                <v-btn
                  variant="text"
                  prepend-icon="mdi-refresh"
                  :disabled="envelopeBuilder.pending"
                  @click="resetEnvelopeConversation"
                >
                  Reset
                </v-btn>
                <v-btn
                  variant="text"
                  prepend-icon="mdi-undo"
                  :disabled="!envelopeBuilder.canUndo"
                  @click="undoLastBuilderDelta"
                >
                  Undo change
                </v-btn>
              </v-card-actions>
            </v-card>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>
  </v-dialog>

  <v-dialog v-model="rawEditorOpen" max-width="720">
    <v-card>
      <v-card-title class="text-subtitle-1">Raw JSON Editor</v-card-title>
      <v-card-subtitle>Advanced tweaks validate against TaskEnvelopeSchema</v-card-subtitle>
      <v-card-text class="d-flex flex-column ga-3">
        <v-alert
          v-if="rawEditorParseError"
          type="error"
          variant="tonal"
          border="start"
          :text="rawEditorParseError"
        />
        <v-alert
          v-for="issue in rawEditorValidationErrors"
          :key="issue"
          type="error"
          variant="tonal"
          border="start"
          :text="issue"
        />
        <v-textarea
          v-model="rawEditorText"
          class="font-mono"
          variant="outlined"
          rows="18"
          auto-grow
          spellcheck="false"
          hint="Ensure the payload remains valid TaskEnvelope JSON."
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="closeRawJsonEditor">Cancel</v-btn>
        <v-btn color="primary" @click="applyRawJsonEditor">Apply changes</v-btn>
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
.envelope-preview {
  flex: 1 1 auto;
  display: flex;
  min-height: 260px;
}
.envelope-json-tree {
  flex: 1 1 auto;
  border-radius: 6px;
  background-color: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 12px;
  overflow: auto;
}
.envelope-json-tree :deep(.vjs-tree__node) {
  font-size: 13px;
}
.envelope-preview-placeholder {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  border-radius: 6px;
  border: 1px dashed rgba(255, 255, 255, 0.24);
  background-color: rgba(255, 255, 255, 0.02);
  padding: 24px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
}
.conversation-card {
  display: flex;
  flex-direction: column;
}
.conversation-card__body {
  flex: 1 1 auto;
  min-height: 260px;
}
.conversation-history {
  max-height: 260px;
  overflow-y: auto;
  padding: 12px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background-color: rgba(255, 255, 255, 0.04);
}
.conversation-entry {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  padding: 10px;
  background-color: rgba(255, 255, 255, 0.02);
}
.conversation-entry + .conversation-entry {
  margin-top: 10px;
}
.conversation-entry--assistant {
  background-color: rgba(103, 80, 164, 0.12);
  border-color: rgba(103, 80, 164, 0.24);
}
.conversation-entry--user {
  background-color: rgba(33, 150, 243, 0.12);
  border-color: rgba(33, 150, 243, 0.24);
}
.conversation-entry--system {
  border-style: dashed;
  color: rgba(255, 255, 255, 0.65);
}
.conversation-entry--error {
  border-color: rgba(244, 67, 54, 0.5);
}
.conversation-entry__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  margin-bottom: 4px;
}
.conversation-entry__role {
  font-weight: 600;
}
.conversation-entry__timestamp {
  color: rgba(255, 255, 255, 0.55);
}
.conversation-entry__content {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 14px;
}
.conversation-placeholder {
  border: 1px dashed rgba(255, 255, 255, 0.24);
  border-radius: 6px;
  padding: 16px;
}
.conversation-delta {
  border-left: 2px solid rgba(255, 255, 255, 0.2);
  padding-left: 12px;
}
.conversation-warnings {
  display: flex;
  flex-direction: column;
}
.conversation-input :deep(textarea) {
  font-size: 14px;
}
.registry-overview-list {
  background-color: transparent;
}
.registry-overview-list :deep(.v-list-item-title) {
  font-weight: 500;
}
.registry-facets {
  display: flex;
  flex-wrap: wrap;
}
</style>
