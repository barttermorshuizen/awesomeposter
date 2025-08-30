<script setup lang="ts">
import { ref, reactive, nextTick, computed } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

// Basics
const name = ref('')
const slug = ref('')
const website = ref('')
const industry = ref('')

// Tone & Profile
const primaryLanguage = ref<string>('')
const tonePreset = ref<string>('')
const toneGuidelines = ref('')
const objectivePrimary = ref('')
const audienceSegments = ref('')
const defaultPlatform = ref<string>('linkedin')

// Assets
const logoFile = ref<File | null>(null)
const refDocFile = ref<File | null>(null)

const submitting = ref(false)
const errors = reactive<Record<string, string>>({})

const languageItems = [
  { title: 'Nederlands', value: 'Nederlands' },
  { title: 'UK English', value: 'UK English' },
  { title: 'US English', value: 'US English' },
  { title: 'Français', value: 'Francais' },
]

const toneItems = [
  { title: 'Professional', value: 'Professional' },
  { title: 'Friendly', value: 'Friendly' },
  { title: 'Bold', value: 'Bold' },
]

const platformItems = [
  { title: 'LinkedIn', value: 'linkedin' },
]

// Helpers for Vuetify error-messages prop
const nameErrors = computed(() => (errors.name ? [errors.name] : []))
const slugErrors = computed(() => (errors.slug ? [errors.slug] : []))
const objectiveErrors = computed(() => (errors.objectivePrimary ? [errors.objectivePrimary] : []))
const audienceErrors = computed(() => (errors.audienceSegments ? [errors.audienceSegments] : []))
const languageErrors = computed(() => (errors.primaryLanguage ? [errors.primaryLanguage] : []))
const toneErrors = computed(() => (errors.tonePreset ? [errors.tonePreset] : []))
const platformErrors = computed(() => (errors.defaultPlatform ? [errors.defaultPlatform] : []))

function validateForm(): boolean {
  Object.keys(errors).forEach(k => delete errors[k])

  if (!name.value.trim()) errors.name = 'Name is required'
  if (!slug.value.trim()) {
    errors.slug = 'Slug is required'
  } else if (!/^[a-z0-9-]+$/.test(slug.value.trim())) {
    errors.slug = 'Use lowercase letters, numbers and hyphens only'
  }

  if (!primaryLanguage.value) errors.primaryLanguage = 'Select a primary communication language'
  if (!tonePreset.value) errors.tonePreset = 'Select a tone of voice'
  if (!objectivePrimary.value.trim()) errors.objectivePrimary = 'Primary objective is required'
  if (!audienceSegments.value.trim()) errors.audienceSegments = 'Audience segments are required'
  if (!defaultPlatform.value) errors.defaultPlatform = 'Select a default platform'

  return Object.keys(errors).length === 0
}

async function focusFirstError() {
  await nextTick()
  const order = [
    { key: 'name', selector: '#field-name input' },
    { key: 'slug', selector: '#field-slug input' },
    { key: 'primaryLanguage', selector: '#field-language .v-radio-group' },
    { key: 'tonePreset', selector: '#field-tone .v-radio-group' },
    { key: 'objectivePrimary', selector: '#field-objective input' },
    { key: 'audienceSegments', selector: '#field-audience input' },
    { key: 'defaultPlatform', selector: '#field-platform .v-radio-group' },
  ] as const
  for (const it of order) {
    if (errors[it.key]) {
      const el = document.querySelector<HTMLInputElement | HTMLDivElement>(it.selector)
      el?.focus?.()
      break
    }
  }
}

async function createClient(): Promise<string> {
  const res = await fetch('/api/clients', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: name.value.trim(),
      website: website.value.trim() || undefined,
      industry: industry.value.trim() || undefined,
      // server currently ignores slug on create; we will set it in a separate PATCH
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data?.id) {
    throw new Error(data?.error || 'Failed to create client')
  }
  return data.id as string
}

