<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  deriveDuplicateKey,
  normalizeDiscoverySourceUrl,
  type DiscoverySourceType,
  type DiscoverySourceCreatedEvent,
  type DiscoveryTelemetryEvent,
  type SourceHealthEvent,
  type DiscoveryIngestionFailureReason,
} from '@awesomeposter/shared'
import { subscribeToDiscoveryEvents, type DiscoveryFeatureDisabledPayload } from '@/lib/discovery-sse'
import { useNotificationsStore } from '@/stores/notifications'

const props = defineProps<{
  clientId: string
  mode?: 'embedded' | 'standalone'
  disabled?: boolean
}>()

const mode = computed(() => props.mode ?? 'embedded')

const loading = ref(false)
const submitLoading = ref(false)
const error = ref<string | null>(null)
const form = reactive({
  url: '',
  notes: '',
})
const fieldErrors = reactive<{ url?: string; notes?: string }>({})
const detectionSummary = ref<{ sourceType: DiscoverySourceType; canonicalUrl: string } | null>(null)
const duplicateWarning = ref<string | null>(null)
const notifications = useNotificationsStore()

const featureDisabled = ref(false)
const featureDisabledMessage = ref('Discovery agent is disabled for this client.')
const disabled = computed(() => Boolean(props.disabled) || featureDisabled.value)
const disabledBannerMessage = computed(() => {
  if (props.disabled) return 'Discovery agent is disabled for this client.'
  return featureDisabled.value ? featureDisabledMessage.value : null
})

type SourceHealthStatus = 'healthy' | 'warning' | 'error'

type SourceHealthState = {
  status: SourceHealthStatus
  observedAt: string
  lastFetchedAt: string | null
  failureReason?: DiscoveryIngestionFailureReason | null
  consecutiveFailures: number
  staleSince?: string | null
}

type SourceHealthTelemetryEvent = Extract<DiscoveryTelemetryEvent, { eventType: 'source.health' }>

type SourceItem = {
  id: string
  clientId: string
  url: string
  canonicalUrl: string
  sourceType: DiscoverySourceType
  identifier: string
  notes: string | null
  createdAt: string
  updatedAt: string
  lastFetchStatus: 'idle' | 'running' | 'success' | 'failure'
  lastFetchCompletedAt: string | null
  lastFailureReason: DiscoveryIngestionFailureReason | null
  lastSuccessAt: string | null
  consecutiveFailureCount: number
  health: SourceHealthState
  pending?: boolean
  pendingKey?: string
}

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000

const failureReasonMessages: Record<DiscoveryIngestionFailureReason, string> = {
  network_error: 'Network error',
  http_4xx: 'HTTP 4xx response',
  http_5xx: 'HTTP 5xx response',
  youtube_quota: 'YouTube quota exceeded',
  youtube_not_found: 'YouTube resource not found',
  timeout: 'Timed out',
  parser_error: 'Feed parser error',
  unknown_error: 'Unknown error',
}

function formatFailureReason(reason?: DiscoveryIngestionFailureReason | null) {
  if (!reason) return null
  return failureReasonMessages[reason] ?? reason
}

function createDefaultHealth(observedAt = new Date().toISOString()): SourceHealthState {
  return {
    status: 'healthy',
    observedAt,
    lastFetchedAt: null,
    consecutiveFailures: 0,
  }
}

const HEALTH_STATUSES: readonly SourceHealthStatus[] = ['healthy', 'warning', 'error']

function isValidHealthStatus(value: unknown): value is SourceHealthStatus {
  return typeof value === 'string' && (HEALTH_STATUSES as readonly string[]).includes(value)
}

