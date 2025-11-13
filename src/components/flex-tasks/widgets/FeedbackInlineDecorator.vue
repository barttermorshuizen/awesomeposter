<script setup lang="ts">
import { computed, ref } from 'vue'
import type { FeedbackComposerPayload, FeedbackEntryDisplay, FeedbackSeverity } from './types'

const props = defineProps<{
  facetKey: string
  facetTitle?: string
  path: string
  entries: FeedbackEntryDisplay[]
  readonly?: boolean
  currentAuthor?: string | null
  showBadge?: boolean
}>()

const emit = defineEmits<{
  (e: 'submit', payload: FeedbackComposerPayload): void
  (e: 'remove', sourceIndex: number): void
}>()

const panelOpen = ref(false)
const message = ref('')
const severity = ref<FeedbackSeverity>('minor')

const severityOptions: Array<{ value: FeedbackSeverity; label: string }> = [
  { value: 'info', label: 'Info' },
  { value: 'minor', label: 'Minor' },
  { value: 'major', label: 'Major' },
  { value: 'critical', label: 'Critical' }
]

const severityColorMap: Record<FeedbackSeverity, string> = {
  info: 'info',
  minor: 'warning',
  major: 'error',
  critical: 'error'
}

const displayBadge = computed(() => props.showBadge !== false)

const unresolvedEntries = computed(() =>
  props.entries.filter((entry) => entry.resolution !== 'addressed' && entry.resolution !== 'dismissed')
)

const unresolvedCount = computed(() => unresolvedEntries.value.length)

const latestPreview = computed(() => {
  if (unresolvedEntries.value.length) {
    return unresolvedEntries.value[unresolvedEntries.value.length - 1]?.message ?? null
  }
  if (props.entries.length) {
    return props.entries[props.entries.length - 1]?.message ?? null
  }
  return null
})

const tooltipText = computed(() => latestPreview.value ?? 'Add inline feedback')

const canSubmit = computed(() => {
  if (props.readonly) return false
  return message.value.trim().length > 0
})

const hasEntries = computed(() => props.entries.length > 0)

