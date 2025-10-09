import { computed, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  safeParseDiscoverySourceConfig,
  type DiscoverySourceConfig,
  type DiscoverySourceWebListConfig,
  type DiscoverySourceType,
  type DiscoveryWebListPreviewResult,
} from '@awesomeposter/shared'

export type DiscoverySourceApiRecord = {
  id: string
  clientId: string
  url: string
  canonicalUrl: string
  sourceType: DiscoverySourceType
  identifier: string
  notes: string | null
  configJson?: unknown
  updatedAt?: string
}

export type WebListSuggestionState = {
  id: string
  config: DiscoverySourceWebListConfig
  warnings: string[]
  confidence?: number | null
  receivedAt: string
  acknowledged: boolean
}

export type WebListState = {
  enabled: boolean
  config: DiscoverySourceWebListConfig | null
  warnings: string[]
  appliedAt: string | null
  pending: boolean
  suggestion: WebListSuggestionState | null
}

export type DiscoverySourceMetadata = {
  id: string
  clientId: string
  url: string
  canonicalUrl: string
  sourceType: DiscoverySourceType
  identifier: string
  notes: string | null
  updatedAt?: string
}

export type SourceUpdatePayload = {
  sourceId: string
  clientId: string
  updatedAt: string
  webListEnabled: boolean
  webListConfig: DiscoverySourceWebListConfig | null
  warnings?: string[]
  suggestion?: {
    id: string
    config: DiscoverySourceWebListConfig
    warnings?: string[]
    confidence?: number | null
    receivedAt: string
  } | null
}

type DialogPreviewState = {
  status: 'idle' | 'loading' | 'success' | 'error'
  result: DiscoveryWebListPreviewResult | null
  error: string | null
}

const createDefaultPreviewState = (): DialogPreviewState => ({
  status: 'idle',
  result: null,
  error: null,
})

const createDefaultWebListState = (): WebListState => ({
  enabled: false,
  config: null,
  warnings: [],
  appliedAt: null,
  pending: false,
  suggestion: null,
})

function toSuggestionState(
  suggestion: SourceUpdatePayload['suggestion'],
): WebListSuggestionState | null {
  if (!suggestion) {
    return null
  }
  return {
    id: suggestion.id,
    config: suggestion.config,
    warnings: suggestion.warnings ?? [],
    confidence: suggestion.confidence ?? null,
    receivedAt: suggestion.receivedAt,
    acknowledged: false,
  }
}