function parseHealthState(raw: unknown, fallbackObservedAt: string): SourceHealthState {
  const base = createDefaultHealth(fallbackObservedAt)
  if (!raw || typeof raw !== 'object') {
    return base
  }

  const data = raw as Record<string, unknown>
  const status = isValidHealthStatus(data.status) ? (data.status as SourceHealthStatus) : base.status
  const observedAt = typeof data.observedAt === 'string' ? data.observedAt : base.observedAt
  const lastFetchedAt = typeof data.lastFetchedAt === 'string'
    ? data.lastFetchedAt
    : data.lastFetchedAt === null
      ? null
      : base.lastFetchedAt
  const consecutiveFailures = typeof data.consecutiveFailures === 'number' && Number.isFinite(data.consecutiveFailures)
    ? data.consecutiveFailures
    : base.consecutiveFailures
  const failureReason = typeof data.failureReason === 'string'
    ? (data.failureReason as DiscoveryIngestionFailureReason)
    : undefined
  const staleSince = typeof data.staleSince === 'string'
    ? data.staleSince
    : undefined

  return {
    status,
    observedAt,
    lastFetchedAt,
    consecutiveFailures,
    failureReason,
    staleSince: staleSince ?? undefined,
  }
}

function coerceIsoString(value: unknown): string | null {
  if (typeof value === 'string' && value) {
    return value
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  return null
}

function coerceNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return fallback
}

function coerceFailureReason(value: unknown): DiscoveryIngestionFailureReason | null {
  if (typeof value === 'string' && value in failureReasonMessages) {
    return value as DiscoveryIngestionFailureReason
  }
  return null
}

const sources = ref<SourceItem[]>([])
let unsubscribeFromSse: (() => void) | null = null

watch(
  () => form.url,
  (value) => {
    if (!value.trim()) {
      detectionSummary.value = null
      duplicateWarning.value = null
      fieldErrors.url = undefined
      return
    }
    try {
      const normalized = normalizeDiscoverySourceUrl(value)
      detectionSummary.value = {
        sourceType: normalized.sourceType,
        canonicalUrl: normalized.canonicalUrl,
      }
      const dupKey = deriveDuplicateKey(normalized)
      duplicateWarning.value = duplicateKeySet.value.has(dupKey)
        ? 'This source already exists for the client.'
        : null
      fieldErrors.url = undefined
    } catch (err) {
      detectionSummary.value = null
      duplicateWarning.value = null
      fieldErrors.url = err instanceof Error ? err.message : 'Enter a valid URL'
    }
  },
)

watch(
  () => props.clientId,
  async (id, oldId) => {
    if (id === oldId) return
    detachSse()
    resetState()
    featureDisabled.value = Boolean(props.disabled)
    featureDisabledMessage.value = 'Discovery agent is disabled for this client.'
    if (!id || disabled.value) {
      return
    }
    await loadSources()
    if (!disabled.value) {
      attachSse()
    }
  },
  { immediate: true },
)

watch(
  () => props.disabled,
  async (value, oldValue) => {
    if (value === oldValue) return
    if (value) {
      featureDisabled.value = true
      featureDisabledMessage.value = 'Discovery agent is disabled for this client.'
      detachSse()
      return
    }
    featureDisabled.value = false
    featureDisabledMessage.value = 'Discovery agent is disabled for this client.'
    resetState()
    if (!props.clientId) {
      return
    }
    await loadSources()
    if (!disabled.value) {
      attachSse()
    }
  },
)

function mapSourceRecord(record: Record<string, any>): SourceItem {
  const createdAt = coerceIsoString(record.createdAt) ?? new Date().toISOString()
  const updatedAt = coerceIsoString(record.updatedAt) ?? createdAt
  const health = parseHealthState(record.healthJson, updatedAt)
  const lastFailureReason = coerceFailureReason(record.lastFailureReason)
  const consecutiveFailures = coerceNumber(
    record.consecutiveFailureCount ?? health.consecutiveFailures,
    health.consecutiveFailures,
  )

  return {
    id: String(record.id),
    clientId: String(record.clientId),
    url: String(record.url),
    canonicalUrl: String(record.canonicalUrl ?? record.url),
    sourceType: record.sourceType as DiscoverySourceType,
    identifier: String(record.identifier),
    notes: typeof record.notes === 'string' && record.notes.length ? record.notes : null,
    createdAt,
    updatedAt,
    lastFetchStatus: (record.lastFetchStatus as SourceItem['lastFetchStatus']) ?? 'idle',
    lastFetchCompletedAt: coerceIsoString(record.lastFetchCompletedAt),
    lastFailureReason,
    lastSuccessAt: coerceIsoString(record.lastSuccessAt),
    consecutiveFailureCount: consecutiveFailures,
    health: {
      ...health,
      consecutiveFailures,
    },
    ...(record.pending ? { pending: true as const } : {}),
    ...(record.pendingKey ? { pendingKey: String(record.pendingKey) } : {}),
  }
}

