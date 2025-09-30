<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useHitlStore } from '@/stores/hitl'

const hitlStore = useHitlStore()
const {
  activeRequest,
  submissionState,
  submissionError,
  submissionNotice,
  denialNotice,
  submitting
} = storeToRefs(hitlStore)

const approvalDecision = ref<'approve' | 'reject' | null>(null)
const selectedOptionId = ref<string | null>(null)
const freeformText = ref('')
const validationError = ref<string | null>(null)

const hasOptions = computed(() => Boolean(activeRequest.value?.options?.length))
const showApprovalControls = computed(() => activeRequest.value?.kind === 'approval')
const showOptionsControls = computed(() => hasOptions.value)
const showFreeform = computed(() => {
  if (!activeRequest.value) return false
  if (activeRequest.value.kind === 'approval') return true
  if (activeRequest.value.allowFreeForm) return true
  if (!hasOptions.value) return true
  return false
})

const receivedTimestamp = computed(() => {
  const created = activeRequest.value?.createdAt ?? activeRequest.value?.receivedAt
  return created ? new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(created) : null
})

const emit = defineEmits<{
  (e: 'resume'): void
}>()

watch(activeRequest, (req) => {
  approvalDecision.value = null
  selectedOptionId.value = null
  freeformText.value = ''
  validationError.value = null
  if (req?.options?.length === 1 && !req.allowFreeForm && req.kind !== 'approval') {
    selectedOptionId.value = req.options[0].id
  }
}, { immediate: true })

function ensureValid(): boolean {
  validationError.value = null
  const request = activeRequest.value
  if (!request) return false

  if (request.kind === 'approval') {
    if (!approvalDecision.value) {
      validationError.value = 'Select approve or reject before submitting.'
      return false
    }
    if (request.allowFreeForm && freeformText.value.trim().length === 0) {
      validationError.value = 'Provide a note for the approval decision.'
      return false
    }
    return true
  }

  if (request.options.length > 0) {
    if (!request.allowFreeForm && !selectedOptionId.value) {
      validationError.value = 'Choose one of the provided options.'
      return false
    }
    if (request.allowFreeForm && !selectedOptionId.value && freeformText.value.trim().length === 0) {
      validationError.value = 'Select an option or provide a free-form response.'
      return false
    }
  } else if (freeformText.value.trim().length === 0) {
    validationError.value = 'Provide a response before submitting.'
    return false
  }

  return true
}

function computeResponseType(): 'option' | 'approval' | 'rejection' | 'freeform' {
  const request = activeRequest.value
  if (!request) return 'freeform'
  if (request.kind === 'approval') {
    return approvalDecision.value === 'approve' ? 'approval' : 'rejection'
  }
  if (selectedOptionId.value) return 'option'
  return 'freeform'
}

async function submit() {
  if (!ensureValid()) return
  const request = activeRequest.value
  if (!request) return

  await hitlStore.submitResponse({
    responseType: computeResponseType(),
    approved: request.kind === 'approval' ? approvalDecision.value === 'approve' : undefined,
    selectedOptionId: selectedOptionId.value ?? undefined,
    freeformText: freeformText.value.trim().length > 0 ? freeformText.value.trim() : undefined
  })

  if (submissionState.value === 'success') {
    emit('resume')
  }
}

function urgencyColor(urgency: string) {
  if (urgency === 'high') return 'error'
  if (urgency === 'low') return 'info'
  return 'warning'
}

</script>

<template>
  <v-card class="mb-3" variant="outlined">
    <v-card-title class="d-flex align-center">
      <v-icon icon="mdi-human-queue" class="me-2" />
      Human-in-the-Loop
      <v-spacer />
      <v-chip
        v-if="activeRequest"
        size="small"
        :color="urgencyColor(activeRequest.urgency)"
        variant="tonal"
        class="text-uppercase"
      >
        {{ activeRequest.urgency }}
      </v-chip>
    </v-card-title>

    <v-divider />

    <v-card-text>
      <v-alert
        v-if="denialNotice"
        type="warning"
        variant="tonal"
        border="start"
        class="mb-4"
      >
        {{ denialNotice }}
      </v-alert>

      <v-alert
        v-if="submissionNotice && !activeRequest"
        type="success"
        variant="tonal"
        border="start"
        class="mb-4"
      >
        {{ submissionNotice }}
      </v-alert>

      <v-alert
        v-if="submissionError"
        type="error"
        variant="tonal"
        border="start"
        class="mb-4"
      >
        {{ submissionError }}
      </v-alert>

      <div v-if="activeRequest" class="d-flex flex-column ga-3">
        <div class="d-flex flex-wrap gap-2 align-center">
          <v-chip size="small" color="primary" variant="flat">{{ activeRequest.originAgent }}</v-chip>
          <v-chip size="small" variant="tonal">{{ activeRequest.kind }}</v-chip>
          <v-chip v-if="receivedTimestamp" size="small" variant="tonal">
            Received {{ receivedTimestamp }}
          </v-chip>
        </div>

        <div class="hitl-question">
          <span class="text-subtitle-1">{{ activeRequest.question }}</span>
        </div>

        <v-alert
          v-if="activeRequest.additionalContext"
          type="info"
          variant="outlined"
          border="start"
          density="comfortable"
          class="mb-2"
        >
          {{ activeRequest.additionalContext }}
        </v-alert>

        <div v-if="showApprovalControls" class="mb-2">
          <div class="text-subtitle-2 mb-1">Approval decision</div>
          <v-radio-group v-model="approvalDecision" :disabled="submitting || submissionState === 'success'">
            <v-radio label="Approve" value="approve" color="success" />
            <v-radio label="Reject" value="reject" color="error" />
          </v-radio-group>
        </div>

        <div v-else-if="showOptionsControls" class="mb-2">
          <div class="text-subtitle-2 mb-1">Select an option</div>
          <v-radio-group v-model="selectedOptionId" :disabled="submitting || submissionState === 'success'">
            <v-radio
              v-for="option in activeRequest.options"
              :key="option.id"
              :label="option.label"
              :value="option.id"
            />
            <template v-for="option in activeRequest.options" :key="option.id + '-hint'">
              <div v-if="option.description" class="text-caption text-medium-emphasis ms-10 mb-2">
                {{ option.description }}
              </div>
            </template>
          </v-radio-group>
        </div>

        <div v-if="showFreeform">
          <v-textarea
            v-model="freeformText"
            label="Add details"
            auto-grow
            min-rows="3"
            :disabled="submitting || submissionState === 'success'"
          />
        </div>

        <v-alert
          v-if="validationError"
          type="error"
          variant="tonal"
          border="start"
        >
          {{ validationError }}
        </v-alert>

        <div class="d-flex justify-end ga-2">
          <v-btn
            color="primary"
            :loading="submitting"
            :disabled="submissionState === 'success'"
            @click="submit"
          >
            Submit response
          </v-btn>
        </div>
      </div>

      <div v-else class="text-body-2 text-medium-emphasis">
        No active HITL requests. The panel updates automatically when a prompt arrives.
      </div>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.gap-2 {
  gap: 8px;
}
.hitl-question {
  padding: 12px;
  border-radius: 8px;
  background-color: rgba(var(--v-theme-primary), 0.08);
}
</style>
