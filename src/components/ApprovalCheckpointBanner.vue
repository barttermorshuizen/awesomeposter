<script setup lang="ts">
import { computed } from 'vue'
import type { PendingApproval } from '@awesomeposter/shared'

interface Props {
  pending: PendingApproval
  busy?: boolean
  error?: string | null
  notes: string
  reviewer: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'update:notes', value: string): void
  (e: 'update:reviewer', value: string): void
  (e: 'approve'): void
  (e: 'reject'): void
}>()

const notesModel = computed({
  get: () => props.notes,
  set: (value: string) => emit('update:notes', value),
})

const reviewerModel = computed({
  get: () => props.reviewer,
  set: (value: string) => emit('update:reviewer', value),
})

const severityColor = computed(() => {
  const severity = props.pending.advisory?.severity
  if (severity === 'block') return 'error'
  if (severity === 'warn') return 'warning'
  return 'info'
})

const hasEvidence = computed(() => (props.pending.evidenceRefs?.length ?? 0) > 0)
const hasRoles = computed(() => (props.pending.requiredRoles?.length ?? 0) > 0)

const formattedRoles = computed(() =>
  (props.pending.requiredRoles || []).map((role) => {
    switch (role) {
      case 'marketing_manager':
        return 'Marketing'
      case 'legal':
        return 'Legal'
      case 'compliance':
        return 'Compliance'
      case 'executive':
        return 'Executive'
      default:
        return role
    }
  })
)
</script>

<template>
  <v-alert
    type="info"
    variant="tonal"
    border="start"
    color="primary"
    class="approval-banner"
    data-testid="approval-banner"
  >
    <template #title>
      Awaiting approval &mdash; {{ pending.reason }}
    </template>

    <div class="text-body-2 mb-2">
      Requested by <strong>{{ pending.requestedBy }}</strong>
      <span v-if="pending.requestedAt"> on {{ new Date(pending.requestedAt).toLocaleString() }}</span>
    </div>

    <v-alert
      v-if="pending.advisory"
      :type="severityColor"
      variant="outlined"
      border="start"
      class="mb-3"
      density="comfortable"
      data-testid="approval-advisory"
    >
      <strong class="text-subtitle-2 d-block mb-1">Advisory</strong>
      <div class="text-body-2">{{ pending.advisory.reason }}</div>
    </v-alert>

    <div v-if="hasRoles" class="mb-3">
      <div class="text-caption text-medium-emphasis mb-1">Required roles</div>
      <div class="d-flex flex-wrap ga-2">
        <v-chip v-for="role in formattedRoles" :key="role" size="x-small" color="secondary" variant="flat">
          {{ role }}
        </v-chip>
      </div>
    </div>

    <div v-if="hasEvidence" class="mb-3">
      <div class="text-caption text-medium-emphasis mb-1">Evidence</div>
      <ul class="mb-0 ps-4 text-body-2" data-testid="approval-evidence">
        <li v-for="ref in pending.evidenceRefs" :key="ref">{{ ref }}</li>
      </ul>
    </div>

    <v-text-field
      v-model="reviewerModel"
      label="Reviewer name (optional)"
      density="comfortable"
      variant="outlined"
      class="mb-2"
      :disabled="busy"
      data-testid="approval-reviewer"
    />

    <v-textarea
      v-model="notesModel"
      label="Decision notes (optional)"
      auto-grow
      rows="2"
      density="comfortable"
      variant="outlined"
      class="mb-3"
      :disabled="busy"
      data-testid="approval-notes"
    />

    <div class="d-flex flex-wrap align-center ga-2">
      <v-btn color="success" @click="emit('approve')" :disabled="busy" data-testid="approval-approve">
        <v-icon icon="mdi-check" class="me-1" /> Approve
      </v-btn>
      <v-btn color="error" variant="outlined" @click="emit('reject')" :disabled="busy" data-testid="approval-reject">
        <v-icon icon="mdi-close" class="me-1" /> Reject
      </v-btn>
      <v-progress-circular indeterminate size="20" class="ms-2" v-if="busy" />
    </div>

    <v-alert
      v-if="error"
      type="error"
      variant="text"
      class="mt-3"
      data-testid="approval-error"
    >
      {{ error }}
    </v-alert>
  </v-alert>
</template>

<style scoped>
.approval-banner {
  border-left-width: 6px !important;
}

.ga-2 {
  gap: 8px;
}
</style>
