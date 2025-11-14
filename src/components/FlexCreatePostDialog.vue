<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import type { TaskEnvelope, HitlRequestPayload, TaskPolicies, HitlContractSummary } from '@awesomeposter/shared'
import { parseTaskPolicies, HitlContractSummarySchema } from '@awesomeposter/shared'
import { postFlexEventStream, type FlexEventWithId } from '@/lib/flex-sse'
import FlexTaskPanel from '@/components/flex-tasks/FlexTaskPanel.vue'
import HitlPromptPanel from './HitlPromptPanel.vue'
import { useHitlStore } from '@/stores/hitl'
import { useFlexTasksStore } from '@/stores/flexTasks'

type BriefInput = {
  id: string
  clientId: string
  title: string | null
  objective?: string | null
  audienceId?: string | null
  description?: string | null
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

watch(
  () => isOpen.value,
  (open) => {
    if (open) {
      void flexTasksStore.hydrateFromBacklog({ syncLegacyHitl: false })
    }
  }
)

const FLEX_BASE_URL =
  import.meta.env.VITE_FLEX_AGENTS_BASE_URL ||
  import.meta.env.VITE_AGENTS_BASE_URL ||
  'http://localhost:3003'
const FLEX_AUTH =
  import.meta.env.VITE_FLEX_AGENTS_AUTH_BEARER ||
  import.meta.env.VITE_AGENTS_AUTH_BEARER ||
  undefined
const FLEX_REQUIRE_HITL = (import.meta.env.VITE_FLEX_REQUIRE_HITL || 'false').toString().toLowerCase() === 'true'

const running = ref(false)
const frames = ref<FlexEventWithId[]>([])
const plan = ref<{ nodes: Array<{ id: string; capabilityId: string; label?: string | null }> } | null>(null)
const output = ref<Record<string, unknown> | null>(null)
const status = ref<'idle' | 'running' | 'completed' | 'awaiting_hitl' | 'error'>('idle')
const errorMsg = ref<string | null>(null)
const correlationId = ref<string | undefined>()
const runId = ref<string | null>(null)

const hitlStore = useHitlStore()
const { pendingRun, hasActiveRequest } = storeToRefs(hitlStore)

const flexTasksStore = useFlexTasksStore()
const { hasPendingTasks: hasFlexTasks, loading: flexTasksLoading } = storeToRefs(flexTasksStore)

type EnvelopeContext = {
  profile: Record<string, unknown> | null
  brief: Record<string, unknown> | null
  assets: Array<Record<string, unknown>>
}

type HitlRequestEventPayload = {
  request?: {
    id: string
    originAgent: 'strategy' | 'generation' | 'qa'
    payload: HitlRequestPayload
    createdAt?: string
    pendingNodeId?: string | null
    operatorPrompt?: string | null
    contractSummary?: HitlContractSummary | null
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const toStringOrUndefined = (value: unknown): string | undefined => (typeof value === 'string' && value.trim().length > 0 ? value : undefined)

const stringOrFallback = (record: Record<string, unknown>, key: string, fallback: string): string => {
  const candidate = record[key]
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate : fallback
}

const normalizePolicies = (override?: TaskEnvelope['policies']): TaskPolicies | null => {
  if (!override) return null
  try {
    return parseTaskPolicies(override)
  } catch (error) {
    console.warn('Failed to parse overriding policies; falling back to defaults', error)
    return null
  }
}

const mergeTaskPolicies = (base: TaskPolicies, override: TaskPolicies | null): TaskPolicies => {
  if (!override) return base

  const mergedTopologySource = {
    ...(base.planner?.topology ?? {}),
    ...(override.planner?.topology ?? {})
  }
  const mergedSelectionSource = {
    ...(base.planner?.selection ?? {}),
    ...(override.planner?.selection ?? {})
  }
  const mergedOptimisationSource = {
    ...(base.planner?.optimisation ?? {}),
    ...(override.planner?.optimisation ?? {})
  }
  const mergedDirectivesSource = {
    ...(base.planner?.directives ?? {}),
    ...(override.planner?.directives ?? {})
  }

  const mergedTopology =
    Object.keys(mergedTopologySource).length > 0 ? mergedTopologySource : undefined
  const mergedSelection =
    Object.keys(mergedSelectionSource).length > 0 ? mergedSelectionSource : undefined
  const mergedOptimisation =
    Object.keys(mergedOptimisationSource).length > 0 ? mergedOptimisationSource : undefined
  const mergedDirectives =
    Object.keys(mergedDirectivesSource).length > 0 ? mergedDirectivesSource : undefined

  const plannerEmpty = !mergedTopology && !mergedSelection && !mergedOptimisation && !mergedDirectives

  const merged: TaskPolicies = {
    planner: plannerEmpty
      ? undefined
      : {
          ...(mergedTopology ? { topology: mergedTopology } : {}),
          ...(mergedSelection ? { selection: mergedSelection } : {}),
          ...(mergedOptimisation ? { optimisation: mergedOptimisation } : {}),
          ...(mergedDirectives ? { directives: mergedDirectives } : {})
        },
    runtime: override.runtime.length ? override.runtime : base.runtime
  }

  return parseTaskPolicies(merged)
}

const isHitlOriginAgent = (value: string | undefined): value is 'strategy' | 'generation' | 'qa' =>
  value === 'strategy' || value === 'generation' || value === 'qa'

const isHitlKind = (value: string | undefined): value is HitlRequestPayload['kind'] =>
  value === 'approval' || value === 'clarify'

const isHitlUrgency = (value: string | undefined): value is HitlRequestPayload['urgency'] =>
  value === 'low' || value === 'normal' || value === 'high'

let streamHandle: { abort: () => void; done: Promise<void> } | null = null

watch(isOpen, async (open) => {
  if (open) {
    await startRun()
  } else {
    stopRun()
  }
})

onBeforeUnmount(() => stopRun())

const showHitlPanel = computed(() => {
  if (hasActiveRequest.value) return true
  return Boolean(pendingRun.value.pendingRequestId)
})

async function startRun(options?: { threadId?: string | null; runId?: string | null; overrides?: Partial<TaskEnvelope> }) {
  const resumeThreadId = options?.threadId ?? pendingRun.value.threadId ?? null
  reset()
  if (!props.brief?.id || !props.brief.clientId) {
    errorMsg.value = 'Brief context missing'
    return
  }

  running.value = true
  status.value = 'running'

  try {
    const threadId = resumeThreadId ?? props.brief.id ?? null
    if (threadId) {
      hitlStore.setThreadId(threadId)
    }
    if (props.brief?.id) {
      hitlStore.setBriefId(props.brief.id)
    }
    const context = await loadContext(props.brief.id, props.brief.clientId)
    const envelope = buildEnvelope(context, threadId, options?.runId ?? null, options?.overrides)
    const headers: Record<string, string> = {}
    if (FLEX_AUTH) headers.authorization = `Bearer ${FLEX_AUTH}`

    streamHandle = postFlexEventStream({
      url: `${FLEX_BASE_URL}/api/v1/flex/run.stream`,
      body: envelope,
      headers,
      onCorrelationId: (cid) => {
        correlationId.value = cid
      },
      onEvent: handleEvent
    })
    await streamHandle.done
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : 'Failed to start flex run'
    status.value = 'error'
  }
}

function stopRun() {
  running.value = false
  try {
    streamHandle?.abort()
  } catch {}
  streamHandle = null
}

async function handleHitlResume() {
  if (running.value) return
  try {
    const resumeThread = pendingRun.value.threadId || runId.value || props.brief?.id || null
    const resumeRunId = pendingRun.value.runId || runId.value || null
    await startRun({ threadId: resumeThread, runId: resumeRunId })
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : 'Failed to resume flex run'
  }
}

function reset() {
  frames.value = []
  plan.value = null
  output.value = null
  status.value = 'idle'
  errorMsg.value = null
  correlationId.value = undefined
  runId.value = null
  hitlStore.resetAll()
}

async function loadContext(briefId: string, clientId: string) {
  const [profile, brief, assets] = await Promise.all([
    fetchJson(`/api/clients/${clientId}/profile`),
    fetchJson(`/api/briefs/${briefId}`),
    fetchJson(`/api/briefs/${briefId}/assets`, { fallback: [] })
  ])

  const profileRecord = isRecord(profile?.profile) ? (profile!.profile as Record<string, unknown>) : null
  const briefRecord = isRecord(brief?.brief) ? (brief!.brief as Record<string, unknown>) : null
  const assetsArray = Array.isArray(assets?.assets) ? (assets!.assets as unknown[]) : []
  const normalizedAssets = assetsArray.filter((asset: unknown): asset is Record<string, unknown> => isRecord(asset))

  return {
    profile: profileRecord,
    brief: briefRecord,
    assets: normalizedAssets
  }
}

async function fetchJson(url: string, opts?: { fallback?: unknown }) {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) {
    if (opts?.fallback !== undefined) return { assets: opts.fallback }
    throw new Error(`Request failed: ${res.status}`)
  }
  return res.json().catch(() => opts?.fallback ?? null)
}

function buildEnvelope(
  context: EnvelopeContext,
  threadId?: string | null,
  runId?: string | null,
  overrides?: Partial<TaskEnvelope>
): TaskEnvelope {
  const briefRecord: Record<string, unknown> = context.brief ?? {}
  const profileRecord: Record<string, unknown> = context.profile ?? {}
  const briefInput = props.brief ?? null
  const briefInputClientId = toStringOrUndefined(briefInput?.clientId ?? undefined)
  const briefInputId = toStringOrUndefined(briefInput?.id ?? undefined)
  const briefInputTitle = toStringOrUndefined(briefInput?.title ?? undefined)
  const objective = toStringOrUndefined(briefRecord.objective) || toStringOrUndefined(props.brief?.objective) || ''
  const description = toStringOrUndefined(briefRecord.description) || toStringOrUndefined(props.brief?.description)
  const completeObjective = objective || description
  const overrideInputs = (overrides?.inputs as Record<string, unknown> | undefined) ?? {}
  const overridePolicies = normalizePolicies(overrides?.policies)
  const baseConstraints: Record<string, unknown> = {}
  if (overrides?.constraints && typeof overrides.constraints === 'object' && !Array.isArray(overrides.constraints)) {
    Object.entries(overrides.constraints as Record<string, unknown>).forEach(([key, value]) => {
      baseConstraints[key] = value
    })
  }
  if (typeof threadId === 'string' && threadId.length > 0) baseConstraints.threadId = threadId
  if (typeof runId === 'string' && runId.length > 0) baseConstraints.resumeRunId = runId
  if (typeof briefInputId === 'string' && briefInputId.length > 0) baseConstraints.briefId = briefInputId
  const defaultSpecialInstructions = [
    'Variant A should highlight team culture.',
    'Variant B should highlight career growth opportunities.'
  ]
  const specialInstructions = (
    Array.isArray(overrides?.specialInstructions)
      ? overrides!.specialInstructions!.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : defaultSpecialInstructions
  )
  const normalizedSpecialInstructions = specialInstructions.length > 0 ? specialInstructions.slice() : defaultSpecialInstructions.slice()
  const defaultOutputContract = {
    mode: 'json_schema' as const,
    schema: {
      type: 'object',
      required: ['variants'],
      properties: {
        variants: {
          type: 'array',
          minItems: 2,
          maxItems: 2,
          items: {
            type: 'object',
            required: ['headline', 'body', 'callToAction'],
            properties: {
              headline: { type: 'string', minLength: 5 },
              body: { type: 'string', minLength: 20 },
              callToAction: { type: 'string' },
              tone: { type: 'string' }
            }
          }
        }
      }
    }
  }
  const outputContract = overrides?.outputContract ?? defaultOutputContract
const metadata: { clientId?: string; brandId?: string; campaignId?: string; correlationId?: string; runLabel?: string } = {}
  if (typeof briefInputClientId === 'string' && briefInputClientId.length > 0) {
    metadata.clientId = briefInputClientId
  }
  if (typeof briefInputTitle === 'string' && briefInputTitle.length > 0) {
    metadata.runLabel = briefInputTitle
  }
  if (typeof correlationId.value === 'string' && correlationId.value.length > 0) {
    metadata.correlationId = correlationId.value
  }
  const metadataOverrides = overrides?.metadata
  if (metadataOverrides) {
    if (typeof metadataOverrides.clientId === 'string' && metadataOverrides.clientId.length > 0) metadata.clientId = metadataOverrides.clientId
    if (typeof metadataOverrides.brandId === 'string' && metadataOverrides.brandId.length > 0) metadata.brandId = metadataOverrides.brandId
    if (typeof metadataOverrides.campaignId === 'string' && metadataOverrides.campaignId.length > 0) metadata.campaignId = metadataOverrides.campaignId
    if (typeof metadataOverrides.correlationId === 'string' && metadataOverrides.correlationId.length > 0) metadata.correlationId = metadataOverrides.correlationId
    if (typeof metadataOverrides.runLabel === 'string' && metadataOverrides.runLabel.length > 0) metadata.runLabel = metadataOverrides.runLabel
  }

  return {
    objective: completeObjective || 'Create LinkedIn post variants.',
    inputs: {
      channel: 'linkedin',
      audience: 'developer_experience',
      goal: 'attract_new_employees',
      variantCount: 2,
      contextBundles: [
        {
          type: 'company_profile',
          payload: {
            companyName: stringOrFallback(profileRecord, 'clientName', 'AwesomePoster'),
            coreValue: stringOrFallback(profileRecord, 'coreValue', 'Human-first automation'),
            recentEvent: stringOrFallback(profileRecord, 'recentEvent', 'Team retreat')
          }
        }
      ],
      brief: briefRecord,
      assets: context.assets,
      ...overrideInputs
    },
    policies: mergeTaskPolicies(
      {
        planner: {
          directives: {
            brandVoice: 'inspiring',
            requiresHitlApproval: FLEX_REQUIRE_HITL
          },
          optimisation: {
            maxTokens: 120
          }
        },
        runtime: []
      },
      overridePolicies
    ),
    specialInstructions: normalizedSpecialInstructions,
    metadata,
    constraints: baseConstraints,
    outputContract
  }
}

const parseHitlRequestPayload = (payload: unknown): HitlRequestEventPayload | null => {
  if (!isRecord(payload)) return null
  const requestValue = payload.request
  if (!isRecord(requestValue)) return null

  const id = toStringOrUndefined(requestValue.id)
  const originAgentRaw = toStringOrUndefined(requestValue.originAgent)
  if (!id || !originAgentRaw) return null
  const originAgent = isHitlOriginAgent(originAgentRaw) ? originAgentRaw : 'strategy'

  const payloadData = requestValue.payload
  if (!isRecord(payloadData)) return null

  const question = toStringOrUndefined(payloadData.question) || 'Operator assistance required.'
  const kindRaw = toStringOrUndefined(payloadData.kind) || 'clarify'
  const kind = isHitlKind(kindRaw) ? kindRaw : 'clarify'

  const allowFreeForm = typeof payloadData.allowFreeForm === 'boolean'
    ? payloadData.allowFreeForm
    : typeof payloadData.allow_free_form === 'boolean'
    ? payloadData.allow_free_form
    : kind === 'clarify'

  const urgencyRaw = toStringOrUndefined(payloadData.urgency) || 'normal'
  const urgency = isHitlUrgency(urgencyRaw) ? urgencyRaw : 'normal'

  const additionalContext = toStringOrUndefined(payloadData.additionalContext)
    || toStringOrUndefined((payloadData as Record<string, unknown>).context)

  const parsedPayload: HitlRequestPayload = {
    question,
    kind,
    allowFreeForm,
    urgency,
    ...(additionalContext ? { additionalContext } : {})
  }

  const pendingNodeId = toStringOrUndefined(requestValue.pendingNodeId) ?? null
  const operatorPrompt = toStringOrUndefined(requestValue.operatorPrompt) ?? null
  let contractSummary: HitlContractSummary | null = null
  if (requestValue.contractSummary) {
    const summaryResult = HitlContractSummarySchema.safeParse(requestValue.contractSummary)
    if (summaryResult.success) {
      contractSummary = summaryResult.data
    }
  }

  return {
    request: {
      id,
      originAgent,
      payload: parsedPayload,
      createdAt: toStringOrUndefined(requestValue.createdAt),
      pendingNodeId,
      operatorPrompt,
      contractSummary
    }
  }
}

function handleEvent(evt: FlexEventWithId) {
  frames.value.push(evt)
  if (typeof evt.runId === 'string' && evt.runId.length > 0) {
    runId.value = evt.runId
    hitlStore.setRunId(evt.runId)
  }
  switch (evt.type) {
    case 'start': {
      const data = evt.payload as Record<string, unknown> | undefined
      const startedRunId = typeof data?.runId === 'string' ? data.runId : runId.value
      if (startedRunId) {
        runId.value = startedRunId
        hitlStore.setRunId(startedRunId)
      }
      const thread = typeof data?.threadId === 'string' ? data.threadId : props.brief?.id ?? null
      if (thread) {
        hitlStore.setThreadId(thread)
      }
      if (props.brief?.id) {
        hitlStore.setBriefId(props.brief.id)
      }
      void hitlStore.hydrateFromPending({ threadId: thread, briefId: props.brief?.id ?? null, force: false })
      void flexTasksStore.hydrateFromBacklog({ syncLegacyHitl: false })
      status.value = 'running'
      break
    }
    case 'plan_generated': {
      const payload = evt.payload
      if (isRecord(payload) && 'plan' in payload && isRecord(payload.plan)) {
        const planRecord = payload.plan as Record<string, unknown>
        const nodesRaw = Array.isArray(planRecord.nodes) ? planRecord.nodes : []
        const normalizedNodes = nodesRaw
          .filter((node): node is Record<string, unknown> => isRecord(node))
          .filter((node) => typeof node.id === 'string' && typeof node.capabilityId === 'string')
          .map((node) => ({
            id: node.id as string,
            capabilityId: node.capabilityId as string,
            label: typeof node.label === 'string' ? (node.label as string) : null
          }))
        plan.value = { nodes: normalizedNodes }
      }
      break
    }
    case 'node_start': {
      flexTasksStore.handleNodeStart(evt)
      break
    }
    case 'node_complete': {
      flexTasksStore.handleNodeComplete(evt)
      break
    }
    case 'node_error': {
      flexTasksStore.handleNodeError(evt)
      break
    }
    case 'validation_error': {
      const payload = evt.payload as Record<string, unknown> | undefined
      const errors = Array.isArray(payload?.errors) ? (payload!.errors as Array<Record<string, unknown>>) : []
      const scope = typeof payload?.scope === 'string' ? payload.scope : 'output'
      const first = errors.find((entry) => typeof entry?.message === 'string')
      errorMsg.value = first?.message
        ? `Validation failed: ${first.message}`
        : `Validation failed for ${scope.replace(/_/g, ' ')}`
      status.value = 'error'
      running.value = false
      break
    }
    case 'hitl_request': {
      status.value = 'awaiting_hitl'
      running.value = false
      const hitlPayload = parseHitlRequestPayload(evt.payload)
      const request = hitlPayload?.request
      if (request) {
        const threadForRequest = pendingRun.value.threadId ?? props.brief?.id ?? null
        hitlStore.startTrackingRequest({
          requestId: request.id,
          payload: request.payload,
          originAgent: request.originAgent,
          receivedAt: request.createdAt ? new Date(request.createdAt) : new Date(),
          threadId: threadForRequest,
          pendingNodeId: request.pendingNodeId ?? null,
          operatorPrompt: request.operatorPrompt ?? null,
          contractSummary: request.contractSummary ?? null
        })
        hitlStore.markAwaiting(request.id)
      }
      break
    }
    case 'complete': {
      const payload = evt.payload as Record<string, unknown> | undefined
      if (payload && typeof payload.output === 'object') {
        output.value = payload.output as Record<string, unknown>
      }
      status.value = 'completed'
      running.value = false
      hitlStore.resetAll()
      break
    }
  }
}

const variantList = computed(() => {
  const variants = (output.value as { variants?: Array<Record<string, string>> } | null)?.variants
  if (!Array.isArray(variants)) return []
  return variants
})

const statusLabel = computed(() => {
  switch (status.value) {
    case 'running':
      return 'Planner running…'
    case 'completed':
      return 'Completed'
    case 'awaiting_hitl':
      return 'Awaiting human approval'
    case 'error':
      return 'Failed'
    default:
      return 'Idle'
  }
})

function close() {
  isOpen.value = false
  hitlStore.resetAll()
}
</script>

<template>
  <v-dialog v-model="isOpen" max-width="960">
    <v-card>
      <v-card-title class="d-flex align-center justify-space-between">
        <span>Create Post (Flex)</span>
        <v-chip size="small" :color="status === 'completed' ? 'success' : status === 'error' ? 'error' : status === 'awaiting_hitl' ? 'warning' : 'primary'">
          {{ statusLabel }}
        </v-chip>
      </v-card-title>
      <v-card-text>
        <v-alert v-if="errorMsg" type="error" class="mb-4" :text="errorMsg" />
        <v-alert v-else-if="status === 'awaiting_hitl'" type="warning" class="mb-4" text="Run awaiting operator approval." />

        <div v-if="plan" class="mb-6">
          <h3 class="text-subtitle-1 mb-3">Plan</h3>
          <v-timeline side="end" density="compact">
            <v-timeline-item
              v-for="node in plan.nodes"
              :key="node.id"
              dot-color="primary"
            >
              <strong>{{ node.label || node.capabilityId }}</strong>
              <div class="text-caption text-medium-emphasis">{{ node.capabilityId }}</div>
            </v-timeline-item>
          </v-timeline>
        </div>

        <div v-if="variantList.length" class="mb-6">
          <h3 class="text-subtitle-1 mb-3">Generated Variants</h3>
          <v-row>
            <v-col v-for="(variant, idx) in variantList" :key="idx" cols="12" md="6">
              <v-card variant="outlined">
                <v-card-title class="text-subtitle-2">Variant {{ idx + 1 }}</v-card-title>
                <v-card-text>
                  <div class="text-body-2 font-weight-medium mb-2">{{ variant.headline }}</div>
                  <div class="text-body-2 mb-3">{{ variant.body }}</div>
                  <div class="text-caption text-medium-emphasis">CTA: {{ variant.callToAction }}</div>
                </v-card-text>
              </v-card>
            </v-col>
          </v-row>
        </div>

        <FlexTaskPanel
          v-if="hasFlexTasks || flexTasksLoading"
          class="mb-6"
        />

        <HitlPromptPanel v-if="showHitlPanel" class="mb-6" @resume="handleHitlResume" />

        <div>
          <h3 class="text-subtitle-1 mb-3">Event Stream</h3>
          <v-list density="compact" class="flex-log">
            <v-list-item
              v-for="frame in frames"
              :key="frame.id || `${frame.type}-${frame.timestamp}`"
              :title="frame.type"
              :subtitle="frame.message || JSON.stringify(frame.payload || {}, null, 2)"
            />
          </v-list>
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="tonal" color="primary" :loading="running" @click="startRun">
          Rerun
        </v-btn>
        <v-btn variant="text" @click="close">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.flex-log {
  max-height: 220px;
  overflow-y: auto;
}
</style>
