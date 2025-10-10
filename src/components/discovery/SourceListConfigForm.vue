<script setup lang="ts">
import { computed } from 'vue'
import type { PropType } from 'vue'
import type { WebListFormState, ValidationErrors } from '@/composables/discovery/useListConfig'
import type { WebListSuggestionState } from '@/stores/discoverySources'
import type { DiscoveryWebListPreviewResult } from '@awesomeposter/shared'

const props = defineProps({
  form: {
    type: Object as PropType<WebListFormState>,
    required: true,
  },
  errors: {
    type: Object as PropType<ValidationErrors>,
    required: true,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  suggestion: {
    type: Object as PropType<WebListSuggestionState | null>,
    default: null,
  },
  appliedSuggestionId: {
    type: String as PropType<string | null>,
    default: null,
  },
  previewStatus: {
    type: String as PropType<'idle' | 'loading' | 'success' | 'error'>,
    default: 'idle',
  },
  previewResult: {
    type: Object as PropType<DiscoveryWebListPreviewResult | null>,
    default: null,
  },
  previewError: {
    type: String as PropType<string | null>,
    default: null,
  },
  warnings: {
    type: Array as PropType<string[]>,
    default: () => [],
  },
})

const emit = defineEmits<{
  (e: 'check'): void
  (e: 'apply-suggestion'): void
  (e: 'discard-suggestion'): void
}>()

const listContainerErrors = computed(() => props.errors.listContainerSelector ?? [])
const itemSelectorErrors = computed(() => props.errors.itemSelector ?? [])

type FieldKey = 'title' | 'url' | 'excerpt' | 'timestamp'

const fieldOrder: FieldKey[] = ['title', 'url', 'excerpt', 'timestamp']
const fieldLabels: Record<FieldKey, string> = {
  title: 'Title',
  url: 'URL',
  excerpt: 'Excerpt',
  timestamp: 'Timestamp',
}

function selectorErrors(field: FieldKey) {
  return [
    ...(props.errors[`fields.${field}`] ?? []),
    ...(props.errors[`fields.${field}.selector`] ?? []),
  ]
}

function attributeErrors(field: FieldKey) {
  return props.errors[`fields.${field}.attribute`] ?? []
}

function transformPatternErrors(field: FieldKey) {
  return props.errors[`fields.${field}.valueTransform.pattern`] ?? []
}

function transformFlagsErrors(field: FieldKey) {
  return props.errors[`fields.${field}.valueTransform.flags`] ?? []
}

function transformReplacementErrors(field: FieldKey) {
  return props.errors[`fields.${field}.valueTransform.replacement`] ?? []
}

function transformBaseErrors(field: FieldKey) {
  return props.errors[`fields.${field}.valueTransform`] ?? []
}

const paginationSelectorErrors = computed(() => [
  ...(props.errors['pagination.nextPage'] ?? []),
  ...(props.errors['pagination.nextPage.selector'] ?? []),
])
const paginationDepthErrors = computed(() => props.errors['pagination.maxDepth'] ?? [])

const suggestionApplied = computed(() => Boolean(props.suggestion && props.appliedSuggestionId === props.suggestion.id))

function onApplySuggestion() {
  if (!props.suggestion) return
  emit('apply-suggestion')
}

function onDiscardSuggestion() {
  emit('discard-suggestion')
}

function onToggleTransform(field: FieldKey, enabled: boolean) {
  const target = props.form.fields[field]
  if (!target) return
  if (enabled && !target.valueTransformPattern.trim()) {
    target.valueTransformPattern = '^(.*)$'
  }
}
</script>

<template>
  <div class="d-flex flex-column gap-4">
    <v-switch
      v-model="form.enabled"
      color="primary"
      inset
      :disabled="disabled"
      hide-details
      label="Enable list extraction for this source"
    />

    <v-alert
      v-if="warnings.length"
      type="warning"
      variant="tonal"
      density="comfortable"
      border="start"
      border-color="warning"
    >
      <div class="text-subtitle-2 mb-1">Warnings</div>
      <ul class="ps-4 mb-0">
        <li v-for="warning in warnings" :key="warning" class="text-body-2">
          {{ warning }}
        </li>
      </ul>
    </v-alert>

    <v-alert
      v-if="suggestion"
      type="info"
      variant="tonal"
      density="comfortable"
      border="start"
      border-color="primary"
    >
      <div class="d-flex flex-column flex-md-row justify-space-between gap-3">
        <div>
          <div class="text-subtitle-2 font-weight-medium mb-1">
            Suggested selectors
            <span v-if="suggestion.confidence !== undefined && suggestion.confidence !== null" class="text-body-2">
              · Confidence {{ Math.round(suggestion.confidence * 100) }}%
            </span>
          </div>
          <p class="text-body-2 mb-2">
            Merge recommendation from configuration discovery. Apply to load selectors into the form or discard to clear.
          </p>
          <ul v-if="suggestion.warnings.length" class="ps-4 mb-0">
            <li v-for="message in suggestion.warnings" :key="message" class="text-body-2">
              {{ message }}
            </li>
          </ul>
        </div>
        <div class="d-flex gap-2 align-end">
          <v-btn
            color="primary"
            variant="flat"
            @click="onApplySuggestion"
            :disabled="Boolean(disabled || suggestionApplied)"
          >
            {{ suggestionApplied ? 'Suggestion applied' : 'Apply suggestion' }}
          </v-btn>
          <v-btn
            variant="outlined"
            color="secondary"
            @click="onDiscardSuggestion"
            :disabled="disabled"
          >
            Discard
          </v-btn>
        </div>
      </div>
    </v-alert>

    <div class="d-flex flex-column gap-3">
      <div>
        <v-text-field
          v-model="form.listContainerSelector"
          label="List container selector"
          :disabled="disabled || !form.enabled"
          :error-messages="listContainerErrors"
          hide-details="auto"
          hint="CSS selector wrapping all items in the list."
          persistent-hint
        />
      </div>
      <div>
        <v-text-field
          v-model="form.itemSelector"
          label="Item selector"
          :disabled="disabled || !form.enabled"
          :error-messages="itemSelectorErrors"
          hide-details="auto"
          hint="CSS selector targeting each list item within the container."
          persistent-hint
        />
      </div>
    </div>

    <v-divider />

    <div>
      <h3 class="text-subtitle-2 mb-3">Field mapping</h3>
      <p class="text-body-2 text-medium-emphasis mb-4">
        Leave selectors blank to fall back to default extraction. Provide only overrides that differ from defaults.
      </p>

      <template v-for="field in fieldOrder" :key="field">
        <v-row dense>
          <v-col cols="12" md="5" lg="5">
            <v-text-field
              v-model="form.fields[field].selector"
              :label="`${fieldLabels[field]} selector`"
              :disabled="disabled || !form.enabled"
              :error-messages="selectorErrors(field)"
              hide-details="auto"
            />
          </v-col>
          <v-col cols="12" md="3" lg="3">
            <v-text-field
              v-model="form.fields[field].attribute"
              :label="`${fieldLabels[field]} attribute`"
              :disabled="disabled || !form.enabled"
              :error-messages="attributeErrors(field)"
              hide-details="auto"
            />
          </v-col>
          <v-col cols="12" md="4" lg="4" class="d-flex flex-column">
            <v-switch
              v-model="form.fields[field].valueTransformEnabled"
              color="primary"
              inset
              hide-details
              label="Regex transform"
              :disabled="disabled || !form.enabled"
              @update:model-value="(value: boolean | null) => onToggleTransform(field, Boolean(value))"
            />
            <v-messages
              v-if="transformBaseErrors(field).length"
              :value="transformBaseErrors(field)"
              class="text-error mt-n2"
            />
            <div
              v-if="form.fields[field].legacyValueTemplate"
              class="text-caption text-medium-emphasis mt-2"
            >
              Legacy template:&nbsp;<code>{{ form.fields[field].legacyValueTemplate }}</code>
            </div>
            <v-alert
              v-if="form.fields[field].valueTransformWarnings.length"
              type="warning"
              variant="tonal"
              density="comfortable"
              border="start"
              border-color="warning"
              class="mt-2"
            >
              <ul class="ps-4 mb-0 text-body-2">
                <li v-for="message in form.fields[field].valueTransformWarnings" :key="message">
                  {{ message }}
                </li>
              </ul>
            </v-alert>
          </v-col>
        </v-row>
        <v-expand-transition>
          <div v-if="form.fields[field].valueTransformEnabled" class="mt-2">
            <v-row dense>
              <v-col cols="12" md="6" lg="6">
                <v-text-field
                  v-model="form.fields[field].valueTransformPattern"
                  :label="`${fieldLabels[field]} pattern`"
                  :disabled="disabled || !form.enabled"
                  :error-messages="transformPatternErrors(field)"
                  hide-details="auto"
                  hint="Regular expression evaluated after extraction."
                  persistent-hint
                />
              </v-col>
              <v-col cols="12" md="2" lg="2">
                <v-text-field
                  v-model="form.fields[field].valueTransformFlags"
                  label="Flags"
                  :disabled="disabled || !form.enabled"
                  :error-messages="transformFlagsErrors(field)"
                  hide-details="auto"
                  hint="Regex flags (e.g., i, g)."
                  persistent-hint
                />
              </v-col>
              <v-col cols="12" md="4" lg="4">
                <v-text-field
                  v-model="form.fields[field].valueTransformReplacement"
                  label="Replacement"
                  :disabled="disabled || !form.enabled"
                  :error-messages="transformReplacementErrors(field)"
                  hide-details="auto"
                  hint="Replacement string (defaults to $1 when left blank)."
                  persistent-hint
                  placeholder="$1"
                />
              </v-col>
            </v-row>
          </div>
        </v-expand-transition>
        <v-divider v-if="field !== 'timestamp'" class="my-4" />
      </template>
    </div>

    <v-divider />

    <div class="d-flex flex-column gap-3">
      <div class="d-flex align-center justify-space-between">
        <div>
          <h3 class="text-subtitle-2 mb-1">Pagination (optional)</h3>
          <p class="text-body-2 text-medium-emphasis mb-0">
            Runtime pagination is advisory only. Selectors are validated but subsequent pages are not fetched yet.
          </p>
        </div>
        <v-switch
          v-model="form.pagination.enabled"
          inset
          color="secondary"
          hide-details
          :disabled="disabled || !form.enabled"
        />
      </div>
      <div class="d-flex flex-column gap-3">
        <v-text-field
          v-model="form.pagination.nextPageSelector"
          label="Next page selector"
          :disabled="disabled || !form.enabled || !form.pagination.enabled"
          :error-messages="paginationSelectorErrors"
          hide-details="auto"
        />
        <v-text-field
          v-model.number="form.pagination.maxDepth"
          label="Max pagination depth"
          type="number"
          min="1"
          max="20"
          :disabled="disabled || !form.enabled || !form.pagination.enabled"
          :error-messages="paginationDepthErrors"
          hide-details="auto"
        />
      </div>
    </div>

    <v-divider />

    <div class="d-flex flex-column gap-2">
      <div class="d-flex align-center gap-3">
        <v-btn
          color="primary"
          variant="tonal"
          :disabled="disabled || !form.enabled"
          @click="emit('check')"
        >
          Check configuration
        </v-btn>
        <span class="text-body-2 text-medium-emphasis">
          Runs selectors against the source URL and returns the first match for verification.
        </span>
      </div>

      <v-alert
        v-if="previewStatus === 'loading'"
        type="info"
        variant="tonal"
        density="comfortable"
        class="mt-2"
      >
        Checking configuration…
      </v-alert>

      <v-alert
        v-else-if="previewStatus === 'error' && previewError"
        type="error"
        density="comfortable"
        variant="tonal"
        class="mt-2"
        :text="previewError"
      />

      <v-card
        v-else-if="previewStatus === 'success' && previewResult"
        variant="outlined"
        class="mt-2"
      >
        <v-card-title class="text-subtitle-2">Preview result</v-card-title>
        <v-card-text>
          <div v-if="previewResult.item" class="d-flex flex-column gap-2">
            <div>
              <div class="text-caption text-medium-emphasis">Title</div>
              <div class="text-body-2">{{ previewResult.item.title ?? '—' }}</div>
            </div>
            <div>
              <div class="text-caption text-medium-emphasis">URL</div>
              <div class="text-body-2 text-primary">{{ previewResult.item.url ?? '—' }}</div>
            </div>
            <div>
              <div class="text-caption text-medium-emphasis">Excerpt</div>
              <div class="text-body-2">{{ previewResult.item.excerpt ?? '—' }}</div>
            </div>
            <div>
              <div class="text-caption text-medium-emphasis">Timestamp</div>
              <div class="text-body-2">{{ previewResult.item.timestamp ?? '—' }}</div>
            </div>
          </div>
          <div v-else class="text-body-2">
            No items matched the provided selectors.
          </div>
          <div v-if="previewResult.warnings.length" class="mt-3">
            <div class="text-caption text-medium-emphasis mb-1">Warnings</div>
            <ul class="ps-4 mb-0">
              <li v-for="message in previewResult.warnings" :key="message" class="text-body-2">
                {{ message }}
              </li>
            </ul>
          </div>
        </v-card-text>
      </v-card>
    </div>
  </div>
</template>