export const useDiscoverySourcesStore = defineStore('discoverySources', () => {
  const activeClientId = ref<string | null>(null)
  const metadataById = ref<Record<string, DiscoverySourceMetadata>>({})
  const webListById = ref<Record<string, WebListState>>({})

  const dialog = reactive({
    open: false,
    sourceId: null as string | null,
    dirty: false,
    saving: false,
    error: null as string | null,
    preview: createDefaultPreviewState(),
  })

  function resetPreview() {
    dialog.preview = createDefaultPreviewState()
  }

  function resetDialog() {
    dialog.open = false
    dialog.sourceId = null
    dialog.dirty = false
    dialog.saving = false
    dialog.error = null
    resetPreview()
  }

  function resetState() {
    activeClientId.value = null
    metadataById.value = {}
    webListById.value = {}
    resetDialog()
  }

  function ensureClientId(clientId: string) {
    if (activeClientId.value === clientId) {
      return
    }
    activeClientId.value = clientId
    metadataById.value = {}
    webListById.value = {}
    resetDialog()
  }

  function mergeMetadata(record: DiscoverySourceApiRecord) {
    metadataById.value = {
      ...metadataById.value,
      [record.id]: {
        id: record.id,
        clientId: record.clientId,
        url: record.url,
        canonicalUrl: record.canonicalUrl,
        sourceType: record.sourceType,
        identifier: record.identifier,
        notes: record.notes ?? null,
        updatedAt: record.updatedAt,
      },
    }
  }

  function mergeWebListState(
    record: DiscoverySourceApiRecord,
    baseState: WebListState | undefined,
  ) {
    let config: DiscoverySourceConfig | null = null
    if ('configJson' in record) {
      const parsed = safeParseDiscoverySourceConfig(record.configJson ?? null)
      if (parsed.ok) {
        config = parsed.config
      }
    }
    const nextState: WebListState = {
      ...(baseState ?? createDefaultWebListState()),
      enabled: Boolean(config?.webList),
      config: config?.webList ?? null,
      appliedAt: record.updatedAt ?? baseState?.appliedAt ?? null,
      pending: baseState?.pending ?? false,
    }
    webListById.value = {
      ...webListById.value,
      [record.id]: nextState,
    }
  }

  function registerSource(record: DiscoverySourceApiRecord) {
    ensureClientId(record.clientId)
    mergeMetadata(record)
    const current = webListById.value[record.id]
    mergeWebListState(record, current)
  }

  function registerSources(records: DiscoverySourceApiRecord[]) {
    if (!records.length) {
      return
    }
    ensureClientId(records[0]!.clientId)
    records.forEach((record) => {
      mergeMetadata(record)
      mergeWebListState(record, webListById.value[record.id])
    })
  }

  function removeSource(sourceId: string) {
    if (!(sourceId in metadataById.value)) {
      return
    }
    const { [sourceId]: _removedMeta, ...restMeta } = metadataById.value
    metadataById.value = restMeta
    if (sourceId in webListById.value) {
      const { [sourceId]: _removedState, ...restState } = webListById.value
      webListById.value = restState
    }
    if (dialog.sourceId === sourceId) {
      resetDialog()
    }
  }

  function markWebListPending(sourceId: string, pending: boolean) {
    const state = webListById.value[sourceId]
    if (!state) return
    webListById.value = {
      ...webListById.value,
      [sourceId]: {
        ...state,
        pending,
      },
    }
  }

  function updateWebListFromConfig(
    sourceId: string,
    config: DiscoverySourceWebListConfig | null,
    meta?: { warnings?: string[]; appliedAt?: string },
  ) {
    const state = webListById.value[sourceId] ?? createDefaultWebListState()
    webListById.value = {
      ...webListById.value,
      [sourceId]: {
        ...state,
        enabled: Boolean(config),
        config,
        warnings: meta?.warnings ?? state.warnings,
        appliedAt: meta?.appliedAt ?? state.appliedAt ?? null,
        pending: false,
      },
    }
  }

  function applySourceUpdate(payload: SourceUpdatePayload) {
    ensureClientId(payload.clientId)
    const state = webListById.value[payload.sourceId] ?? createDefaultWebListState()
    const suggestionProvided = Object.prototype.hasOwnProperty.call(payload, 'suggestion')
    const nextSuggestion = toSuggestionState(payload.suggestion)
    webListById.value = {
      ...webListById.value,
      [payload.sourceId]: {
        ...state,
        enabled: payload.webListEnabled,
        config: payload.webListConfig,
        warnings: payload.warnings ?? state.warnings,
        appliedAt: payload.updatedAt,
        pending: false,
        suggestion: suggestionProvided ? nextSuggestion : state.suggestion,
      },
    }
    const metadata = metadataById.value[payload.sourceId]
    if (metadata) {
      metadataById.value = {
        ...metadataById.value,
        [payload.sourceId]: {
          ...metadata,
          updatedAt: payload.updatedAt,
        },
      }
    }
  }

  function acknowledgeSuggestion(sourceId: string) {
    const state = webListById.value[sourceId]
    if (!state?.suggestion) return
    webListById.value = {
      ...webListById.value,
      [sourceId]: {
        ...state,
        suggestion: {
          ...state.suggestion,
          acknowledged: true,
        },
      },
    }
  }

  function dismissSuggestion(sourceId: string) {
    const state = webListById.value[sourceId]
    if (!state?.suggestion) return
    webListById.value = {
      ...webListById.value,
      [sourceId]: {
        ...state,
        suggestion: null,
      },
    }
  }

  function openDialog(sourceId: string) {
    if (!(sourceId in metadataById.value)) {
      return
    }
    dialog.open = true
    dialog.sourceId = sourceId
    dialog.dirty = false
    dialog.saving = false
    dialog.error = null
    resetPreview()
  }

  function closeDialog() {
    resetDialog()
  }

  function setDialogDirty(dirty: boolean) {
    dialog.dirty = dirty
  }

  function setDialogSaving(saving: boolean) {
    dialog.saving = saving
  }

  function setDialogError(error: string | null) {
    dialog.error = error
  }

  function beginPreview() {
    dialog.preview = {
      status: 'loading',
      result: null,
      error: null,
    }
  }

  function finishPreview(result: DiscoveryWebListPreviewResult) {
    dialog.preview = {
      status: 'success',
      result,
      error: null,
    }
  }

  function failPreview(error: string) {
    dialog.preview = {
      status: 'error',
      result: null,
      error,
    }
  }

  const listEnabledSourceIds = computed(() => new Set(
    Object.entries(webListById.value)
      .filter(([, state]) => state.enabled)
      .map(([id]) => id),
  ))

  const activeSourceMetadata = computed(() => {
    if (!dialog.sourceId) return null
    return metadataById.value[dialog.sourceId] ?? null
  })

  const activeWebListState = computed(() => {
    if (!dialog.sourceId) return null
    return webListById.value[dialog.sourceId] ?? createDefaultWebListState()
  })

  return {
    // state
    metadataById,
    webListById,
    dialog,
    listEnabledSourceIds,
    activeSourceMetadata,
    activeWebListState,
    // actions
    resetState,
    ensureClientId,
    registerSource,
    registerSources,
    removeSource,
    markWebListPending,
    updateWebListFromConfig,
    applySourceUpdate,
    acknowledgeSuggestion,
    dismissSuggestion,
    openDialog,
    closeDialog,
    setDialogDirty,
    setDialogSaving,
    setDialogError,
    beginPreview,
    finishPreview,
    failPreview,
  }
})
