import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  FlexFacetProvenanceMap,
  FlexPlanNodeContracts,
  FlexPlanNodeFacets
} from '@awesomeposter/shared'
import { useHitlStore } from '@/stores/hitl'
import { useNotificationsStore } from '@/stores/notifications'
import { postFlexEventStream, type FlexEventWithId } from '@/lib/flex-sse'
import { emitFlexEvent } from '@/lib/flex-event-bus'

type SubmissionState = 'idle' | 'submitting' | 'success' | 'error'

type FlexAssignmentStatus =
  | 'awaiting_submission'
  | 'pending'
  | 'in_progress'
  | 'submitted'
  | 'completed'
  | 'cancelled'
  | 'error'

export interface FlexTaskRecord {
  taskId: string
  assignmentId: string
  runId: string
  nodeId: string
  capabilityId: string | null
  label: string | null
  status: FlexAssignmentStatus
  assignedTo: string | null
  role: string | null
  dueAt: string | null
  priority: 'urgent' | 'high' | 'normal' | 'low' | null
  instructions: string | null
  defaults: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  notifyChannels: string[] | null
  timeoutSeconds: number | null
  maxNotifications: number | null
  createdAt: string | null
  updatedAt: string | null
  startedAt: string | null
  contracts: FlexPlanNodeContracts | null
  facets: FlexPlanNodeFacets | null
  facetProvenance: FlexFacetProvenanceMap | null
  awaitingConfirmation: boolean
  submissionState: SubmissionState
  submissionError: string | null
  declineState: SubmissionState
  declineError: string | null
  lastSubmittedPayload: Record<string, unknown> | null
}

export interface FlexTaskSubmissionInput {
  output: Record<string, unknown>
  note?: string
  submittedAt?: string
  expectedPlanVersion?: number
  correlationId?: string
}

export interface FlexTaskDeclineInput {
  reason: string
  note?: string
}

export interface PostVisualAssetRecord {
  assetId: string
  url: string
  ordering: number
  originalName?: string | null
  mimeType?: string | null
}

export interface PostVisualInputFacetAssetRecord {
  key: string
  assetId: string | null
  url: string
  ordering: number
  name: string
  originalName: string | null
  mimeType: string | null
  meta: Record<string, unknown> | null
}

export interface CompanyInformationAssetRecord {
  uri: string
  label: string
}

export interface CompanyInformationFacetRecord {
  name: string | null
  website: string | null
  industry: string | null
  toneOfVoice: string | null
  specialInstructions: string | null
  audienceSegments: string | null
  preferredChannels: string | null
  brandAssets: CompanyInformationAssetRecord[]
}

type HydrateOptions = {
  assignedTo?: string
  syncLegacyHitl?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  return null
}

function toStringOrUndefined(value: unknown): string | undefined {
  const str = toStringOrNull(value)
  return str === null ? undefined : str
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return null
}

function toStringArrayOrNull(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const items = value
    .map((entry) => toStringOrNull(entry))
    .filter((entry): entry is string => Boolean(entry))
  return items.length ? items : null
}

const EMPTY_COMPANY_INFORMATION_FACET: CompanyInformationFacetRecord = {
  name: null,
  website: null,
  industry: null,
  toneOfVoice: null,
  specialInstructions: null,
  audienceSegments: null,
  preferredChannels: null,
  brandAssets: []
}

function deriveAssetLabelFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const segments = parsed.pathname.split('/').filter(Boolean)
    if (segments.length) return segments[segments.length - 1] ?? url
  } catch {
    // ignore parse errors
  }
  const trimmed = url.split(/[?#]/)[0] ?? url
  const parts = trimmed.split('/').filter(Boolean)
  return parts.length ? parts[parts.length - 1] ?? url : trimmed || url
}

function normalizeCompanyInformationFacet(value: unknown): CompanyInformationFacetRecord {
  if (!isRecord(value)) {
    return {
      ...EMPTY_COMPANY_INFORMATION_FACET,
      brandAssets: []
    }
  }

  const normalized: CompanyInformationFacetRecord = {
    name: toStringOrNull(value.name) ?? toStringOrNull(value.companyName) ?? null,
    website: toStringOrNull(value.website) ?? toStringOrNull(value.url) ?? null,
    industry: toStringOrNull(value.industry) ?? null,
    toneOfVoice: toStringOrNull(value.tone_of_voice) ?? toStringOrNull(value.toneOfVoice) ?? null,
    specialInstructions:
      toStringOrNull(value.special_instructions) ?? toStringOrNull(value.specialInstructions) ?? null,
    audienceSegments:
      toStringOrNull(value.audience_segments) ?? toStringOrNull(value.audienceSegments) ?? null,
    preferredChannels:
      toStringOrNull(value.preferred_channels) ?? toStringOrNull(value.preferredChannels) ?? null,
    brandAssets: []
  }

  const rawAssets = Array.isArray(value.brand_assets)
    ? value.brand_assets
    : Array.isArray(value.brandAssets)
      ? value.brandAssets
      : []

  const assets: CompanyInformationAssetRecord[] = []
  for (const entry of rawAssets) {
    if (typeof entry === 'string') {
      const uri = toStringOrNull(entry)
      if (!uri) continue
      assets.push({
        uri,
        label: deriveAssetLabelFromUrl(uri)
      })
      continue
    }
    if (isRecord(entry)) {
      const uri =
        toStringOrNull(entry.url) ??
        toStringOrNull(entry.uri) ??
        toStringOrNull(entry.href) ??
        null
      if (!uri) continue
      const label =
        toStringOrNull(entry.label) ??
        toStringOrNull(entry.name) ??
        toStringOrNull(entry.title) ??
        deriveAssetLabelFromUrl(uri)
      assets.push({
        uri,
        label
      })
    }
  }

  normalized.brandAssets = assets
  return normalized
}

function normalizePostVisualInputFacet(value: unknown): PostVisualInputFacetAssetRecord[] {
  const entries: unknown[] = Array.isArray(value) ? value : []
  if (!entries.length) return []

  const normalized: PostVisualInputFacetAssetRecord[] = []
  const seen = new Set<string>()

  entries.forEach((entry, index) => {
    if (typeof entry === 'string') {
      const url = toStringOrNull(entry)
      if (!url) return
      const dedupeKey = url
      if (seen.has(dedupeKey)) return
      seen.add(dedupeKey)
      normalized.push({
        key: dedupeKey,
        assetId: null,
        url,
        ordering: index,
        name: deriveAssetLabelFromUrl(url),
        originalName: null,
        mimeType: null,
        meta: null
      })
      return
    }

    if (!isRecord(entry)) return
    const url = toStringOrNull(entry.url)
    if (!url) return
    const assetId =
      toStringOrNull(entry.assetId) ??
      toStringOrNull(entry.id) ??
      toStringOrNull(entry.asset_id)
    const dedupeKey = assetId ?? url
    if (seen.has(dedupeKey)) return
    seen.add(dedupeKey)

    const ordering =
      typeof entry.ordering === 'number'
        ? entry.ordering
        : toNumberOrNull(entry.ordering) ?? index
    const nameCandidate =
      toStringOrNull(entry.displayName) ??
      toStringOrNull(entry.display_name) ??
      toStringOrNull(entry.name) ??
      toStringOrNull(entry.label) ??
      toStringOrNull(entry.title) ??
      toStringOrNull(entry.originalName) ??
      toStringOrNull(entry.original_name) ??
      toStringOrNull(entry.filename)
    const mimeType =
      toStringOrNull(entry.mimeType) ??
      toStringOrNull(entry.contentType) ??
      toStringOrNull(entry.mime_type) ??
      toStringOrNull(entry.type)

    normalized.push({
      key: dedupeKey,
      assetId: assetId ?? null,
      url,
      ordering,
      name: nameCandidate ?? deriveAssetLabelFromUrl(url),
      originalName:
        toStringOrNull(entry.originalName) ??
        toStringOrNull(entry.original_name) ??
        nameCandidate ??
        null,
      mimeType: mimeType ?? null,
      meta: cloneIfObject(entry)
    })
  })

  if (!normalized.length) return []

  normalized.sort((a, b) => a.ordering - b.ordering)
  return normalized.map((asset, index) => ({
    ...asset,
    key: asset.assetId ?? `${asset.url}::${index}`,
    ordering: index
  }))
}

const INPUT_FACET_SANITIZERS = new Map<string, (value: unknown) => unknown>([
  ['company_information', normalizeCompanyInformationFacet],
  ['post_visual', normalizePostVisualInputFacet]
])

function sanitizeStatus(value: unknown): FlexAssignmentStatus {
  if (value === 'pending' || value === 'in_progress' || value === 'completed' || value === 'cancelled') {
    return value
  }
  if (value === 'submitted') return 'submitted'
  if (value === 'error') return 'error'
  return 'awaiting_submission'
}

function sanitizePriority(value: unknown): FlexTaskRecord['priority'] {
  const candidate = toStringOrNull(value)
  if (candidate === 'urgent' || candidate === 'high' || candidate === 'normal' || candidate === 'low') {
    return candidate
  }
  return null
}

function cloneIfObject<T>(value: T): T {
  if (!value || typeof value !== 'object') return value
  try {
    return JSON.parse(JSON.stringify(value)) as T
  } catch {
    return value
  }
}

function parseContracts(input: unknown): FlexPlanNodeContracts | null {
  if (!isRecord(input)) return null
  const output = input.output
  if (!output || typeof output !== 'object') return null
  const parsed: FlexPlanNodeContracts = {
    output: cloneIfObject(output)
  }
  if (input.input && typeof input.input === 'object') {
    parsed.input = cloneIfObject(input.input)
  }
  return parsed
}

function parseFacets(input: unknown): FlexPlanNodeFacets | null {
  if (!isRecord(input)) return null
  const inputFacets = toStringArrayOrNull(input.input)
  const outputFacets = toStringArrayOrNull(input.output)
  if (!inputFacets && !outputFacets) return null
  return {
    input: inputFacets ?? [],
    output: outputFacets ?? []
  }
}

function parseFacetProvenance(input: unknown): FlexFacetProvenanceMap | null {
  if (!isRecord(input)) return null
  const map: FlexFacetProvenanceMap = {}
  if (Array.isArray(input.input)) {
    map.input = input.input
      .filter((entry) => isRecord(entry))
      .map((entry) => cloneIfObject(entry))
  }
  if (Array.isArray(input.output)) {
    map.output = input.output
      .filter((entry) => isRecord(entry))
      .map((entry) => cloneIfObject(entry))
  }
  if (!map.input?.length && !map.output?.length) return null
  return map
}

function composeNodeKey(runId: string, nodeId: string): string {
  return `${runId}::${nodeId}`
}

const FLEX_BASE_URL =
  import.meta.env.VITE_FLEX_AGENTS_BASE_URL ||
  import.meta.env.VITE_AGENTS_BASE_URL ||
  'http://localhost:3003'

const FLEX_AUTH =
  import.meta.env.VITE_FLEX_AGENTS_AUTH_BEARER ||
  import.meta.env.VITE_AGENTS_AUTH_BEARER ||
  ''

export const useFlexTasksStore = defineStore('flexTasks', () => {
  const tasksById = ref<Map<string, FlexTaskRecord>>(new Map())
  const activeTaskId = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const lastSyncedAt = ref<string | null>(null)
  const nodeIndex = new Map<string, string>()

  const isActionableTask = (task: FlexTaskRecord | undefined | null): boolean => {
    if (!task) return false
    if (task.awaitingConfirmation) return false
    return task.status !== 'completed' && task.status !== 'cancelled'
  }

  const findNextActionableTaskId = (excludeId?: string | null): string | null => {
    for (const record of tasksById.value.values()) {
      if (excludeId && record.taskId === excludeId) continue
      if (isActionableTask(record)) {
        return record.taskId
      }
    }
    return null
  }

  const notifications = useNotificationsStore()
  const hitlStore = useHitlStore()

  const tasks = computed(() => {
    const entries = Array.from(tasksById.value.values())
    return entries.sort((a, b) => {
      // sort by priority (urgent > high > normal > low), then due date, then updatedAt desc
      const priorityOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 }
      const leftPriority = a.priority ? priorityOrder[a.priority] ?? 4 : 4
      const rightPriority = b.priority ? priorityOrder[b.priority] ?? 4 : 4
      if (leftPriority !== rightPriority) return leftPriority - rightPriority

      const leftDue = a.dueAt ?? ''
      const rightDue = b.dueAt ?? ''
      if (leftDue && rightDue && leftDue !== rightDue) return leftDue.localeCompare(rightDue)
      if (!leftDue && rightDue) return 1
      if (leftDue && !rightDue) return -1

      const leftUpdated = a.updatedAt ?? ''
      const rightUpdated = b.updatedAt ?? ''
      return rightUpdated.localeCompare(leftUpdated)
    })
  })

  const pendingTasks = computed(() =>
    tasks.value.filter((task) => isActionableTask(task))
  )

  const hasPendingTasks = computed(() => pendingTasks.value.length > 0)

  const activeTask = computed(() => {
    if (!activeTaskId.value) return null
    return tasksById.value.get(activeTaskId.value) ?? null
  })

  function setActiveTask(taskId: string | null) {
    if (taskId === null) {
      activeTaskId.value = null
      return
    }
    const record = tasksById.value.get(taskId)
    if (!record || !isActionableTask(record)) {
      activeTaskId.value = findNextActionableTaskId(taskId)
      return
    }
    activeTaskId.value = taskId
  }

  function updateTaskMap(mutator: (map: Map<string, FlexTaskRecord>) => void) {
    const next = new Map(tasksById.value)
    mutator(next)
    tasksById.value = next
    if (activeTaskId.value) {
      const current = next.get(activeTaskId.value)
      if (!current || !isActionableTask(current)) {
        activeTaskId.value = findNextActionableTaskId(activeTaskId.value)
      }
    }
    if (!activeTaskId.value) {
      activeTaskId.value = findNextActionableTaskId()
    }
  }

  function ensureNodeIndex(task: FlexTaskRecord) {
    nodeIndex.set(composeNodeKey(task.runId, task.nodeId), task.taskId)
  }

  function removeNodeIndex(task: FlexTaskRecord) {
    nodeIndex.delete(composeNodeKey(task.runId, task.nodeId))
  }

  function upsertTask(task: FlexTaskRecord) {
    updateTaskMap((map) => map.set(task.taskId, task))
    ensureNodeIndex(task)
    if (!activeTaskId.value && isActionableTask(task)) {
      activeTaskId.value = task.taskId
    }
  }

  function findTaskIdByNode(runId: string | undefined, nodeId: string | undefined): string | null {
    if (!runId || !nodeId) return null
    return nodeIndex.get(composeNodeKey(runId, nodeId)) ?? null
  }

  function removeTask(taskId: string) {
    const existing = tasksById.value.get(taskId)
    if (!existing) return
    updateTaskMap((map) => map.delete(taskId))
    removeNodeIndex(existing)
  }

  function sanitizeAssignment(input: Record<string, unknown>, fallback: { runId: string; nodeId: string }): FlexTaskRecord | null {
    const runId = toStringOrNull(input.runId) ?? fallback.runId
    const nodeId = toStringOrNull(input.nodeId) ?? fallback.nodeId
    if (!runId || !nodeId) return null

    const assignmentId = toStringOrNull(input.assignmentId) ?? `${runId}:${nodeId}`
    const status = sanitizeStatus(input.status)
    const assignedTo = toStringOrNull(input.assignedTo)
    const role = toStringOrNull(input.role)
    const dueAt = toStringOrNull(input.dueAt)
    const priority = sanitizePriority(input.priority)
    const instructions = toStringOrNull(input.instructions)
    const defaults = isRecord(input.defaults) ? cloneIfObject(input.defaults) : null
    const metadata = isRecord(input.metadata) ? cloneIfObject(input.metadata) : null
    const notifyChannels = toStringArrayOrNull(input.notifyChannels)
    const timeoutSeconds = toNumberOrNull(input.timeoutSeconds)
    const maxNotifications = toNumberOrNull(input.maxNotifications)
    const createdAt = toStringOrNull(input.createdAt)
    const updatedAt = toStringOrNull(input.updatedAt)

    const capabilityId = toStringOrNull(input.capabilityId)
    const label = toStringOrNull(input.label)

    return {
      taskId: assignmentId,
      assignmentId,
      runId,
      nodeId,
      capabilityId,
      label,
      status,
      assignedTo,
      role,
      dueAt,
      priority,
      instructions,
      defaults,
      metadata,
      notifyChannels,
      timeoutSeconds,
      maxNotifications,
      createdAt,
      updatedAt,
      startedAt: null,
      contracts: null,
      facets: null,
      facetProvenance: null,
      awaitingConfirmation: false,
      submissionState: 'idle',
      submissionError: null,
      declineState: 'idle',
      declineError: null,
      lastSubmittedPayload: null
    }
  }

  function handleNodeStart(event: FlexEventWithId) {
    if (!isRecord(event.payload)) return
    const executorType = toStringOrNull(event.payload.executorType)
    if (executorType !== 'human') return
    if (!isRecord(event.payload.assignment)) return

    const fallback = {
      runId: toStringOrNull(event.runId) ?? toStringOrNull(event.payload.runId) ?? '',
      nodeId: toStringOrNull(event.nodeId) ?? toStringOrNull(event.payload.nodeId) ?? ''
    }
    if (!fallback.runId || !fallback.nodeId) return

    const base = sanitizeAssignment(event.payload.assignment, fallback)
    if (!base) return

    const existing = tasksById.value.get(base.taskId)
    const merged: FlexTaskRecord = {
      ...base,
      startedAt: toStringOrNull(event.payload.startedAt) ?? event.timestamp ?? base.startedAt,
      contracts: parseContracts(event.payload.contracts) ?? existing?.contracts ?? null,
      facets: parseFacets(event.payload.facets) ?? existing?.facets ?? null,
      facetProvenance: event.facetProvenance ?? existing?.facetProvenance ?? parseFacetProvenance(
        (event.payload as Record<string, unknown>).facetProvenance
      ),
      awaitingConfirmation: existing?.awaitingConfirmation ?? false,
      submissionState: existing?.submissionState ?? 'idle',
      submissionError: existing?.submissionError ?? null,
      declineState: existing?.declineState ?? 'idle',
      declineError: existing?.declineError ?? null,
      lastSubmittedPayload: existing?.lastSubmittedPayload ?? null
    }

    upsertTask(merged)
    if (existing && existing.submissionState === 'success') {
      updateTaskMap((map) => {
        const current = map.get(base.taskId)
        if (!current) return
        map.set(base.taskId, {
          ...current,
          submissionState: 'idle',
          awaitingConfirmation: false,
          submissionError: null
        })
      })
    }
  }

  function handleNodeComplete(event: FlexEventWithId) {
    const taskId = findTaskIdByNode(event.runId, event.nodeId)
    if (!taskId) return
    const record = tasksById.value.get(taskId)
    const payload = event.payload
    const declineInfo =
      isRecord(payload) && isRecord((payload as Record<string, unknown>).decline)
        ? ((payload as Record<string, unknown>).decline as Record<string, unknown>)
        : null
    if (record) {
      if (declineInfo) {
        const reason =
          toStringOrNull(declineInfo.reason) ??
          toStringOrNull(event.message) ??
          'Declined by operator.'
        notifications.notifyError(
          record.label
            ? `Flex task "${record.label}" declined: ${reason}`
            : `Flex task declined: ${reason}`
        )
      } else {
        notifications.notifySuccess(
          record.label
            ? `Flex task "${record.label}" completed.`
            : 'Flex task completed.'
        )
      }
    }
    removeTask(taskId)
  }

  function handleNodeError(event: FlexEventWithId) {
    const taskId = findTaskIdByNode(event.runId, event.nodeId)
    if (!taskId) return
    updateTaskMap((map) => {
      const current = map.get(taskId)
      if (!current) return
      const message =
        toStringOrNull(event.message) ??
        (isRecord(event.payload) && isRecord(event.payload.error) && toStringOrNull(event.payload.error.message)) ??
        'Submission failed.'
      map.set(taskId, {
        ...current,
        status: 'awaiting_submission',
        submissionState: 'error',
        submissionError: message,
        awaitingConfirmation: false
      })
      notifications.notifyError(
        current.label
          ? `Flex task "${current.label}" failed: ${message}`
          : `Flex task failed: ${message}`
      )
    })
  }

  async function hydrateFromBacklog(options: HydrateOptions = {}) {
    if (loading.value) return
    loading.value = true
    error.value = null
    try {
      if (options.syncLegacyHitl !== false) {
        await hitlStore.hydrateFromPending({ force: true }).catch(() => undefined)
      }
      const url = new URL(`${FLEX_BASE_URL.replace(/\/+$/, '')}/api/v1/flex/tasks`)
      if (options.assignedTo && options.assignedTo.trim().length > 0) {
        url.searchParams.set('assignedTo', options.assignedTo.trim())
      }

      const headers: Record<string, string> = { accept: 'application/json' }
      if (FLEX_AUTH) headers.authorization = `Bearer ${FLEX_AUTH}`

      const res = await fetch(url.toString(), {
        method: 'GET',
        headers
      })

      if (!res.ok) {
        const body = await res.json().catch(() => null)
        const message =
          toStringOrNull(body?.error) ??
          toStringOrNull(body?.message) ??
          `Failed to load flex tasks (${res.status})`
        throw new Error(message ?? 'Failed to load flex tasks.')
      }

      const payload = await res.json().catch(() => null)
      const items = Array.isArray(payload?.tasks) ? payload.tasks : []

      const nextMap = new Map<string, FlexTaskRecord>()
      nodeIndex.clear()
      for (const item of items) {
        if (!isRecord(item)) continue
        const runId = toStringOrNull(item.runId)
        const nodeId = toStringOrNull(item.nodeId)
        if (!runId || !nodeId) continue
        const base = sanitizeAssignment(item, { runId, nodeId })
        if (!base) continue
        const existing = tasksById.value.get(base.taskId)
        const merged: FlexTaskRecord = {
          ...base,
          startedAt: existing?.startedAt ?? base.startedAt,
          contracts: existing?.contracts ?? parseContracts(item.contracts),
          facets: existing?.facets ?? parseFacets(item.facets),
          facetProvenance: existing?.facetProvenance ?? parseFacetProvenance(item.facetProvenance),
          awaitingConfirmation: existing?.awaitingConfirmation ?? false,
          submissionState: existing?.submissionState ?? 'idle',
          submissionError: existing?.submissionError ?? null,
          declineState: existing?.declineState ?? 'idle',
          declineError: existing?.declineError ?? null,
          lastSubmittedPayload: existing?.lastSubmittedPayload ?? null
        }
        nextMap.set(merged.taskId, merged)
        ensureNodeIndex(merged)
      }

      tasksById.value = nextMap
      if (activeTaskId.value && !nextMap.has(activeTaskId.value)) {
        activeTaskId.value = nextMap.size ? Array.from(nextMap.keys())[0] : null
      }
      lastSyncedAt.value = new Date().toISOString()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load flex tasks.'
      error.value = message
      notifications.notifyError(message)
      throw err
    } finally {
      loading.value = false
    }
  }

  function serializeOperator() {
    const profile = hitlStore.operatorProfile?.value ?? null
    if (!profile) return null
    const id = toStringOrNull(profile.id)
    const displayName = toStringOrNull(profile.displayName)
    const email = toStringOrNull(profile.email)
    if (!id && !displayName && !email) return null
    return {
      ...(id ? { id } : {}),
      ...(displayName ? { displayName } : {}),
      ...(email ? { email } : {})
    }
  }

  async function submitTask(taskId: string, input: FlexTaskSubmissionInput) {
    const task = tasksById.value.get(taskId)
    if (!task) throw new Error('Flex task not found.')

    updateTaskMap((map) => {
      const current = map.get(taskId)
      if (!current) return
      map.set(taskId, {
        ...current,
        submissionState: 'submitting',
        submissionError: null
      })
    })

    try {
      const body: Record<string, unknown> = {
        runId: task.runId,
        payload: {
          nodeId: task.nodeId,
          output: cloneIfObject(input.output),
          submittedAt: input.submittedAt ?? new Date().toISOString(),
          note: toStringOrUndefined(input.note)
        }
      }
      const operator = serializeOperator()
      if (operator) body.operator = operator
      if (typeof input.expectedPlanVersion === 'number') {
        body.expectedPlanVersion = input.expectedPlanVersion
      }
      if (input.correlationId) {
        body.correlationId = input.correlationId
      }

      const headers: Record<string, string> = {
        'content-type': 'application/json',
        accept: 'text/event-stream'
      }
      if (FLEX_AUTH) headers.authorization = `Bearer ${FLEX_AUTH}`

      updateTaskMap((map) => {
        const current = map.get(taskId)
        if (!current) return
        map.set(taskId, {
          ...current,
          status: 'submitted',
          submissionState: 'success',
          awaitingConfirmation: true,
          lastSubmittedPayload: cloneIfObject(input.output)
        })
      })
      notifications.notifySuccess('Flex task submitted. Waiting for orchestrator confirmation.')
      const stream = postFlexEventStream({
        url: `${FLEX_BASE_URL.replace(/\/+$/, '')}/api/v1/flex/run.resume`,
        body,
        headers,
        onEvent: (frame) => {
          handleStreamEvent(frame)
        },
        onCorrelationId: () => undefined,
        onBackoff: () => undefined,
        maxRetries: 0
      })
      await stream.done.catch(() => undefined)
      await hydrateFromBacklog({ syncLegacyHitl: false }).catch(() => undefined)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Submission failed.'
      updateTaskMap((map) => {
        const current = map.get(taskId)
        if (!current) return
        map.set(taskId, {
          ...current,
          submissionState: 'error',
          submissionError: message,
          awaitingConfirmation: false
        })
      })
      notifications.notifyError(message)
      throw err
    }
  }

  function handleStreamEvent(event: FlexEventWithId) {
    emitFlexEvent(event)
    switch (event.type) {
      case 'node_start':
        handleNodeStart(event)
        break
      case 'node_complete':
        handleNodeComplete(event)
        hitlStore.completeRequest()
        break
      case 'node_error':
        handleNodeError(event)
        break
      case 'plan_generated':
      case 'plan_updated':
      case 'log':
      case 'validation_error':
      case 'hitl_request':
      case 'hitl_resolved':
      case 'plan_rejected':
      case 'policy_triggered':
      case 'policy_update':
      case 'complete':
        hitlStore.resetAll()
        break
      case 'start':
      case 'plan_requested':
      default:
        break
    }
  }

  async function declineTask(taskId: string, input: FlexTaskDeclineInput) {
    const task = tasksById.value.get(taskId)
    if (!task) throw new Error('Flex task not found.')
    if (!input.reason || input.reason.trim().length === 0) {
      throw new Error('Decline reason is required.')
    }

    updateTaskMap((map) => {
      const current = map.get(taskId)
      if (!current) return
      map.set(taskId, {
        ...current,
        declineState: 'submitting',
        declineError: null,
        awaitingConfirmation: true
      })
    })

    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        accept: 'text/event-stream'
      }
      if (FLEX_AUTH) headers.authorization = `Bearer ${FLEX_AUTH}`

      const declineNote = toStringOrUndefined(input.note)
      const submittedAt = new Date().toISOString()
      const body: Record<string, unknown> = {
        runId: task.runId,
        payload: {
          nodeId: task.nodeId,
          decline: {
            reason: input.reason.trim(),
            note: declineNote ?? null
          },
          submittedAt
        }
      }
      const operator = serializeOperator()
      if (operator) body.operator = operator

      notifications.notifySuccess('Decline submitted. Waiting for orchestrator confirmation.')

      const stream = postFlexEventStream({
        url: `${FLEX_BASE_URL.replace(/\/+$/, '')}/api/v1/flex/run.resume`,
        body,
        headers,
        onEvent: (frame) => {
          handleStreamEvent(frame)
        },
        onCorrelationId: () => undefined,
        onBackoff: () => undefined,
        maxRetries: 0
      })

      await stream.done.catch(() => undefined)
      await hydrateFromBacklog({ syncLegacyHitl: false }).catch(() => undefined)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Decline failed.'
      updateTaskMap((map) => {
        const current = map.get(taskId)
        if (!current) return
        map.set(taskId, {
          ...current,
          declineState: 'error',
          declineError: message,
          awaitingConfirmation: false
        })
      })
      notifications.notifyError(message)
      throw err
    }
}

  async function uploadPostVisualAsset(taskId: string, file: File): Promise<PostVisualAssetRecord> {
    const task = tasksById.value.get(taskId)
    if (!task) throw new Error('Flex task not found.')
    const formData = new FormData()
    formData.append('file', file)
    formData.append('facet', 'post_visual')
    formData.append('assignmentId', task.assignmentId)
    formData.append('flexRunId', task.runId)
    formData.append('nodeId', task.nodeId)

    try {
      const res = await fetch('/api/flex/assets/upload', {
        method: 'POST',
        body: formData
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || !isRecord(body) || !isRecord(body.asset)) {
        const message =
          (isRecord(body) && (toStringOrNull(body.statusMessage) ?? toStringOrNull(body.error))) ||
          `Failed to upload asset (${res.status})`
        throw new Error(message ?? 'Failed to upload asset.')
      }

      const assetRecord = body.asset as Record<string, unknown>
      const assetId = toStringOrNull(assetRecord.id)
      const url = toStringOrNull(assetRecord.url)
      if (!assetId || !url) {
        throw new Error('Upload response missing asset metadata.')
      }

      const ordering =
        toNumberOrNull(assetRecord.ordering) ??
        (isRecord(assetRecord.meta) ? toNumberOrNull((assetRecord.meta as Record<string, unknown>).ordering) : null) ??
        0
      const originalName =
        toStringOrNull(assetRecord.originalName) ??
        (isRecord(assetRecord.meta) ? toStringOrNull((assetRecord.meta as Record<string, unknown>).originalName) : null) ??
        file.name
      const mimeType =
        toStringOrNull(assetRecord.mimeType) ??
        (isRecord(assetRecord.meta) ? toStringOrNull((assetRecord.meta as Record<string, unknown>).mimeType) : null) ??
        file.type ?? null

      return {
        assetId,
        url,
        ordering,
        originalName,
        mimeType
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Asset upload failed.'
      notifications.notifyError(message)
      throw err instanceof Error ? err : new Error(message)
    }
  }

  async function listFlexAssets(taskId: string, facet: string): Promise<PostVisualAssetRecord[]> {
    const task = tasksById.value.get(taskId)
    if (!task) throw new Error('Flex task not found.')
    const params = new URLSearchParams({ assignmentId: task.assignmentId })
    if (facet?.trim().length) {
      params.set('facet', facet.trim())
    }
    try {
      const res = await fetch(`/api/flex/assets?${params.toString()}`, {
        method: 'GET',
        headers: { accept: 'application/json' }
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || !isRecord(body)) {
        const message =
          (isRecord(body) && (toStringOrNull(body.statusMessage) ?? toStringOrNull(body.error))) ??
          `Failed to load flex assets (${res.status})`
        throw new Error(message ?? 'Failed to load flex assets.')
      }
      const items = Array.isArray(body.assets) ? body.assets : []
      const results: PostVisualAssetRecord[] = []
      for (const entry of items) {
        if (!isRecord(entry)) continue
        const id = toStringOrNull(entry.id)
        const url = toStringOrNull(entry.url)
        if (!id || !url) continue
        results.push({
          assetId: id,
          url,
          ordering: toNumberOrNull(entry.ordering) ?? results.length,
          originalName: toStringOrNull(entry.originalName),
          mimeType: toStringOrNull(entry.mimeType)
        })
      }
      return results
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load flex assets.'
      notifications.notifyError(message)
      throw err instanceof Error ? err : new Error(message)
    }
  }

  async function updatePostVisualAssetOrdering(
    taskId: string,
    updates: Array<{ assetId: string | null | undefined; ordering: number }>
  ): Promise<void> {
    const task = tasksById.value.get(taskId)
    if (!task) throw new Error('Flex task not found.')
    const valid = updates.filter(
      (entry) => typeof entry.assetId === 'string' && entry.assetId.trim().length > 0
    ) as Array<{ assetId: string; ordering: number }>
    if (!valid.length) return

    try {
      await Promise.all(
        valid.map(async (entry) => {
          const res = await fetch(`/api/flex/assets/${encodeURIComponent(entry.assetId)}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              ordering: entry.ordering,
              metaOverrides: {
                flexRunId: task.runId,
                nodeId: task.nodeId,
                assignmentId: task.assignmentId,
                facet: 'post_visual'
              }
            })
          })
          if (res.ok) return
          let errorBody: unknown = null
          try {
            errorBody = await res.json()
          } catch {
            errorBody = await res.text().catch(() => null)
          }
          const message =
            isRecord(errorBody) && (toStringOrNull(errorBody.statusMessage) ?? toStringOrNull(errorBody.error))
              ? toStringOrNull(errorBody.statusMessage) ?? toStringOrNull(errorBody.error)
              : `Failed to update asset ordering (${res.status})`
          throw new Error(message ?? 'Failed to update asset ordering.')
        })
      )
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update asset ordering.'
      notifications.notifyError(message)
      throw err instanceof Error ? err : new Error(message)
    }
  }

  async function deletePostVisualAsset(taskId: string, assetId: string): Promise<void> {
    const task = tasksById.value.get(taskId)
    if (!task) throw new Error('Flex task not found.')
    const trimmed = assetId.trim()
    if (!trimmed) return
    try {
      const res = await fetch(`/api/flex/assets/${encodeURIComponent(trimmed)}`, {
        method: 'DELETE'
      })
      if (res.ok || res.status === 404) return
      let errorBody: unknown = null
      try {
        errorBody = await res.json()
      } catch {
        errorBody = await res.text().catch(() => null)
      }
      const message =
        isRecord(errorBody) && (toStringOrNull(errorBody.statusMessage) ?? toStringOrNull(errorBody.error))
          ? toStringOrNull(errorBody.statusMessage) ?? toStringOrNull(errorBody.error)
          : `Failed to remove asset (${res.status})`
      throw new Error(message ?? 'Failed to remove asset.')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to remove asset.'
      notifications.notifyError(message)
      throw err instanceof Error ? err : new Error(message)
    }
  }

  function clearAll() {
    tasksById.value = new Map()
    nodeIndex.clear()
    activeTaskId.value = null
    error.value = null
  }

  function normalizeInputFacetValue(facetName: string, value: unknown): unknown {
    const sanitizer = INPUT_FACET_SANITIZERS.get(facetName)
    if (!sanitizer) {
      return value
    }
    return sanitizer(value)
  }

  return {
    tasks,
    pendingTasks,
    hasPendingTasks,
    activeTask,
    activeTaskId,
    loading,
    error,
    lastSyncedAt,
    setActiveTask,
    handleNodeStart,
    handleNodeComplete,
    handleNodeError,
    hydrateFromBacklog,
    submitTask,
    declineTask,
    uploadPostVisualAsset,
    listFlexAssets,
    updatePostVisualAssetOrdering,
    deletePostVisualAsset,
    clearAll,
    normalizeInputFacetValue
  }
})
