<template>
  <v-navigation-drawer
    v-model="internalOpen"
    location="right"
    width="520"
    temporary
    class="discovery-item-detail-drawer"
  >
    <v-toolbar flat density="comfortable">
      <v-toolbar-title class="text-subtitle-1">
        {{ item?.title ?? 'Discovery item detail' }}
      </v-toolbar-title>
      <v-spacer />
      <v-btn icon="mdi-close" variant="text" @click="close" />
    </v-toolbar>

    <v-divider />

    <div class="drawer-content">
      <div v-if="loading" class="pa-4">
        <v-skeleton-loader type="heading, paragraph, paragraph, list-item-two-line@3" />
      </div>

      <div v-else-if="error" class="pa-4 d-flex flex-column gap-4">
        <v-alert type="error" variant="tonal">
          {{ error }}
        </v-alert>
        <v-btn color="primary" variant="tonal" class="text-none align-self-start" @click="emit('reload')">
          Retry
        </v-btn>
      </div>

      <div v-else-if="item" class="pa-4 d-flex flex-column gap-4">
        <section class="d-flex flex-column gap-2">
          <div class="d-flex flex-column gap-1">
            <div class="d-flex flex-wrap gap-2 align-center">
              <v-chip color="primary" variant="tonal" size="small">
                {{ formatStatus(item.status) }}
              </v-chip>
              <v-chip v-if="scoreLabel" color="secondary" variant="tonal" size="small">
                {{ scoreLabel }}
              </v-chip>
            </div>
            <div class="text-caption text-medium-emphasis">
              Fetched {{ formatTimestamp(item.fetchedAt) }} · Ingested {{ formatTimestamp(item.ingestedAt) }}
            </div>
          </div>
          <div class="text-body-2" v-if="item.summary">
            {{ item.summary }}
          </div>
          <div class="text-body-2" v-else-if="item.body">
            {{ truncateBody(item.body) }}
          </div>
        </section>

        <section class="d-flex flex-column gap-3">
          <div class="text-subtitle-2">Source</div>
          <div class="text-body-2">
            <div>{{ item.source.name ?? 'Unknown source' }}</div>
            <div class="text-caption text-medium-emphasis">
              {{ capitalize(item.source.type.replace(/[_-]/g, ' ')) }}
            </div>
            <div v-if="item.source.url" class="mt-1">
              <a :href="item.source.url" target="_blank" rel="noopener" class="text-body-2">
                Visit source
              </a>
            </div>
          </div>
        </section>

        <section class="d-flex flex-column gap-3">
          <div class="text-subtitle-2">Score details</div>
          <div class="d-flex flex-wrap gap-2">
            <v-chip v-for="detail in scoreChips" :key="detail.label" variant="outlined" size="small">
              {{ detail.label }}
            </v-chip>
          </div>
        </section>

        <section v-if="item.topics.length" class="d-flex flex-column gap-3">
          <div class="text-subtitle-2">Topics</div>
          <div class="d-flex flex-wrap gap-2">
            <v-chip v-for="topic in item.topics" :key="topic" variant="tonal" color="secondary" size="x-small">
              {{ topic }}
            </v-chip>
          </div>
        </section>

        <section class="d-flex flex-column gap-3">
          <div class="text-subtitle-2">Status history</div>
          <v-list density="comfortable" lines="two">
            <v-list-item
              v-for="entry in item.statusHistory"
              :key="entry.id"
              :title="historyTitle(entry)"
              :subtitle="historySubtitle(entry)"
            >
              <template #prepend>
                <v-avatar color="primary" variant="tonal" size="32">
                  <span class="text-caption">{{ initials(entry.actorName) }}</span>
                </v-avatar>
              </template>
            </v-list-item>
          </v-list>
        </section>

        <section class="d-flex flex-column gap-3">
          <div class="d-flex justify-space-between align-center">
            <div class="text-subtitle-2">Promotion</div>
            <v-btn
              v-if="item.briefRef"
              variant="text"
              size="small"
              class="text-none"
              color="primary"
              @click="emit('open-brief')"
            >
              Open brief
            </v-btn>
          </div>

          <div v-if="isPromoted" class="text-body-2">
            <template v-if="item.briefRef">
              This discovery item was promoted. Use the button above to edit the brief.
            </template>
            <template v-else>
              The discovery item was promoted. There is no link to the brief (deleted?).
            </template>
          </div>

          <v-form v-else ref="form" @submit.prevent="submit">
            <v-textarea
              v-model="note"
              label="Required promotion note"
              :rules="noteRules"
              :disabled="promotionLoading"
              auto-grow
              rows="3"
              counter="2000"
              hide-details="auto"
              @input="emit('clear-error')"
            />
            <v-alert v-if="promotionError" type="error" variant="tonal" density="comfortable" class="mt-2">
              {{ promotionError }}
            </v-alert>
            <div class="d-flex justify-end mt-3">
              <v-btn
                color="primary"
                type="submit"
                :loading="promotionLoading"
                class="text-none"
              >
                Promote to Brief
              </v-btn>
            </div>
          </v-form>
        </section>
      </div>

      <div v-else class="pa-4 text-body-2 text-medium-emphasis">
        Select a discovery item to view its details.
      </div>
    </div>
  </v-navigation-drawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { DiscoveryItemDetail } from '@awesomeposter/shared'

