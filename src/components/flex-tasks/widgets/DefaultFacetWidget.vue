<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { FacetWidgetProps, FacetWidgetEmits } from './types'

const props = defineProps<FacetWidgetProps>()
const emit = defineEmits<FacetWidgetEmits>()

const schemaType = computed(() => {
  const type = props.schema?.type
  if (Array.isArray(type)) return type[0]
  return typeof type === 'string' ? type : undefined
})

const enumOptions = computed<string[]>(() => {
  const values = props.schema?.enum
  if (!Array.isArray(values)) return []
  return values
    .map((value) => (typeof value === 'string' ? value : null))
    .filter((value): value is string => value !== null)
})

const arrayValues = ref<string[]>([])
const jsonDraft = ref('')

const arrayItemsSchema = computed<Record<string, unknown> | null>(() => {
  if (schemaType.value !== 'array') return null
  const items = props.schema?.items
  return items && typeof items === 'object' ? (items as Record<string, unknown>) : null
})

const arrayItemType = computed<string | undefined>(() => {
  const items = arrayItemsSchema.value
  if (!items) return undefined
  const type = items.type
  if (Array.isArray(type)) {
    const candidate = type.find((entry) => typeof entry === 'string')
    return typeof candidate === 'string' ? candidate : undefined
  }
  return typeof type === 'string' ? type : undefined
})

const arrayStringMode = computed<boolean>(() => {
  if (schemaType.value !== 'array') return false
  if (!arrayItemsSchema.value) return true
  return arrayItemType.value === 'string'
})

watch(
  () => props.modelValue,
  (value) => {
    if (schemaType.value === 'array') {
      if (arrayStringMode.value) {
        if (Array.isArray(value)) {
          arrayValues.value = value.map((entry) => (typeof entry === 'string' ? entry : JSON.stringify(entry)))
        } else {
          arrayValues.value = []
        }
        jsonDraft.value = ''
      } else {
        try {
          jsonDraft.value = Array.isArray(value) ? JSON.stringify(value, null, 2) : ''
        } catch {
          jsonDraft.value = ''
        }
        arrayValues.value = []
      }
    } else if (schemaType.value === 'object') {
      try {
        jsonDraft.value = value ? JSON.stringify(value, null, 2) : ''
      } catch {
        jsonDraft.value = ''
      }
    }
  },
  { immediate: true }
)

function onUpdateString(value: string | null) {
  emit('update:modelValue', value)
}

function onUpdateNumber(value: string | number | null) {
  if (value === null || value === '') {
    emit('update:modelValue', null)
    return
  }
  const numeric = typeof value === 'number' ? value : Number(value)
  emit('update:modelValue', Number.isNaN(numeric) ? null : numeric)
}

function onUpdateBoolean(value: boolean) {
  emit('update:modelValue', value)
}

function onUpdateArray(value: string[]) {
  arrayValues.value = value
  emit('update:modelValue', [...value])
}

function onJsonBlur() {
  if (!jsonDraft.value.trim()) {
    emit('update:modelValue', null)
    return
  }
  try {
    const parsed = JSON.parse(jsonDraft.value)
    emit('update:modelValue', parsed)
  } catch (error) {
    console.warn('Invalid JSON in facet widget', error)
  }
}
</script>

<template>
  <div class="flex-task-widget">
    <template v-if="schemaType === 'string' && enumOptions.length">
      <v-select
        :model-value="typeof modelValue === 'string' ? modelValue : null"
        :items="enumOptions"
        :label="definition.title"
        density="comfortable"
        variant="outlined"
        :readonly="readonly"
        :disabled="readonly"
        @update:model-value="onUpdateString"
      />
    </template>

    <template v-else-if="schemaType === 'string'">
      <v-textarea
        :model-value="typeof modelValue === 'string' ? modelValue : ''"
        :label="definition.title"
        :rows="4"
        variant="outlined"
        :readonly="readonly"
        :disabled="readonly"
        auto-grow
        @update:model-value="onUpdateString"
      />
    </template>

    <template v-else-if="schemaType === 'boolean'">
      <v-switch
        :model-value="Boolean(modelValue)"
        :label="definition.title"
        :readonly="readonly"
        :disabled="readonly"
        inset
        color="primary"
        @update:model-value="onUpdateBoolean"
      />
    </template>

    <template v-else-if="schemaType === 'number' || schemaType === 'integer'">
      <v-text-field
        :model-value="typeof modelValue === 'number' ? modelValue : null"
        :label="definition.title"
        type="number"
        variant="outlined"
        density="comfortable"
        :readonly="readonly"
        :disabled="readonly"
        @update:model-value="onUpdateNumber"
      />
    </template>

    <template v-else-if="schemaType === 'array' && arrayStringMode">
      <v-combobox
        v-model="arrayValues"
        :label="definition.title"
        variant="outlined"
        multiple
        chips
        closable-chips
        :readonly="readonly"
        :disabled="readonly"
        @update:model-value="onUpdateArray"
      />
    </template>

    <template v-else-if="schemaType === 'array'">
      <v-textarea
        v-model="jsonDraft"
        :label="`${definition.title} (JSON)`"
        variant="outlined"
        :rows="6"
        :readonly="readonly"
        :disabled="readonly"
        auto-grow
        @blur="onJsonBlur"
      />
    </template>

    <template v-else-if="schemaType === 'object'">
      <v-textarea
        v-model="jsonDraft"
        :label="`${definition.title} (JSON)`"
        variant="outlined"
        :rows="6"
        :readonly="readonly"
        :disabled="readonly"
        auto-grow
        @blur="onJsonBlur"
      />
    </template>

    <template v-else>
      <v-textarea
        :model-value="modelValue ? String(modelValue) : ''"
        :label="definition.title"
        variant="outlined"
        auto-grow
        :readonly="readonly"
        :disabled="readonly"
        @update:model-value="onUpdateString"
      />
    </template>

    <p class="text-caption text-medium-emphasis mt-1">
      {{ definition.description }}
    </p>
  </div>
</template>

<style scoped>
.flex-task-widget {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
</style>
