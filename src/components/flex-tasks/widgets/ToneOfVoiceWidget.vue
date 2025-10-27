<script setup lang="ts">
import { computed } from 'vue'
import type { FacetWidgetProps, FacetWidgetEmits } from './types'

const props = defineProps<FacetWidgetProps>()
const emit = defineEmits<FacetWidgetEmits>()

const options = computed(() => {
  const values = props.schema?.enum
  if (!Array.isArray(values)) return []
  return values
    .map((value) => (typeof value === 'string' ? value : null))
    .filter((value): value is string => value !== null)
})

const semantics = computed(() => {
  const details = props.definition.semantics
  if (!details) return null
  if (typeof details === 'string') return details
  return details.instruction ?? details.summary ?? null
})

function onUpdate(value: string | null) {
  emit('update:modelValue', value)
}
</script>

<template>
  <div class="tone-widget">
    <v-select
      :model-value="typeof modelValue === 'string' ? modelValue : null"
      :items="options"
      :label="definition.title"
      variant="outlined"
      density="comfortable"
      :readonly="readonly"
      :disabled="readonly"
      @update:model-value="onUpdate"
    />
    <p v-if="semantics" class="text-caption text-medium-emphasis mt-1">
      {{ semantics }}
    </p>
  </div>
</template>

<style scoped>
.tone-widget {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
</style>
