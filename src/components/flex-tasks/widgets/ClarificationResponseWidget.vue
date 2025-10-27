<script setup lang="ts">
import { reactive, watch, computed } from 'vue'
import type { FacetWidgetProps, FacetWidgetEmits } from './types'

const props = defineProps<FacetWidgetProps>()
const emit = defineEmits<FacetWidgetEmits>()

type Attachment = {
  label: string
  uri: string
}

type ClarificationResponse = {
  questionId: string
  status: 'answered' | 'declined' | 'needs_follow_up'
  response?: string
  notes?: string
  attachments?: Attachment[]
}

type ClarificationResponsePayload = {
  responses: ClarificationResponse[]
  readyForPlanner?: boolean
  submittedAt?: string
  operatorId?: string
}

const state = reactive<ClarificationResponsePayload>({
  responses: [],
  readyForPlanner: true,
  submittedAt: '',
  operatorId: ''
})

let internalUpdate = false

type PendingQuestion = {
  id: string
  prompt: string
  required: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function extractPendingQuestions(context: unknown): PendingQuestion[] {
  if (!isRecord(context)) return []
  const metadata = context
  const currentInputsCandidate = metadata.currentInputs ?? metadata.inputs ?? null
  if (!isRecord(currentInputsCandidate)) return []
  const clarification = currentInputsCandidate.clarificationRequest
  if (!isRecord(clarification)) return []
  const pending = clarification.pendingQuestions
  if (!Array.isArray(pending) || !pending.length) return []
  return pending
    .map((entry, index) => {
      if (!isRecord(entry)) return null
      const idValue = entry.id
      const questionId =
        typeof idValue === 'string' && idValue.trim().length ? idValue.trim() : `question_${index + 1}`
      const prompt = typeof entry.question === 'string' ? entry.question : ''
      const required =
        typeof entry.required === 'boolean' ? entry.required : true
      return {
        id: questionId,
        prompt,
        required
      }
    })
    .filter((entry): entry is PendingQuestion => Boolean(entry))
}

const pendingQuestions = computed<PendingQuestion[]>(() => extractPendingQuestions(props.taskContext))
const pendingQuestionMap = computed(() => {
  const map = new Map<string, PendingQuestion>()
  pendingQuestions.value.forEach((question) => {
    map.set(question.id, question)
  })
  return map
})

function sanitizePayload(): ClarificationResponsePayload {
  const responses = state.responses
    .map((entry) => ({
      ...entry,
      attachments: entry.attachments?.filter((attachment) => attachment.label && attachment.uri)
    }))
    .filter((entry) => entry.questionId.trim().length > 0)

  const payload: ClarificationResponsePayload = {
    responses
  }

  if (typeof state.readyForPlanner === 'boolean') {
    payload.readyForPlanner = state.readyForPlanner
  }
  if (state.submittedAt && state.submittedAt.trim().length > 0) {
    payload.submittedAt = state.submittedAt.trim()
  }
  if (state.operatorId && state.operatorId.trim().length > 0) {
    payload.operatorId = state.operatorId.trim()
  }
  return payload
}

function emitUpdate() {
  internalUpdate = true
  emit('update:modelValue', sanitizePayload())
}

watch(
  () => props.modelValue,
  (value) => {
    if (internalUpdate) {
      internalUpdate = false
      return
    }
    state.responses = []
    state.readyForPlanner = true
    state.submittedAt = ''
    state.operatorId = ''

    if (value && typeof value === 'object') {
      const payload = value as ClarificationResponsePayload
      if (Array.isArray(payload.responses)) {
        state.responses = payload.responses.map((entry) => ({
          questionId: entry.questionId ?? '',
          status: entry.status ?? 'answered',
          response: entry.response ?? '',
          notes: entry.notes ?? '',
          attachments: Array.isArray(entry.attachments)
            ? entry.attachments.map((attachment) => ({
                label: attachment.label ?? '',
                uri: attachment.uri ?? ''
              }))
            : []
        }))
      }
      if (typeof payload.readyForPlanner === 'boolean') {
        state.readyForPlanner = payload.readyForPlanner
      }
      if (typeof payload.submittedAt === 'string') {
        state.submittedAt = payload.submittedAt
      }
      if (typeof payload.operatorId === 'string') {
        state.operatorId = payload.operatorId
      }
    }

    if (!state.responses.length) {
      state.responses.push({
        questionId: '',
        status: 'answered',
        response: '',
        notes: '',
        attachments: []
      })
    }

    const questions = pendingQuestions.value
    const hasPopulatedQuestion = state.responses.some((entry) =>
      typeof entry.questionId === 'string' && entry.questionId.trim().length > 0
    )
    if (questions.length && !hasPopulatedQuestion) {
      state.responses.splice(
        0,
        state.responses.length,
        ...questions.map((question) => ({
          questionId: question.id,
          status: 'answered' as ClarificationResponse['status'],
          response: '',
          notes: '',
          attachments: []
        }))
      )
    }

    emitUpdate()
  },
  { immediate: true, deep: true }
)

function addResponse() {
  state.responses.push({
    questionId: '',
    status: 'answered',
    response: '',
    notes: '',
    attachments: []
  })
  emitUpdate()
}

function removeResponse(index: number) {
  state.responses.splice(index, 1)
  if (!state.responses.length) {
    addResponse()
    return
  }
  emitUpdate()
}

function addAttachment(response: ClarificationResponse) {
  if (!response.attachments) {
    response.attachments = []
  }
  response.attachments.push({ label: '', uri: '' })
  emitUpdate()
}

function removeAttachment(response: ClarificationResponse, index: number) {
  response.attachments?.splice(index, 1)
  emitUpdate()
}

const statusItems = [
  { title: 'Answered', value: 'answered' },
  { title: 'Declined', value: 'declined' },
  { title: 'Needs follow-up', value: 'needs_follow_up' }
]

const showSubmittedAt = computed(() => Boolean(state.submittedAt))

function updateSubmittedAt(value: string | null) {
  state.submittedAt = value ?? ''
  emitUpdate()
}

function handleFieldChange() {
  emitUpdate()
}

function questionDetails(index: number, response: ClarificationResponse) {
  const normalizedId = typeof response.questionId === 'string' ? response.questionId.trim() : ''
  if (normalizedId && pendingQuestionMap.value.has(normalizedId)) {
    return pendingQuestionMap.value.get(normalizedId) ?? null
  }
  return pendingQuestions.value[index] ?? null
}
</script>

<template>
  <div class="clarification-response-widget">
    <header class="widget-header">
      <h4 class="widget-title">{{ definition.title }}</h4>
      <p class="widget-description text-body-2 text-medium-emphasis">
        {{ definition.description }}
      </p>
    </header>

    <v-alert
      v-if="definition.semantics && typeof definition.semantics !== 'string' && definition.semantics.instruction"
      type="info"
      variant="tonal"
      border="start"
      class="mb-4"
    >
      {{ definition.semantics.instruction }}
    </v-alert>

    <div class="responses">
      <v-card
        v-for="(response, index) in state.responses"
        :key="`response-${index}`"
        variant="outlined"
        class="mb-4"
      >
        <v-card-title class="d-flex align-center">
          Response {{ index + 1 }}
          <v-spacer />
          <v-btn
            v-if="state.responses.length > 1"
            icon="mdi-delete"
            variant="text"
            size="small"
            :disabled="readonly"
            @click="removeResponse(index)"
          />
        </v-card-title>
        <v-card-text class="d-flex flex-column ga-4">
          <div v-if="questionDetails(index, response)" class="question-context mb-2">
            <div class="question-header">
              <span class="question-text">
                {{ questionDetails(index, response)?.prompt || 'Pending question' }}
              </span>
              <v-chip
                v-if="questionDetails(index, response)?.required"
                size="x-small"
                color="error"
                variant="outlined"
                class="ms-2"
              >
                Required
              </v-chip>
            </div>
          </div>

          <v-text-field
            v-model="response.questionId"
            label="Question ID"
            variant="outlined"
            :readonly="readonly"
            :disabled="readonly"
            density="comfortable"
            data-test="clarification-response-question-id"
            @update:model-value="handleFieldChange"
          />

          <v-select
            v-model="response.status"
            :items="statusItems"
            label="Status"
            variant="outlined"
            density="comfortable"
            :readonly="readonly"
            :disabled="readonly"
            @update:model-value="handleFieldChange"
          />

          <v-textarea
            v-model="response.response"
            label="Response"
            auto-grow
            variant="outlined"
            :readonly="readonly"
            :disabled="readonly"
            data-test="clarification-response-response"
            @update:model-value="handleFieldChange"
          />

          <v-textarea
            v-model="response.notes"
            label="Notes (optional)"
            auto-grow
            variant="outlined"
            :readonly="readonly"
            :disabled="readonly"
            @update:model-value="handleFieldChange"
          />

          <section>
            <header class="d-flex align-center justify-space-between mb-2">
              <span class="text-subtitle-2">Attachments</span>
              <v-btn
                size="small"
                variant="text"
                color="primary"
                :disabled="readonly"
                @click="addAttachment(response)"
              >
                Add
              </v-btn>
            </header>

            <div v-if="response.attachments?.length" class="d-flex flex-column ga-3">
              <div
                v-for="(attachment, attachmentIndex) in response.attachments"
                :key="`attachment-${index}-${attachmentIndex}`"
                class="d-flex ga-2 align-center"
              >
                <v-text-field
                  v-model="attachment.label"
                  label="Label"
                  variant="outlined"
                  density="comfortable"
                  :readonly="readonly"
                  :disabled="readonly"
                  @update:model-value="handleFieldChange"
                />
                <v-text-field
                  v-model="attachment.uri"
                  label="URI"
                  variant="outlined"
                  density="comfortable"
                  :readonly="readonly"
                  :disabled="readonly"
                  @update:model-value="handleFieldChange"
                />
                <v-btn
                  icon="mdi-close"
                  variant="text"
                  size="small"
                  :disabled="readonly"
                  @click="removeAttachment(response, attachmentIndex)"
                />
              </div>
            </div>
            <p v-else class="text-caption text-medium-emphasis">
              No attachments added.
            </p>
          </section>
        </v-card-text>
      </v-card>
    </div>

    <div class="d-flex justify-start mb-4">
      <v-btn
        color="primary"
        variant="outlined"
        size="small"
        :disabled="readonly"
        data-test="clarification-response-add"
        @click="addResponse"
      >
        Add Response
      </v-btn>
    </div>

    <div class="d-flex flex-column ga-3 mb-4">
      <v-switch
        v-model="state.readyForPlanner"
        color="primary"
        inset
        label="Ready for planner"
        :readonly="readonly"
        :disabled="readonly"
        @update:model-value="handleFieldChange"
      />

      <v-text-field
        v-model="state.operatorId"
        label="Operator ID (optional)"
        variant="outlined"
        density="comfortable"
        :readonly="readonly"
        :disabled="readonly"
        @update:model-value="handleFieldChange"
      />

      <v-text-field
        v-if="showSubmittedAt"
        v-model="state.submittedAt"
        label="Submitted at (ISO timestamp)"
        variant="outlined"
        density="comfortable"
        :readonly="readonly"
        :disabled="readonly"
        @update:model-value="handleFieldChange"
      />
      <v-btn
        v-else
        size="small"
        variant="text"
        color="primary"
        :disabled="readonly"
        @click="updateSubmittedAt(new Date().toISOString())"
      >
        Stamp submitted at
      </v-btn>
      <v-btn
        v-if="showSubmittedAt && !readonly"
        size="small"
        variant="text"
        color="warning"
        @click="updateSubmittedAt(null)"
      >
        Clear submitted at
      </v-btn>
    </div>
  </div>
</template>

<style scoped>
.clarification-response-widget {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.widget-header {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.widget-title {
  font-size: 1.05rem;
  font-weight: 600;
  margin: 0;
}

.responses {
  display: flex;
  flex-direction: column;
}

.question-context {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.question-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.question-text {
  font-weight: 500;
}
</style>
