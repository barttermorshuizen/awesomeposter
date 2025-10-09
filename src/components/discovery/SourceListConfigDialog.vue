<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { PropType } from 'vue'
import { storeToRefs } from 'pinia'
import { useDiscoverySourcesStore } from '@/stores/discoverySources'
import { useListConfig } from '@/composables/discovery/useListConfig'
import type { DiscoverySourceWebListConfig } from '@awesomeposter/shared'
import SourceListConfigForm from './SourceListConfigForm.vue'
import {
  checkWebListConfig,
  updateDiscoverySourceWebListConfig,
} from '@/services/discovery/sources'

const props = defineProps({
  clientId: {
    type: String as PropType<string>,
    required: true,
  },
})

const store = useDiscoverySourcesStore()
const { activeWebListState } = storeToRefs(store)

const dialogVisible = computed({
  get: () => store.dialog.open,
  set: (value: boolean) => {
    if (!value) {
      store.closeDialog()
    }
  },
})

const baseConfig = ref<DiscoverySourceWebListConfig | null>(null)
const baseEnabled = ref(false)

const listConfig = useListConfig({
  initialConfig: null,
  initialEnabled: false,
  suggestion: null,
})

watch(
  () => listConfig.isDirty.value,
  (dirty) => {
    store.setDialogDirty(dirty)
  },
)

function syncFormWithState(state = activeWebListState.value) {
  if (!state) return
  baseConfig.value = state.config
  baseEnabled.value = state.enabled
  listConfig.reset(state.config, state.enabled)
}

watch(
  () => store.dialog.open,
  (open) => {
    if (open) {
      syncFormWithState()
    } else {
      listConfig.reset(baseConfig.value, baseEnabled.value)
      store.setDialogDirty(false)
      store.setDialogError(null)
    }
  },
  { immediate: true },
)

watch(
  activeWebListState,
  (state, prev) => {
    if (!store.dialog.open) return
    if (!state) return
    if (listConfig.isDirty.value) return
    if (prev && prev.config === state.config && prev.enabled === state.enabled) {
      return
    }
    syncFormWithState(state)
  },
  { deep: true },
)

async function handleSave() {
  if (!store.dialog.sourceId) return
  const validation = listConfig.validate()
  if (!validation.valid) {
    store.setDialogError('Resolve validation errors before saving.')
    return
  }
  store.setDialogError(null)
  store.setDialogSaving(true)
  const sourceId = store.dialog.sourceId
  store.markWebListPending(sourceId, true)
  try {
    const payloadConfig = validation.config
    const response = await updateDiscoverySourceWebListConfig(props.clientId, sourceId, {
      webList: payloadConfig,
      suggestionId: listConfig.appliedSuggestionId.value ?? undefined,
    })
    store.registerSource(response.source)
    store.updateWebListFromConfig(
      response.source.id,
      payloadConfig,
      { warnings: response.warnings, appliedAt: response.source.updatedAt },
    )
    if (response.suggestionAcknowledged) {
      store.acknowledgeSuggestion(response.source.id)
    }
    listConfig.reset(payloadConfig, Boolean(payloadConfig))
    store.setDialogDirty(false)
    store.setDialogSaving(false)
    store.closeDialog()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save configuration'
    store.setDialogError(message)
    store.markWebListPending(sourceId, false)
    store.setDialogSaving(false)
  }
}

async function handleCheck() {
  if (!store.dialog.sourceId) return
  const validation = listConfig.validate()
  if (!validation.valid || !validation.config) {
    store.setDialogError('Fix validation issues before running a preview.')
    return
  }
  store.setDialogError(null)
  store.beginPreview()
  try {
    const response = await checkWebListConfig(props.clientId, store.dialog.sourceId, {
      webList: validation.config,
    })
    store.finishPreview(response.result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Preview failed'
    store.failPreview(message)
  }
}

function handleCancel() {
  store.closeDialog()
}

function handleApplySuggestion() {
  const suggestion = activeWebListState.value?.suggestion
  if (!suggestion) return
  listConfig.applySuggestion(suggestion)
}

function handleDiscardSuggestion() {
  if (!store.dialog.sourceId) return
  listConfig.discardSuggestion(baseConfig.value, baseEnabled.value)
  store.dismissSuggestion(store.dialog.sourceId)
}

onBeforeUnmount(() => {
  store.closeDialog()
})
</script>

<template>
  <v-dialog v-model="dialogVisible" max-width="820">
    <v-card>
      <v-card-title class="text-h6">
        Configure Web List
      </v-card-title>
      <v-card-text>
        <div v-if="store.dialog.error" class="mb-4">
          <v-alert
            type="error"
            variant="tonal"
            density="comfortable"
            :text="store.dialog.error"
          />
        </div>
        <SourceListConfigForm
          :form="listConfig.form"
          :errors="listConfig.errors"
          :disabled="store.dialog.saving"
          :suggestion="activeWebListState?.suggestion ?? null"
          :applied-suggestion-id="listConfig.appliedSuggestionId.value"
          :warnings="activeWebListState?.warnings ?? []"
          :preview-status="store.dialog.preview.status"
          :preview-result="store.dialog.preview.result"
          :preview-error="store.dialog.preview.error"
          @check="handleCheck"
          @apply-suggestion="handleApplySuggestion"
          @discard-suggestion="handleDiscardSuggestion"
        />
      </v-card-text>
      <v-card-actions class="justify-end gap-2">
        <v-btn
          variant="text"
          @click="handleCancel"
        >
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          variant="tonal"
          :disabled="store.dialog.saving || !listConfig.form.enabled"
          @click="handleCheck"
          data-testid="preview-config"
        >
          Check
        </v-btn>
        <v-btn
          color="primary"
          :loading="store.dialog.saving"
          :disabled="store.dialog.saving || (!listConfig.isDirty.value && !listConfig.form.enabled && !activeWebListState?.enabled)"
          @click="handleSave"
          data-testid="save-config"
        >
          Save
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