async function setClientSlug(clientId: string) {
  const trimmed = slug.value.trim()
  if (!trimmed) return
  const res = await fetch('/api/clients/update-client', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      clientId,
      slug: trimmed,
    }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data?.statusMessage || data?.error || 'Failed to set slug')
  }
}

async function upsertProfile(clientId: string) {
  const objectives = { primary: objectivePrimary.value.trim() }
  const audiences = { segments: audienceSegments.value.split(',').map(s => s.trim()).filter(Boolean) }
  const tone = { preset: tonePreset.value, guidelines: toneGuidelines.value.trim() || undefined }
  const platformPrefs = defaultPlatform.value ? { [defaultPlatform.value]: {} } as Record<string, unknown> : {}

  const res = await fetch(`/api/clients/${clientId}/profile`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      primaryCommunicationLanguage: primaryLanguage.value,
      objectives,
      audiences,
      tone,
      platformPrefs,
    }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data?.statusMessage || data?.error || 'Failed to save profile')
  }
}

async function uploadAsset(clientId: string, file: File) {
  const fd = new FormData()
  fd.append('clientId', clientId)
  fd.append('file', file)
  const res = await fetch('/api/assets/upload', { method: 'POST', body: fd })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data?.statusMessage || data?.error || 'Asset upload failed')
  }
}

async function onSave() {
  if (!validateForm()) {
    await focusFirstError()
    return
  }

  submitting.value = true
  try {
    // 1) Create client
    const clientId = await createClient()

    // 2) Set slug (server create doesn’t accept slug yet)
    await setClientSlug(clientId)

    // 3) Upsert profile
    await upsertProfile(clientId)

    // 4) Upload optional assets
    if (logoFile.value) {
      await uploadAsset(clientId, logoFile.value)
    }
    if (refDocFile.value) {
      await uploadAsset(clientId, refDocFile.value)
    }

    // 5) Navigate back to list
    router.push({ name: 'clients', query: { created: '1' } })
  } catch (e: unknown) {
    // Show a simple blocking alert. Could be replaced by snackbar/toast if desired.
    alert((e as Error)?.message || 'Unknown error while saving')
  } finally {
    submitting.value = false
  }
}

function onCancel() {
  router.push({ name: 'clients' })
}
</script>