function createPendingSourceItem(input: {
  id: string
  clientId: string
  url: string
  canonicalUrl: string
  sourceType: DiscoverySourceType
  identifier: string
  notes: string | null
  pendingKey: string
}): SourceItem {
  const nowIso = new Date().toISOString()
  return {
    id: input.id,
    clientId: input.clientId,
    url: input.url,
    canonicalUrl: input.canonicalUrl,
    sourceType: input.sourceType,
    identifier: input.identifier,
    notes: input.notes,
    createdAt: nowIso,
    updatedAt: nowIso,
    lastFetchStatus: 'idle',
    lastFetchCompletedAt: null,
    lastFailureReason: null,
    lastSuccessAt: null,
    consecutiveFailureCount: 0,
    health: createDefaultHealth(nowIso),
    pending: true,
    pendingKey: input.pendingKey,
  }
}

function statusMeta(item: SourceItem) {
  switch (item.health.status) {
    case 'healthy':
      return { label: 'Success', color: 'success' as const }
    case 'warning':
      return { label: 'Warning', color: 'warning' as const }
    case 'error':
      return { label: 'Error', color: 'error' as const }
    default:
      return { label: 'Unknown', color: 'surface-variant' as const }
  }
}

function formatTimestamp(timestamp: string | null) {
  if (!timestamp) {
    return 'Never'
  }
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) {
    return 'Unknown'
  }
  return date.toLocaleString()
}

function isFetchStale(health: SourceHealthState) {
  if (!health.lastFetchedAt) return false
  const date = new Date(health.lastFetchedAt)
  if (Number.isNaN(date.getTime())) return false
  return Date.now() - date.getTime() > STALE_THRESHOLD_MS
}

function displayLastFetch(item: SourceItem) {
  const timestamp = item.health.lastFetchedAt ?? item.lastFetchCompletedAt ?? item.lastSuccessAt
  return formatTimestamp(timestamp)
}

function statusTooltip(item: SourceItem) {
  if (item.pending) return null
  const { health } = item
  if (health.status === 'healthy') {
    if (!health.lastFetchedAt) {
      return 'Awaiting first successful fetch'
    }
    return `Last fetch succeeded at ${formatTimestamp(health.lastFetchedAt)}`
  }

  const parts: string[] = []
  if (health.consecutiveFailures > 0) {
    parts.push(`${health.consecutiveFailures} consecutive failure${health.consecutiveFailures === 1 ? '' : 's'}`)
  }
  if (health.failureReason) {
    const reason = formatFailureReason(health.failureReason)
    if (reason) {
      parts.push(`Last failure: ${reason}`)
    }
  }
  if (health.status === 'warning') {
    if (health.staleSince) {
      parts.push(`Stale since ${formatTimestamp(health.staleSince)}`)
    } else if (isFetchStale(health)) {
      parts.push('Last fetch over 24 hours ago')
    }
  }
  if (!parts.length) {
    parts.push('Source health warning')
  }
  return parts.join(' • ')
}

const duplicateKeySet = computed(() => {
  const set = new Set<string>()
  for (const item of sources.value) {
    set.add(`${item.sourceType}::${item.identifier.toLowerCase()}`)
  }
  return set
})

