<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import type { FacetWidgetProps, FacetWidgetEmits } from './types'

const props = defineProps<FacetWidgetProps>()
const emit = defineEmits<FacetWidgetEmits>()

type BriefValue = {
  objective?: string
  successCriteria?: string[]
  constraints?: string[]
  notes?: string
}

const objective = ref('')
const successCriteria = ref<string[]>([])
const constraints = ref<string[]>([])
const notes = ref('')

watch(
  () => props.modelValue,
  (value) => {
    if (value && typeof value === 'object') {
      objective.value = typeof (value as BriefValue).objective === 'string' ? (value as BriefValue).objective ?? '' : ''
      successCriteria.value = Array.isArray((value as BriefValue).successCriteria)
        ? ((value as BriefValue).successCriteria as string[]).map((entry) => entry ?? '').filter((entry) => entry.length > 0)
        : []
      constraints.value = Array.isArray((value as BriefValue).constraints)
        ? ((value as BriefValue).constraints as string[]).map((entry) => entry ?? '').filter((entry) => entry.length > 0)
        : []
      notes.value = typeof (value as BriefValue).notes === 'string' ? ((value as BriefValue).notes as string) : ''
    } else {
      objective.value = ''
      successCriteria.value = []
      constraints.value = []
      notes.value = ''
    }
  },
  { immediate: true }
)

const semantics = computed(() => {
  const details = props.definition.semantics
  if (!details) return null
  if (typeof details === 'string') return details
  return details.instruction ?? details.summary ?? null
})

function emitUpdate() {
  const payload: BriefValue = {}
  if (objective.value.trim().length) payload.objective = objective.value.trim()
  if (successCriteria.value.length) payload.successCriteria = [...successCriteria.value]
  if (constraints.value.length) payload.constraints = [...constraints.value]
  if (notes.value.trim().length) payload.notes = notes.value.trim()
  emit('update:modelValue', payload)
}

function onUpdateObjective(value: string) {
  objective.value = value
  emitUpdate()
}

function onUpdateSuccess(value: string[]) {
  successCriteria.value = value
  emitUpdate()
}

function onUpdateConstraints(value: string[]) {
  constraints.value = value
  emitUpdate()
}

function onUpdateNotes(value: string) {
  notes.value = value
  emitUpdate()
}
</script>

<template>
  <div class="brief-widget">
    <v-textarea
      :model-value="objective"
      label="Objective"
      variant="outlined"
      auto-grow
      :readonly="readonly"
      :disabled="readonly"
      @update:model-value="onUpdateObjective"
    />

    <v-combobox
      v-model="successCriteria"
      label="Success Criteria"
      multiple
      chips
      closable-chips
      variant="outlined"
      :readonly="readonly"
      :disabled="readonly"
      @update:model-value="onUpdateSuccess"
    />

    <v-combobox
      v-model="constraints"
      label="Constraints"
      multiple
      chips
      closable-chips
      variant="outlined"
      :readonly="readonly"
      :disabled="readonly"
      @update:model-value="onUpdateConstraints"
    />

    <v-textarea
      :model-value="notes"
      label="Notes"
      auto-grow
      variant="outlined"
      :readonly="readonly"
      :disabled="readonly"
      @update:model-value="onUpdateNotes"
    />

    <p v-if="semantics" class="text-caption text-medium-emphasis">
      {{ semantics }}
    </p>
  </div>
</template>

<style scoped>
.brief-widget {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
</style>