const props = defineProps({
  modelValue: { type: Boolean, required: true },
  loading: { type: Boolean, default: false },
  error: { type: String, default: null },
  item: { type: Object as () => DiscoveryItemDetail | null, default: null },
  promotionLoading: { type: Boolean, default: false },
  promotionError: { type: String, default: null },
})

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'reload'): void
  (event: 'promote', note: string): void
  (event: 'open-brief'): void
  (event: 'clear-error'): void
}>()

const internalOpen = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const form = ref<{ validate: () => Promise<{ valid: boolean }> } | null>(null)
const note = ref('')

const noteRules = [
  (value: string) => (value?.trim().length ?? 0) >= 5 || 'Enter at least 5 characters.',
  (value: string) => (/^[\x20-\x7E\r\n\t]*$/u).test(value ?? '') || 'Use ASCII characters only.',
]

watch(
  () => props.item?.id,
  () => {
    note.value = ''
  },
)

const isPromoted = computed(() => props.item?.status === 'promoted')

const scoreLabel = computed(() => {
  const total = props.item?.score.total
  if (typeof total !== 'number') {
    return null
  }
  return `${(total * 100).toFixed(1)}% score`
})

const scoreChips = computed(() => {
  if (!props.item) return []
  const chips: Array<{ label: string }> = []
  const { score } = props.item
  if (typeof score.keyword === 'number') {
    chips.push({ label: `Keyword ${(score.keyword * 100).toFixed(0)}%` })
  }
  if (typeof score.recency === 'number') {
    chips.push({ label: `Recency ${(score.recency * 100).toFixed(0)}%` })
  }
  if (typeof score.source === 'number') {
    chips.push({ label: `Source ${(score.source * 100).toFixed(0)}%` })
  }
  if (typeof score.appliedThreshold === 'number') {
    chips.push({ label: `Threshold ${(score.appliedThreshold * 100).toFixed(0)}%` })
  }
  return chips
})

function formatStatus(status: string) {
  switch (status) {
    case 'promoted':
      return 'Promoted'
    case 'suppressed':
      return 'Suppressed'
    case 'archived':
      return 'Archived'
    case 'pending_scoring':
      return 'Pending scoring'
    case 'scored':
      return 'Spotted'
    default:
      return status
  }
}

function formatTimestamp(iso: string | null) {
  if (!iso) return 'Unknown'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function historyTitle(entry: DiscoveryItemDetail['statusHistory'][number]) {
  const next = formatStatus(entry.nextStatus)
  return `${next} · ${entry.actorName}`
}

function historySubtitle(entry: DiscoveryItemDetail['statusHistory'][number]) {
  const timestamp = formatTimestamp(entry.occurredAt)
  return entry.note ? `${entry.note} · ${timestamp}` : timestamp
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'R'
}

function capitalize(value: string) {
  return value.replace(/\b\w/g, (char: string) => char.toUpperCase())
}

function truncateBody(body: string) {
  if (body.length <= 600) {
    return body
  }
  return `${body.slice(0, 600).trimEnd()}…`
}

async function submit() {
  if (props.promotionLoading) {
    return
  }
  const result = await form.value?.validate()
  if (result?.valid) {
    emit('promote', note.value.trim())
  }
}

function close() {
  emit('update:modelValue', false)
}
</script>

<style scoped>
.drawer-content {
  height: 100%;
  overflow-y: auto;
}

.discovery-item-detail-drawer :deep(.v-navigation-drawer__content) {
  display: flex;
  flex-direction: column;
}
</style>