function markFeatureDisabled(message?: string) {
  featureDisabled.value = true
  featureDisabledMessage.value = message || 'Discovery agent is disabled for this client.'
  error.value = null
  sources.value = []
  submitLoading.value = false
  loading.value = false
  detachSse()
}

function resetState() {
  sources.value = []
  error.value = null
  form.url = ''
  form.notes = ''
  fieldErrors.url = undefined
  fieldErrors.notes = undefined
  detectionSummary.value = null
  duplicateWarning.value = null
  submitLoading.value = false
  loading.value = false
}

async function loadSources() {
  const clientId = props.clientId
  if (!clientId || disabled.value) {
    loading.value = false
    return
  }
  loading.value = true
  error.value = null
  try {
    const res = await fetch(`/api/clients/${clientId}/sources`, { headers: { accept: 'application/json' } })
    const contentType = res.headers.get('content-type') || ''
    let payload: any = null
    if (contentType.includes('application/json')) {
      payload = await res.json().catch(() => null)
    } else {
      const text = await res.text().catch(() => '')
      payload = text
    }

    if (!res.ok) {
      const disabledMessage =
        typeof payload === 'object' && payload && 'statusMessage' in payload
          ? String((payload as any).statusMessage || '')
          : undefined
      if (res.status === 403 && (payload?.code === 'feature_disabled' || payload?.statusCode === 403)) {
        markFeatureDisabled(disabledMessage || undefined)
        return
      }
      const message = typeof payload === 'string'
        ? (payload || `HTTP ${res.status}`)
        : (payload?.statusMessage || payload?.message || payload?.error || `HTTP ${res.status}`)
      throw new Error(message)
    }

    const data = payload ?? {}
    const items = Array.isArray((data as any)?.items) ? (data as any).items : []
    sources.value = items.map((item: any) => mapSourceRecord(item))
    featureDisabled.value = false
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

function attachSse() {
  detachSse()
  const clientId = props.clientId
  if (!clientId || disabled.value) return
  unsubscribeFromSse = subscribeToDiscoveryEvents(clientId, {
    onSourceCreated: handleSourceCreated,
    onEvent: handleDiscoveryEvent,
    onFeatureDisabled: handleFeatureDisabled,
  })
}

function detachSse() {
  if (unsubscribeFromSse) {
    unsubscribeFromSse()
    unsubscribeFromSse = null
  }
}

async function submit() {
  const clientId = props.clientId
  if (!clientId || disabled.value) return
  fieldErrors.url = undefined
  duplicateWarning.value = null

  let normalized: ReturnType<typeof normalizeDiscoverySourceUrl>
  try {
    normalized = normalizeDiscoverySourceUrl(form.url)
  } catch (err) {
    fieldErrors.url = err instanceof Error ? err.message : 'Enter a valid URL'
    return
  }

  const dupKey = deriveDuplicateKey(normalized)
  if (duplicateKeySet.value.has(dupKey)) {
    duplicateWarning.value = 'This source already exists for the client.'
    fieldErrors.url = 'Duplicate source'
    return
  }

  submitLoading.value = true
  const optimisticId = `tmp-${Date.now()}`
  const pendingItem = createPendingSourceItem({
    id: optimisticId,
    clientId,
    url: form.url,
    canonicalUrl: normalized.canonicalUrl,
    sourceType: normalized.sourceType,
    identifier: normalized.identifier,
    notes: form.notes || null,
    pendingKey: dupKey,
  })
  sources.value = [pendingItem, ...sources.value]

  try {
    const res = await fetch(`/api/clients/${clientId}/sources`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        url: form.url,
        notes: form.notes.trim() ? form.notes.trim() : undefined,
      }),
    })

    const contentType = res.headers.get('content-type') || ''
    let payload: any = null
    if (contentType.includes('application/json')) {
      payload = await res.json().catch(() => null)
    } else {
      payload = await res.text().catch(() => '')
    }

    if (!res.ok) {
      const disabledMessage =
        typeof payload === 'object' && payload && 'statusMessage' in payload
          ? String((payload as any).statusMessage || '')
          : undefined
      if (res.status === 403 && (payload?.code === 'feature_disabled' || payload?.statusCode === 403)) {
        markFeatureDisabled(disabledMessage || undefined)
        throw new Error(disabledMessage || 'Discovery agent is disabled for this client.')
      }
      const message = typeof payload === 'string'
        ? (payload || `HTTP ${res.status}`)
        : (payload?.statusMessage || payload?.message || payload?.error || `HTTP ${res.status}`)
      throw new Error(message)
    }

    const data = payload ?? {}
    const record = (data as any)?.source
    if (record) {
      const mapped = mapSourceRecord(record)
      const idx = sources.value.findIndex((s) => s.pending && s.pendingKey === dupKey)
      if (idx !== -1) {
        sources.value.splice(idx, 1, mapped)
      } else {
        sources.value = [mapped, ...sources.value]
      }
    }

    featureDisabled.value = false
    resetForm()
  } catch (err) {
    sources.value = sources.value.filter((s) => s.id !== optimisticId)
    const message = err instanceof Error ? err.message : 'Failed to create source'
    if (featureDisabled.value) {
      error.value = message
    } else {
      notifications.notifyError(message)
    }
  } finally {
    submitLoading.value = false
  }
}

