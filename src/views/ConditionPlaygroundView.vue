<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  evaluateMockCondition,
  transpileMockConditionDsl,
  type EvaluateMockConditionResult,
  type TranspileMockConditionResult,
} from '@awesomeposter/shared'
import {
  buildVariableLookup,
  createMockCatalog,
  playgroundSamples,
  playgroundVariables,
} from '@/lib/conditionPlayground/catalog'
import VueJsonPretty from 'vue-json-pretty'
import 'vue-json-pretty/lib/styles.css'

const catalog = createMockCatalog()
const variableLookup = buildVariableLookup()

interface VariableOption {
  id: string
  identifier: string
  label: string
  type: string
  group: string
  description?: string
}

const variableOptions: readonly VariableOption[] = playgroundVariables.map((variable) => ({
  id: variable.id,
  identifier: variable.path,
  label: variable.label,
  type: variable.type,
  group: variable.group,
  description: variable.description,
}))

const dslExpression = ref('qaFindings.overallScore < 0.6 && qaFindings.flagsCount > 2')
const activeVariableId = ref<string | null>(null)
const selectedSampleId = ref(playgroundSamples[0]?.id ?? '')
const editorRef = ref<{ $el: HTMLElement } | null>(null)

const transpileResult = ref<TranspileMockConditionResult | null>(null)
const evaluationResult = ref<EvaluateMockConditionResult | null>(null)

const snackbarOpen = ref(false)
const snackbarMessage = ref('')
const snackbarColor = ref<'success' | 'info' | 'warning' | 'error'>('success')

const selectedSample = computed(() => {
  return playgroundSamples.find((sample) => sample.id === selectedSampleId.value) ?? playgroundSamples[0]
})

const activeVariable = computed(() => {
  return activeVariableId.value ? variableLookup.get(activeVariableId.value) ?? null : null
})

const transpileError = computed(() => {
  const result = transpileResult.value
  if (result && !result.ok) {
    return result.error
  }
  return null
})

const transpileWarnings = computed(() => {
  const result = transpileResult.value
  if (result && result.ok) {
    return result.warnings
  }
  return []
})

const jsonLogicObject = computed(() => {
  const result = transpileResult.value
  if (result && result.ok) {
    return result.jsonLogic
  }
  return null
})

const jsonLogicPreview = computed(() => {
  const object = jsonLogicObject.value
  return object ? JSON.stringify(object, null, 2) : ''
})

const evaluationSummary = computed(() => {
  const result = evaluationResult.value
  if (!result) return null
  if (!result.ok) {
    return { status: 'error' as const, message: result.error }
  }
  const matchedVariables = Object.entries(result.resolvedVariables)
    .map(([key, value]) => `${key}: ${formatValue(value)}`)
    .join(', ')
  return {
    status: result.result ? ('success' as const) : ('warning' as const),
    message: result.result
      ? `Expression evaluates to true for "${selectedSample.value?.label}".`
      : `Expression evaluates to false for "${selectedSample.value?.label}".`,
    details: matchedVariables,
  }
})

function runTranspile(): void {
  const result = transpileMockConditionDsl(dslExpression.value, catalog)
  transpileResult.value = result
  if (result.ok) {
    const sample = selectedSample.value
    if (sample) {
      evaluationResult.value = evaluateMockCondition(result.jsonLogic, sample.payload)
    } else {
      evaluationResult.value = null
    }
  } else {
    evaluationResult.value = null
  }
}

watch([dslExpression, selectedSampleId], () => {
  runTranspile()
})

runTranspile()

function insertVariable(path: string): void {
  const editor = editorRef.value?.$el?.querySelector('textarea') as HTMLTextAreaElement | null
  if (!editor) {
    dslExpression.value = dslExpression.value ? `${dslExpression.value} ${path}` : path
    return
  }

  const { selectionStart, selectionEnd } = editor
  const before = dslExpression.value.slice(0, selectionStart)
  const after = dslExpression.value.slice(selectionEnd)
  const insertion = path
  dslExpression.value = `${before}${insertion}${after}`

  nextTick(() => {
    const cursor = selectionStart + insertion.length
    editor.focus()
    editor.setSelectionRange(cursor, cursor)
  })
}

function handleInsertVariable(): void {
  if (!activeVariable.value) return
  insertVariable(activeVariable.value.path)
  showSnackbar(`Inserted ${activeVariable.value.path}`, 'info')
}

function showSnackbar(message: string, color: 'success' | 'info' | 'warning' | 'error'): void {
  snackbarMessage.value = message
  snackbarColor.value = color
  snackbarOpen.value = true
}