function normalizedCurrentAuthor(): string | null {
  const value = props.currentAuthor
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function canRemoveEntry(entry: FeedbackEntryDisplay): boolean {
  const currentAuthor = normalizedCurrentAuthor()
  if (!currentAuthor || props.readonly) return false
  const entryAuthor = typeof entry.author === 'string' ? entry.author.trim() : ''
  return entryAuthor.length > 0 && entryAuthor === currentAuthor
}

function resetForm() {
  message.value = ''
  severity.value = 'minor'
}

function togglePanel() {
  if (props.readonly) return
  panelOpen.value = !panelOpen.value
  if (!panelOpen.value) {
    resetForm()
  }
}

function handleSubmit() {
  if (!canSubmit.value) return
  emit('submit', {
    facet: props.facetKey,
    path: props.path,
    message: message.value.trim(),
    severity: severity.value,
    timestamp: new Date().toISOString()
  })
  resetForm()
  panelOpen.value = false
}

function handleRemove(entry: FeedbackEntryDisplay) {
  if (!canRemoveEntry(entry)) return
  const index = typeof entry.sourceIndex === 'number' ? entry.sourceIndex : null
  if (index === null) return
  emit('remove', index)
}

function severityColor(entry: FeedbackEntryDisplay): string {
  if (!entry.severity) return 'info'
  return severityColorMap[entry.severity] ?? 'info'
}
</script>

<template>
<div class="feedback-inline-decorator" data-test="feedback-inline-decorator">
  <div class="feedback-inline-trigger">
    <v-tooltip v-if="displayBadge" location="top" open-delay="150">
      <template #activator="{ props: tooltipActivator }">
        <v-badge
          v-bind="tooltipActivator"
          :model-value="unresolvedCount > 0"
          :content="unresolvedCount"
          color="error"
          floating
          data-test="feedback-inline-badge"
        >
          <v-btn
            icon="mdi-comment-text-outline"
            variant="text"
            size="small"
            :disabled="readonly"
            data-test="feedback-inline-trigger"
            @click.stop="togglePanel"
          />
        </v-badge>
      </template>
      <span>{{ tooltipText }}</span>
    </v-tooltip>
    <v-btn
      v-else
      color="primary"
      variant="text"
      size="small"
      prepend-icon="mdi-comment-text-outline"
      :disabled="readonly"
      data-test="feedback-inline-trigger"
      class="feedback-inline-trigger-button"
      @click.stop="togglePanel"
    >
      Inline Feedback
      <v-badge
        v-if="props.entries.length"
        :content="props.entries.length"
        color="error"
        floating
        inline
        class="ms-1"
      />
    </v-btn>
  </div>

  <v-expand-transition>
    <div
      v-if="panelOpen"
      class="feedback-inline-panel"
      data-test="feedback-inline-panel"
    >
        <div class="feedback-inline-meta">
          <v-chip size="small" color="primary" variant="tonal">
            {{ facetTitle || facetKey }}
          </v-chip>
          <v-chip size="small" color="surface-variant" variant="outlined">
            {{ path }}
          </v-chip>
        </div>

        <div v-if="hasEntries" class="feedback-inline-list" data-test="feedback-inline-list">
          <div
            v-for="(entry, index) in entries"
            :key="`${entry.sourceIndex ?? index}-${entry.timestamp ?? index}`"
            class="feedback-inline-entry"
          >
            <v-chip
              size="x-small"
              class="text-capitalize"
              :color="severityColor(entry)"
              variant="flat"
              data-test="feedback-inline-entry-severity"
            >
              {{ entry.severity ?? 'info' }}
            </v-chip>
            <span class="feedback-inline-entry-text">{{ entry.message }}</span>
            <v-btn
              v-if="canRemoveEntry(entry)"
              icon="mdi-trash-can-outline"
              size="x-small"
              variant="text"
              class="feedback-inline-entry-remove"
              data-test="feedback-inline-entry-remove"
              @click.stop="handleRemove(entry)"
            />
          </div>
        </div>
        <p v-else class="feedback-inline-empty" data-test="feedback-inline-empty">
          No inline feedback yet. Use the composer below to add contextual notes.
        </p>

        <v-divider class="my-3" />

        <v-textarea
          v-model="message"
          variant="outlined"
          label="Feedback"
          auto-grow
          rows="2"
          hide-details="auto"
          data-test="feedback-inline-message"
        />
        <div class="feedback-inline-severity">
          <span class="severity-label">Severity</span>
          <v-btn-toggle
            v-model="severity"
            density="compact"
            mandatory
            data-test="feedback-inline-severity-group"
          >
            <v-btn
              v-for="option in severityOptions"
              :key="option.value"
              :value="option.value"
              size="small"
              variant="tonal"
              class="text-capitalize"
              :data-test="`feedback-inline-severity-${option.value}`"
            >
              {{ option.label }}
            </v-btn>
          </v-btn-toggle>
        </div>
        <div class="feedback-inline-composer-actions">
          <v-btn
            variant="text"
            @click="panelOpen = false"
          >
            Close
          </v-btn>
          <v-btn
            color="primary"
            :disabled="!canSubmit"
            data-test="feedback-inline-submit"
            @click="handleSubmit"
          >
            Add Feedback
          </v-btn>
        </div>
      </div>
    </v-expand-transition>
  </div>
</template>

<style scoped>
.feedback-inline-decorator {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 100%;
}

.feedback-inline-panel {
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 8px;
  padding: 0.75rem;
  background-color: rgb(var(--v-theme-surface));
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
}

.feedback-inline-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.feedback-inline-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.feedback-inline-entry {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0.25rem;
}

.feedback-inline-entry-text {
  flex: 1;
  font-size: 0.9rem;
}

.feedback-inline-entry-remove {
  margin-left: auto;
}

.feedback-inline-empty {
  font-size: 0.85rem;
  color: rgba(0, 0, 0, 0.6);
  margin: 0;
}

.feedback-inline-severity {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  margin-top: 0.75rem;
}

.severity-label {
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(0, 0, 0, 0.6);
}

.feedback-inline-composer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.feedback-inline-trigger {
  display: flex;
  justify-content: flex-end;
}

.feedback-inline-trigger-button {
  align-self: flex-end;
}

</style>