function resetForm() {
  form.url = ''
  form.notes = ''
  fieldErrors.url = undefined
  fieldErrors.notes = undefined
  detectionSummary.value = null
  duplicateWarning.value = null
}

async function onDelete(item: SourceItem) {
  const clientId = props.clientId
  if (!clientId || !item?.id) return
  if (!confirm('Remove this discovery source?')) return
  sources.value = sources.value.map((s) => (s.id === item.id ? { ...s, pending: true } : s))
  try {
    const res = await fetch(`/api/clients/${clientId}/sources/${item.id}`, {
      method: 'DELETE',
      headers: { accept: 'application/json' },
    })
    const contentType = res.headers.get('content-type') || ''
    let payload: any = null
    if (contentType.includes('application/json')) {
      payload = await res.json().catch(() => null)
    } else {
      payload = await res.text().catch(() => '')
    }
    if (!res.ok) {
      const disabledMessage =
        typeof payload === 'object' && payload && 'statusMessage' in payload
          ? String((payload as any).statusMessage || '')
          : undefined
      if (res.status === 403 && (payload?.code === 'feature_disabled' || payload?.statusCode === 403)) {
        markFeatureDisabled(disabledMessage || undefined)
        throw new Error(disabledMessage || 'Discovery agent is disabled for this client.')
      }
      const message = typeof payload === 'string'
        ? (payload || `HTTP ${res.status}`)
        : (payload?.statusMessage || payload?.message || payload?.error || `HTTP ${res.status}`)
      throw new Error(message)
    }
    sources.value = sources.value.filter((s) => s.id !== item.id)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete source'
    if (featureDisabled.value) {
      error.value = message
    } else {
      notifications.notifyError(message)
    }
    sources.value = sources.value.map((s) => (s.id === item.id ? { ...s, pending: false } : s))
  }
}

function handleSourceCreated(payload: DiscoverySourceCreatedEvent['payload']) {
  const clientId = props.clientId
  if (!clientId || payload.clientId !== clientId) return
  const dupKey = `${payload.sourceType}::${payload.identifier.toLowerCase()}`
  if (duplicateKeySet.value.has(dupKey)) return

  const mapped = mapSourceRecord({
    id: payload.id,
    clientId: payload.clientId,
    url: payload.url,
    canonicalUrl: payload.canonicalUrl,
    sourceType: payload.sourceType,
    identifier: payload.identifier,
    notes: null,
    createdAt: payload.createdAt,
    updatedAt: payload.createdAt,
    lastFetchStatus: 'idle',
    lastFetchCompletedAt: null,
    lastFailureReason: null,
    lastSuccessAt: null,
    consecutiveFailureCount: 0,
    healthJson: createDefaultHealth(payload.createdAt),
  })

  sources.value = [mapped, ...sources.value]
}