async function copyExpression(): Promise<void> {
  await copyToClipboard(dslExpression.value, 'DSL expression copied to clipboard.')
}

async function copyJsonLogic(): Promise<void> {
  if (!jsonLogicPreview.value) {
    showSnackbar('Nothing to copy yet — expression has not been parsed.', 'warning')
    return
  }
  await copyToClipboard(jsonLogicPreview.value, 'JSON-Logic preview copied to clipboard.')
}

async function copyToClipboard(text: string, successMessage: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      fallbackCopy(text)
    }
    showSnackbar(successMessage, 'success')
  } catch (error) {
    console.warn('[Condition Playground] Failed to copy text', error)
    showSnackbar('Unable to copy to clipboard in this browser.', 'error')
  }
}

function fallbackCopy(text: string): void {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'absolute'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

function handleFeedback(): void {
  console.info('[Condition Playground] Feedback stub', {
    expression: dslExpression.value,
    sample: selectedSample.value?.id,
    jsonLogic: jsonLogicPreview.value,
  })
  showSnackbar('Feedback logged to console (stub).', 'info')
}

function applySample(sampleId: string): void {
  selectedSampleId.value = sampleId
  showSnackbar(`Loaded sample "${sampleId}".`, 'info')
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `[${value.map((item) => formatValue(item)).join(', ')}]`
  if (value && typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
</script>

<template>
  <v-container class="py-8 condition-playground">
    <v-row class="align-center mb-4">
      <v-col cols="12" md="8" class="d-flex align-center">
        <v-icon icon="mdi-flask-round-bottom-outline" class="me-3" size="32" />
        <div>
          <h1 class="text-h5 text-md-h4 mb-1">Condition DSL Playground</h1>
          <p class="text-body-2 text-medium-emphasis mb-0">
            Experiment with the pilot DSL using mock variables before we wire it into Flex policies.
          </p>
        </div>
      </v-col>
      <v-col cols="12" md="4" class="d-flex justify-end">
        <v-btn color="primary" prepend-icon="mdi-send" @click="handleFeedback">
          Share feedback (stub)
        </v-btn>
      </v-col>
    </v-row>

    <v-alert type="warning" variant="tonal" class="mb-6">
      This is a pilot-only surface. Enable it locally via <code>VITE_ENABLE_CONDITION_PLAYGROUND=true</code> or
      <code>?condition_playground=1</code>. Usage notes live in <code>docs/pilots/condition-playground.md</code>.
    </v-alert>

    <v-row align="stretch" class="gy-6">
      <v-col cols="12" md="7">
        <v-card elevation="2">
          <v-card-title class="d-flex align-center justify-space-between">
            <span>DSL Expression</span>
            <v-btn size="small" variant="tonal" prepend-icon="mdi-clipboard-text-outline" @click="copyExpression">
              Copy DSL
            </v-btn>
          </v-card-title>
          <v-card-text>
            <v-textarea
              ref="editorRef"
              v-model="dslExpression"
              rows="8"
              auto-grow
              rounded="lg"
              variant="outlined"
              placeholder="qaFindings.overallScore < 0.6 && qaFindings.flagsCount > 2"
            />

            <v-divider class="my-4" />

            <v-autocomplete
              v-model="activeVariableId"
              :items="variableOptions"
              label="Autocomplete variables"
              variant="solo"
              clearable
              density="comfortable"
              item-title="identifier"
              item-value="id"
              :menu-props="{ location: 'bottom start' }"
            >
              <template #item="{ props, item }">
                <v-list-item
                  v-bind="props"
                  :title="item.raw.identifier"
                  :subtitle="item.raw.label"
                >
                  <template #prepend>
                    <v-chip label size="small" class="text-caption">{{ item.raw.group }}</v-chip>
                  </template>
                  <template #append>
                    <span class="text-caption text-medium-emphasis">{{ item.raw.type }}</span>
                  </template>
                </v-list-item>
              </template>
            </v-autocomplete>

            <v-expand-transition>
              <v-sheet
                v-if="activeVariable"
                class="mt-4 pa-4 bg-surface-variant rounded-lg"
                border
              >
                <div class="d-flex justify-space-between align-center mb-2">
                  <div>
                    <div class="text-subtitle-1">
                      {{ activeVariable.label }}
                    </div>
                    <div class="text-caption text-medium-emphasis">
                      {{ activeVariable.path }} · {{ activeVariable.type }}
                    </div>
                  </div>
                  <v-btn color="secondary" size="small" prepend-icon="mdi-plus" @click="handleInsertVariable">
                    Insert into editor
                  </v-btn>
                </div>
                <p class="text-body-2 mb-1" v-if="activeVariable.description">
                  {{ activeVariable.description }}
                </p>
                <p class="text-caption text-medium-emphasis mb-0" v-if="activeVariable.example !== undefined">
                  Example value: <code>{{ formatValue(activeVariable.example) }}</code>
                </p>
              </v-sheet>
            </v-expand-transition>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" md="5">
        <v-card elevation="2" class="mb-6">
          <v-card-title class="d-flex align-center justify-space-between">
            <span>JSON-Logic Preview</span>
            <v-btn size="small" variant="tonal" prepend-icon="mdi-content-copy" @click="copyJsonLogic">
              Copy JSON
            </v-btn>
          </v-card-title>
          <v-card-text>
            <v-alert
              v-if="transpileError"
              type="error"
              class="mb-4"
              :text="`${transpileError.message}${transpileError.position !== undefined ? ` (at ${transpileError.position})` : ''}`"
            />
            <v-alert
              v-else-if="transpileWarnings.length"
              type="warning"
              class="mb-4"
            >
              <ul class="ma-0 ps-4">
                <li v-for="warning in transpileWarnings" :key="warning" class="text-body-2">
                  {{ warning }}
                </li>
              </ul>
            </v-alert>
            <VueJsonPretty
              v-if="jsonLogicObject"
              :data="jsonLogicObject"
              :deep="2"
              :show-length="false"
              class="json-tree pa-2 rounded-lg"
            />
            <div v-else class="json-placeholder pa-4 rounded-lg bg-grey-darken-4 text-white text-body-2">
              // Start typing a DSL expression to see JSON-Logic here.
            </div>
          </v-card-text>
        </v-card>

        <v-card elevation="2">
          <v-card-title>Sample payloads</v-card-title>
          <v-card-text>
            <div class="d-flex flex-wrap gap-2 mb-4">
              <v-btn
                v-for="sample in playgroundSamples"
                :key="sample.id"
                :color="sample.id === selectedSampleId ? 'primary' : 'surface-variant'"
                size="small"
                variant="tonal"
                @click="applySample(sample.id)"
              >
                {{ sample.label }}
              </v-btn>
            </div>

            <v-alert v-if="evaluationSummary" :type="evaluationSummary.status" variant="tonal" class="mb-3">
              <div>{{ evaluationSummary.message }}</div>
              <div v-if="evaluationSummary.details" class="text-caption mt-1">
                {{ evaluationSummary.details }}
              </div>
            </v-alert>

            <details class="payload-details">
              <summary class="text-body-2 text-medium-emphasis">Preview payload JSON</summary>
              <pre class="pa-3 rounded bg-surface-variant text-body-2">{{ JSON.stringify(selectedSample?.payload, null, 2) }}</pre>
            </details>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-row class="mt-6">
      <v-col cols="12">
        <v-card elevation="1">
          <v-card-title>Variable reference</v-card-title>
          <v-card-text>
            <v-table density="comfortable">
              <thead>
                <tr>
                  <th class="text-left">Variable</th>
                  <th class="text-left">Path</th>
                  <th class="text-left">Type</th>
                  <th class="text-left">Example</th>
                  <th class="text-left">Notes</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="variable in playgroundVariables" :key="variable.id">
                  <td>{{ variable.label }}</td>
                  <td><code>{{ variable.path }}</code></td>
                  <td>{{ variable.type }}</td>
                  <td>
                    <code v-if="variable.example !== undefined">{{ formatValue(variable.example) }}</code>
                    <span v-else class="text-medium-emphasis">—</span>
                  </td>
                  <td>{{ variable.description || '—' }}</td>
                </tr>
              </tbody>
            </v-table>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </v-container>

  <v-snackbar v-model="snackbarOpen" :color="snackbarColor" timeout="2400" location="bottom right">
    {{ snackbarMessage }}
  </v-snackbar>
</template>

<style scoped>
.condition-playground .json-tree {
  background-color: #1e1e1e;
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  font-family: 'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
}

.condition-playground :deep(.vjs-tree__line) {
  font-size: 0.9rem;
}

.condition-playground .json-placeholder {
  font-family: 'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
}

.payload-details summary {
  cursor: pointer;
  outline: none;
}

.payload-details summary::marker {
  color: rgb(var(--v-theme-primary));
}
</style>
