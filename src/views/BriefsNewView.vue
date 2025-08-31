<script setup lang="ts">
import { ref, reactive, computed, nextTick, onMounted } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

// Form fields
const title = ref('')
const clientId = ref<string>('')
const objective = ref('')
const description = ref('')
const deadline = ref('')
const audienceId = ref('')

// Clients list for select
type ClientOption = { title: string; value: string }
const clientItems = ref<ClientOption[]>([])
const loadingClients = ref(false)
const clientsError = ref<string | null>(null)

async function loadClients() {
  loadingClients.value = true
  clientsError.value = null
  try {
    const res = await fetch('/api/clients', { headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const ctype = res.headers.get('content-type') || ''
    if (!ctype.includes('application/json')) {
      await res.text().catch(() => '')
      throw new Error('API returned non-JSON (likely HTML). Ensure the API server is running: npm run dev:api')
    }
    const data = await res.json()
    const items = Array.isArray(data?.items) ? data.items as Array<{ id: string; name: string }> : []
    clientItems.value = items.map((c) => ({ title: c.name, value: c.id }))
  } catch (err: unknown) {
    clientsError.value = err instanceof Error ? err.message : String(err)
  } finally {
    loadingClients.value = false
  }
}

onMounted(loadClients)

// Asset uploads (optional)
const files = ref<File[] | File | null>(null)
type UploadedAsset = { id: string; originalName?: string; url?: string; type?: string }
const uploadedAssets = ref<UploadedAsset[]>([])
const uploadingAssets = ref(false)
const assetsError = ref<string | null>(null)

async function uploadSelectedFiles(newFiles: File[] = []) {
  if (!clientId.value) {
    assetsError.value = 'Select a client before uploading assets'
    return
  }
  if (!newFiles.length) return
  assetsError.value = null
  uploadingAssets.value = true
  try {
    for (const file of newFiles) {
      const fd = new FormData()
      fd.append('clientId', clientId.value)
      fd.append('file', file)
      const res = await fetch('/api/assets/upload', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.assetId) {
        throw new Error(data?.statusMessage || data?.error || `Failed to upload ${file.name}`)
      }
      uploadedAssets.value.push({
        id: data.assetId,
        originalName: file.name,
        url: data.url,
      })
    }
  } catch (e: unknown) {
    assetsError.value = (e as Error)?.message || 'Asset upload failed'
  } finally {
    uploadingAssets.value = false
    files.value = null
  }
}

function onFilesChange(val: File[] | File | null) {
  const list = Array.isArray(val) ? val : (val ? [val] : [])
  uploadSelectedFiles(list)
}

async function removeUploadedAsset(assetId: string) {
  // Best-effort delete from server so we don't keep orphan files
  try {
    await fetch(`/api/assets/${assetId}`, { method: 'DELETE' })
  } catch { /* ignore */ }
  const idx = uploadedAssets.value.findIndex(a => a.id === assetId)
  if (idx >= 0) uploadedAssets.value.splice(idx, 1)
}

// Validation
const errors = reactive<Record<string, string>>({})

const titleErrors = computed(() => (errors.title ? [errors.title] : []))
const clientErrors = computed(() => (errors.clientId ? [errors.clientId] : []))
const objectiveErrors = computed(() => (errors.objective ? [errors.objective] : []))

function validateForm(): boolean {
  Object.keys(errors).forEach(k => delete errors[k])

  if (!title.value.trim()) errors.title = 'Title is required'
  if (!clientId.value) errors.clientId = 'Select a client'
  if (!objective.value.trim()) errors.objective = 'Objective is required'

  return Object.keys(errors).length === 0
}

async function focusFirstError() {
  await nextTick()
  const order = [
    { key: 'title', selector: '#field-title input' },
    { key: 'clientId', selector: '#field-client .v-field__input' },
    { key: 'objective', selector: '#field-objective input' },
  ] as const
  for (const it of order) {
    if (errors[it.key]) {
      const el = document.querySelector<HTMLInputElement | HTMLDivElement>(it.selector)
      el?.focus?.()
      break
    }
  }
}

const submitting = ref(false)

async function onSave() {
  if (!validateForm()) {
    await focusFirstError()
    return
  }

  submitting.value = true
  try {
    const payload = {
      clientId: clientId.value,
      title: title.value.trim(),
      description: description.value.trim() || undefined,
      objective: objective.value.trim(),
      audienceId: audienceId.value.trim() || undefined,
      deadlineAt: deadline.value ? new Date(deadline.value).toISOString() : undefined,
    }

    const res = await fetch('/api/briefs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data?.ok || !data?.brief?.id) {
      throw new Error(data?.statusMessage || data?.error || 'Failed to create brief')
    }

    const briefId: string = data.brief.id as string

    // If assets were uploaded earlier, associate them with this brief
    if (uploadedAssets.value.length > 0) {
      for (const a of uploadedAssets.value) {
        try {
          await fetch(`/api/assets/${a.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ briefId }),
          })
        } catch {
          // ignore individual failures; these can be reassociated later
        }
      }
    }

    router.push({ name: 'briefs', query: { created: '1' } })
  } catch (e: unknown) {
    alert((e as Error)?.message || 'Unknown error while saving')
  } finally {
    submitting.value = false
  }
}

function onCancel() {
  router.push({ name: 'briefs' })
}
</script>

<template>
  <v-container class="py-8">
    <v-row class="align-center mb-4">
      <v-col cols="12" md="6" class="d-flex align-center">
        <v-icon icon="mdi-file-plus-outline" class="me-2" />
        <h1 class="text-h5 text-md-h4 mb-0">New Brief</h1>
      </v-col>
      <v-col cols="12" md="6" class="d-flex justify-end">
        <v-btn variant="tonal" color="default" class="me-2" @click="onCancel">
          Cancel
        </v-btn>
        <v-btn color="primary" :loading="submitting" @click="onSave">
          <v-icon icon="mdi-check" class="me-1" /> Create
        </v-btn>
      </v-col>
    </v-row>

    <!-- Brief basics -->
    <v-card class="mb-6" elevation="2">
      <v-card-title class="text-subtitle-1 font-weight-medium">Brief basics</v-card-title>
      <v-card-text>
        <v-row>
          <v-col cols="12" md="6">
            <div id="field-title">
              <v-text-field
                v-model="title"
                label="Title"
                placeholder="Q4 Product Launch Campaign"
                variant="outlined"
                density="comfortable"
                :error-messages="titleErrors"
                required
                hide-details="auto"
              />
            </div>
          </v-col>

          <v-col cols="12" md="6">
            <div id="field-client">
              <v-select
                v-model="clientId"
                :items="clientItems"
                item-title="title"
                item-value="value"
                label="Client"
                variant="outlined"
                density="comfortable"
                :loading="loadingClients"
                :error-messages="clientErrors"
                required
                hide-details="auto"
              />
            </div>
            <v-alert
              v-if="clientsError"
              type="error"
              density="compact"
              class="mt-2"
              :text="clientsError"
            />
          </v-col>

          <v-col cols="12" md="6">
            <div id="field-objective">
              <v-text-field
                v-model="objective"
                label="Objective"
                placeholder="Increase brand awareness and drive signups"
                variant="outlined"
                density="comfortable"
                :error-messages="objectiveErrors"
                required
                hide-details="auto"
              />
            </div>
          </v-col>

          <v-col cols="12" md="6">
            <v-textarea
              v-model="description"
              label="Description"
              placeholder="Provide additional context, requirements, or campaign details..."
              variant="outlined"
              density="comfortable"
              rows="3"
              auto-grow
              hide-details="auto"
            />
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- Campaign details -->
    <v-card class="mb-6" elevation="2">
      <v-card-title class="text-subtitle-1 font-weight-medium">Campaign details</v-card-title>
      <v-card-text>
        <v-row>
          <v-col cols="12" md="6">
            <v-text-field
              v-model="audienceId"
              label="Target audience"
              placeholder="e.g., tech-savvy professionals"
              variant="outlined"
              density="comfortable"
              hide-details="auto"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-text-field
              v-model="deadline"
              type="datetime-local"
              label="Deadline"
              variant="outlined"
              density="comfortable"
              hide-details="auto"
            />
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- Assets -->
    <v-card class="mb-6" elevation="2">
      <v-card-title class="text-subtitle-1 font-weight-medium">Assets</v-card-title>
      <v-card-text>
        <v-alert
          v-if="!clientId"
          type="info"
          density="compact"
          class="mb-3"
          text="Select a client before uploading assets."
        />
        <v-file-input
          v-model="files"
          label="Upload assets"
          placeholder="Choose files to upload"
          :disabled="!clientId || uploadingAssets"
          multiple
          variant="outlined"
          density="comfortable"
          :loading="uploadingAssets"
          chips
          show-size
          accept="image/*,application/pdf,video/*,audio/*"
          @update:model-value="onFilesChange"
          hide-details="auto"
        />
        <div v-if="assetsError" class="mt-2">
          <v-alert type="error" density="compact" :text="assetsError" />
        </div>

        <div v-if="uploadedAssets.length" class="mt-4">
          <div class="text-body-2 mb-2">Uploaded</div>
          <div class="d-flex flex-wrap" style="gap: 8px;">
            <v-chip
              v-for="asset in uploadedAssets"
              :key="asset.id"
              variant="tonal"
              density="comfortable"
              closable
              @click:close="removeUploadedAsset(asset.id)"
            >
              {{ asset.originalName || asset.id }}
            </v-chip>
          </div>
        </div>
      </v-card-text>
    </v-card>
    
    <!-- Actions bottom -->
    <div class="d-flex justify-end">
      <v-btn variant="tonal" color="default" class="me-2" @click="onCancel">
        Cancel
      </v-btn>
      <v-btn color="primary" :loading="submitting" @click="onSave">
        <v-icon icon="mdi-check" class="me-1" /> Create
      </v-btn>
    </div>
  </v-container>
</template>

<style scoped>
.me-1 { margin-inline-end: 4px; }
.me-2 { margin-inline-end: 8px; }
.mb-6 { margin-bottom: 24px; }
</style>