function handleDiscoveryEvent(event: DiscoveryTelemetryEvent) {
  if (event.eventType !== 'source.health') return
  const payload = (event as SourceHealthTelemetryEvent).payload
  if (payload.clientId !== props.clientId) return
  applySourceHealthUpdate(payload)
}

function applySourceHealthUpdate(payload: SourceHealthEvent['payload']) {
  const index = sources.value.findIndex((item) => item.id === payload.sourceId)
  if (index === -1) return

  const existing = sources.value[index]
  const rawHealth = {
    status: payload.status,
    observedAt: payload.observedAt,
    lastFetchedAt: payload.lastFetchedAt ?? null,
    failureReason: payload.failureReason ?? null,
    consecutiveFailures: payload.consecutiveFailures ?? existing.health.consecutiveFailures,
    staleSince: (payload as { staleSince?: string | null }).staleSince ?? existing.health.staleSince ?? undefined,
  }
  const health = parseHealthState(rawHealth, payload.observedAt)

  const nextLastSuccessAt = payload.status === 'healthy'
    ? payload.lastFetchedAt ?? existing.lastSuccessAt
    : existing.lastSuccessAt

  const nextLastFailureReason = payload.status !== 'healthy'
    ? coerceFailureReason(payload.failureReason) ?? existing.lastFailureReason
    : null

  const updated: SourceItem = {
    ...existing,
    updatedAt: payload.observedAt,
    lastFetchCompletedAt: payload.lastFetchedAt ?? existing.lastFetchCompletedAt,
    lastFailureReason: nextLastFailureReason,
    lastSuccessAt: nextLastSuccessAt,
    consecutiveFailureCount: health.consecutiveFailures,
    health,
    pending: false,
  }

  sources.value.splice(index, 1, updated)
}

function handleFeatureDisabled(payload: DiscoveryFeatureDisabledPayload) {
  const message = typeof payload?.message === 'string' && payload.message.trim()
    ? payload.message.trim()
    : undefined
  markFeatureDisabled(message)
  resetForm()
}

onBeforeUnmount(() => {
  detachSse()
})

const typeIcon = (type: DiscoverySourceType) => {
  switch (type) {
    case 'rss':
      return 'mdi-rss'
    case 'youtube-channel':
      return 'mdi-youtube'
    case 'youtube-playlist':
      return 'mdi-youtube-play'
    default:
      return 'mdi-web'
  }
}

const hasSources = computed(() => sources.value.length > 0)
</script>