<template>
  <v-container class="py-8">
    <v-row class="align-center mb-4">
      <v-col cols="12" md="6" class="d-flex align-center">
        <v-icon icon="mdi-account-plus-outline" class="me-2" />
        <h1 class="text-h5 text-md-h4 mb-0">New Client</h1>
      </v-col>
      <v-col cols="12" md="6" class="d-flex justify-end">
        <v-btn variant="tonal" color="default" class="me-2" @click="onCancel">
          Cancel
        </v-btn>
        <v-btn color="primary" :loading="submitting" @click="onSave">
          <v-icon icon="mdi-check" class="me-1" /> Save
        </v-btn>
      </v-col>
    </v-row>

    <!-- Client basics -->
    <v-card class="mb-6" elevation="2">
      <v-card-title class="text-subtitle-1 font-weight-medium">Client basics</v-card-title>
      <v-card-text>
        <v-row>
          <v-col cols="12" md="6">
            <div id="field-name">
              <v-text-field
                v-model="name"
                label="Name"
                placeholder="Acme Inc"
                variant="outlined"
                density="comfortable"
                :error-messages="nameErrors"
                required
                hide-details="auto"
              />
            </div>
          </v-col>
          <v-col cols="12" md="6">
            <div id="field-slug">
              <v-text-field
                v-model="slug"
                label="Slug"
                placeholder="acme"
                hint="Lowercase, numbers and hyphens"
                persistent-hint
                variant="outlined"
                density="comfortable"
                :error-messages="slugErrors"
                required
                hide-details="auto"
              />
            </div>
          </v-col>
          <v-col cols="12" md="6">
            <v-text-field
              v-model="website"
              label="Website"
              placeholder="https://acme.com"
              variant="outlined"
              density="comfortable"
              hide-details="auto"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-text-field
              v-model="industry"
              label="Industry"
              placeholder="SaaS"
              variant="outlined"
              density="comfortable"
              hide-details="auto"
            />
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- Tone & Profile -->
    <v-card class="mb-6" elevation="2">
      <v-card-title class="text-subtitle-1 font-weight-medium">Tone & Profile</v-card-title>
      <v-card-text>
        <v-row>
          <v-col cols="12" md="6">
            <div id="field-language">
              <v-radio-group
                v-model="primaryLanguage"
                inline
                :error-messages="languageErrors"
              >
                <template #label>
                  <span class="text-body-2">Primary communication language</span>
                </template>
                <v-radio
                  v-for="opt in languageItems"
                  :key="opt.value"
                  :label="opt.title"
                  :value="opt.value"
                />
              </v-radio-group>
            </div>
          </v-col>
          <v-col cols="12" md="6">
            <div id="field-tone">
              <v-radio-group
                v-model="tonePreset"
                inline
                :error-messages="toneErrors"
              >
                <template #label>
                  <span class="text-body-2">Tone of voice</span>
                </template>
                <v-radio
                  v-for="opt in toneItems"
                  :key="opt.value"
                  :label="opt.title"
                  :value="opt.value"
                />
              </v-radio-group>
            </div>
          </v-col>
          <v-col cols="12" md="6">
            <v-textarea
              v-model="toneGuidelines"
              label="Tone guidelines"
              placeholder="Clear, concise, confident."
              variant="outlined"
              density="comfortable"
              rows="3"
              auto-grow
              hide-details="auto"
            />
          </v-col>
          <v-col cols="12" md="6">
            <div id="field-objective">
              <v-text-field
                v-model="objectivePrimary"
                label="Primary objective"
                placeholder="Lead generation"
                variant="outlined"
                density="comfortable"
                :error-messages="objectiveErrors"
                required
                hide-details="auto"
              />
            </div>
          </v-col>
          <v-col cols="12" md="6">
            <div id="field-audience">
              <v-text-field
                v-model="audienceSegments"
                label="Audience segments (comma-separated)"
                placeholder="Founders, Product Managers"
                variant="outlined"
                density="comfortable"
                :error-messages="audienceErrors"
                required
                hide-details="auto"
              />
            </div>
          </v-col>
          <v-col cols="12" md="6">
            <div id="field-platform">
              <v-radio-group
                v-model="defaultPlatform"
                inline
                :error-messages="platformErrors"
              >
                <template #label>
                  <span class="text-body-2">Default platform</span>
                </template>
                <v-radio
                  v-for="opt in platformItems"
                  :key="opt.value"
                  :label="opt.title"
                  :value="opt.value"
                />
              </v-radio-group>
            </div>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- Brand assets -->
    <v-card class="mb-6" elevation="2">
      <v-card-title class="text-subtitle-1 font-weight-medium">Brand assets</v-card-title>
      <v-card-text>
        <v-row>
          <v-col cols="12" md="6">
            <v-file-input
              v-model="logoFile"
              label="Logo file"
              accept="image/*"
              variant="outlined"
              density="comfortable"
              prepend-icon="mdi-image-outline"
              hide-details="auto"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-file-input
              v-model="refDocFile"
              label="Reference document"
              accept="application/pdf,image/*"
              variant="outlined"
              density="comfortable"
              prepend-icon="mdi-file-document-outline"
              hide-details="auto"
            />
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <!-- Actions (duplicate at bottom for convenience on mobile) -->
    <div class="d-flex justify-end">
      <v-btn variant="tonal" color="default" class="me-2" @click="onCancel">
        Cancel
      </v-btn>
      <v-btn color="primary" :loading="submitting" @click="onSave">
        <v-icon icon="mdi-check" class="me-1" /> Save
      </v-btn>
    </div>
  </v-container>
</template>

<style scoped>
.me-1 { margin-inline-end: 4px; }
.me-2 { margin-inline-end: 8px; }
.mb-6 { margin-bottom: 24px; }
</style>