<template>
  <div>
    <p v-if="mode === 'embedded'" class="text-body-2 text-medium-emphasis mb-4">
      Add feeds or channels to automatically ingest discovery content for this client.
    </p>

    <v-row v-if="mode === 'standalone'" class="g-4">
      <v-col cols="12" md="5">
        <v-card elevation="2" class="mb-6">
          <v-card-text>
            <h2 class="text-subtitle-1 mb-4">Add Source</h2>
            <v-alert
              v-if="disabledBannerMessage"
              type="info"
              variant="tonal"
              density="comfortable"
              class="mb-4"
              :text="disabledBannerMessage"
            />
            <v-form @submit.prevent="submit">
              <v-text-field
                v-model="form.url"
                label="Source URL"
                variant="solo-filled"
                density="comfortable"
                :error-messages="fieldErrors.url ? [fieldErrors.url] : []"
                prepend-inner-icon="mdi-link"
                autocomplete="off"
                required
                :disabled="disabled"
              />
              <v-textarea
                v-model="form.notes"
                label="Notes (optional)"
                variant="solo-filled"
                density="comfortable"
                rows="3"
                :disabled="disabled"
              />

              <v-alert
                v-if="duplicateWarning"
                type="warning"
                class="mb-3"
                density="comfortable"
                :text="duplicateWarning"
              />

              <div v-if="detectionSummary" class="d-flex align-center gap-2 mb-3">
                <v-chip size="small" color="primary" variant="tonal">
                  {{ detectionSummary.sourceType }}
                </v-chip>
                <span class="text-caption text-medium-emphasis">{{ detectionSummary.canonicalUrl }}</span>
              </div>

              <v-btn
                type="submit"
                color="primary"
                :loading="submitLoading"
                block
                prepend-icon="mdi-content-save"
                :disabled="disabled"
              >
                Save Source
              </v-btn>
            </v-form>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" md="7">
        <v-card elevation="2">
          <v-card-text>
            <div class="d-flex justify-space-between align-center mb-3">
              <h2 class="text-subtitle-1 mb-0">Existing sources</h2>
              <v-progress-circular v-if="loading" indeterminate color="primary" size="20" />
            </div>

            <v-alert
              v-if="error"
              type="error"
              density="comfortable"
              class="mb-4"
              :text="error"
            />

            <v-alert
              v-else-if="disabledBannerMessage"
              type="info"
              density="comfortable"
              variant="tonal"
              class="mb-4"
              :text="disabledBannerMessage"
            />

            <v-list v-if="hasSources" density="comfortable" lines="two">
              <v-list-item
                v-for="source in sources"
                :key="source.id"
                :title="source.url"
              >
                <template #prepend>
                  <v-avatar size="32" :color="source.pending ? 'surface-variant' : 'surface'">
                    <v-icon :icon="typeIcon(source.sourceType)" />
                  </v-avatar>
                </template>
                <template #append>
                  <div class="d-flex align-center gap-2">
                    <template v-if="!source.pending">
                      <v-tooltip v-if="statusTooltip(source)" location="top">
                        <template #activator="{ props: tooltipProps }">
                          <v-chip
                            v-bind="tooltipProps"
                            size="small"
                            :color="statusMeta(source).color"
                            variant="tonal"
                            class="text-uppercase font-weight-medium"
                          >
                            {{ statusMeta(source).label }}
                          </v-chip>
                        </template>
                        <span>{{ statusTooltip(source) }}</span>
                      </v-tooltip>
                      <v-chip
                        v-else
                        size="small"
                        :color="statusMeta(source).color"
                        variant="tonal"
                        class="text-uppercase font-weight-medium"
                      >
                        {{ statusMeta(source).label }}
                      </v-chip>
                    </template>
                    <v-progress-circular v-else size="18" width="2" indeterminate />
                    <v-chip size="small" variant="tonal">{{ source.sourceType }}</v-chip>
                    <v-btn
                      v-if="!source.pending"
                      icon="mdi-delete"
                      size="small"
                      variant="text"
                      :disabled="disabled"
                      @click="onDelete(source)"
                    />
                  </div>
                </template>
                <template #subtitle>
                  <div class="text-body-2">
                    <div class="text-medium-emphasis">{{ source.canonicalUrl }}</div>
                    <div v-if="source.notes" class="text-caption">{{ source.notes }}</div>
                    <div class="text-caption text-medium-emphasis mt-1">
                      Last fetch: {{ displayLastFetch(source) }}
                    </div>
                    <div class="text-caption text-disabled">
                      Added: {{ formatTimestamp(source.createdAt) }}
                    </div>
                  </div>
                </template>
              </v-list-item>
            </v-list>

            <div v-else class="text-center py-10">
              <v-icon icon="mdi-rss" size="36" class="mb-2 text-medium-emphasis" />
              <p class="text-subtitle-2 mb-1">No sources yet</p>
              <p class="text-body-2 text-medium-emphasis mb-0">Add your first discovery source using the form.</p>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <div v-else>
      <v-alert
        v-if="error"
        type="error"
        density="comfortable"
        class="mb-4"
        :text="error"
      />

      <v-form @submit.prevent="submit">
        <v-row class="align-end" dense>
          <v-col cols="12" md="6">
            <v-text-field
              v-model="form.url"
              label="Source URL"
              variant="outlined"
              density="comfortable"
              :error-messages="fieldErrors.url ? [fieldErrors.url] : []"
              prepend-inner-icon="mdi-link"
              autocomplete="off"
              required
              hide-details="auto"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-textarea
              v-model="form.notes"
              label="Notes (optional)"
              variant="outlined"
              density="comfortable"
              rows="3"
              hide-details="auto"
            />
          </v-col>
          <v-col cols="12">
            <div class="d-flex flex-wrap align-center gap-3 mb-3">
              <v-alert
                v-if="duplicateWarning"
                type="warning"
                density="comfortable"
                variant="tonal"
                class="ma-0"
                :text="duplicateWarning"
              />
              <v-chip
                v-if="detectionSummary"
                size="small"
                color="primary"
                variant="tonal"
              >
                {{ detectionSummary.sourceType }} · {{ detectionSummary.canonicalUrl }}
              </v-chip>
            </div>
            <v-btn
              type="submit"
              color="primary"
              :loading="submitLoading"
              prepend-icon="mdi-content-save"
            >
              Save Source
            </v-btn>
          </v-col>
        </v-row>
      </v-form>

      <v-divider class="my-6" />

      <div class="d-flex justify-space-between align-center mb-3">
        <h3 class="text-subtitle-1 mb-0">Existing sources</h3>
        <v-progress-circular v-if="loading" indeterminate color="primary" size="20" />
      </div>

      <v-list v-if="hasSources" density="comfortable" lines="two">
        <v-list-item
          v-for="source in sources"
          :key="source.id"
          :title="source.url"
        >
          <template #prepend>
            <v-avatar size="32" :color="source.pending ? 'surface-variant' : 'surface'">
              <v-icon :icon="typeIcon(source.sourceType)" />
            </v-avatar>
          </template>
          <template #append>
            <div class="d-flex align-center gap-2">
              <template v-if="!source.pending">
                <v-tooltip v-if="statusTooltip(source)" location="top">
                  <template #activator="{ props: tooltipProps }">
                    <v-chip
                      v-bind="tooltipProps"
                      size="small"
                      :color="statusMeta(source).color"
                      variant="tonal"
                      class="text-uppercase font-weight-medium"
                    >
                      {{ statusMeta(source).label }}
                    </v-chip>
                  </template>
                  <span>{{ statusTooltip(source) }}</span>
                </v-tooltip>
                <v-chip
                  v-else
                  size="small"
                  :color="statusMeta(source).color"
                  variant="tonal"
                  class="text-uppercase font-weight-medium"
                >
                  {{ statusMeta(source).label }}
                </v-chip>
              </template>
              <v-progress-circular v-else size="18" width="2" indeterminate />
              <v-chip size="small" variant="tonal">{{ source.sourceType }}</v-chip>
              <v-btn
                v-if="!source.pending"
                icon="mdi-delete"
                size="small"
                variant="text"
                @click="onDelete(source)"
              />
            </div>
          </template>
          <template #subtitle>
            <div class="text-body-2">
              <div class="text-medium-emphasis">{{ source.canonicalUrl }}</div>
              <div v-if="source.notes" class="text-caption">{{ source.notes }}</div>
              <div class="text-caption text-medium-emphasis mt-1">
                Last fetch: {{ displayLastFetch(source) }}
              </div>
              <div class="text-caption text-disabled">
                Added: {{ formatTimestamp(source.createdAt) }}
              </div>
            </div>
          </template>
        </v-list-item>
      </v-list>

      <div v-else class="text-medium-emphasis">
        No discovery sources yet.
      </div>
    </div>
  </div>
</template>

<style scoped>
.gap-3 {
  gap: 12px;
}
.g-4 {
  row-gap: 16px;
}
</style>
