<script setup lang="ts">
import { ref, reactive, nextTick, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import ClientDiscoverySourcesPanel from '@/components/clients/ClientDiscoverySourcesPanel.vue'
import ClientDiscoveryKeywordsPanel from '@/components/clients/ClientDiscoveryKeywordsPanel.vue'

const router = useRouter()
const route = useRoute()

const clientId = computed(() => {
  const raw = route.params.id
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) return raw[0] ?? ''
  return ''
})

// Basics
const name = ref('')
const slug = ref('')
const website = ref('')
const industry = ref('')

// Tone & Profile
const primaryLanguage = ref<string>('')
const tonePreset = ref<string>('')
const toneGuidelines = ref('')
const specialInstructions = ref('')
const objectivePrimary = ref('')
const audienceSegments = ref('')
const defaultPlatform = ref<string>('linkedin')

 // Assets (optional uploads to append to client)
const logoFile = ref<File | null>(null)
const refDocFile = ref<File | null>(null)

type AssetItem = { id: string; url: string; type?: string | null; originalName?: string | null; filename?: string | null }
const assetsList = ref<AssetItem[]>([])
const assetsLoading = ref(false)
const assetsError = ref<string | null>(null)
const deletingAsset: Record<string, boolean> = reactive({})

const submitting = ref(false)
const loading = ref(true)
const loadError = ref<string | null>(null)
const errors = reactive<Record<string, string>>({})
const discoveryTab = ref<'sources' | 'keywords'>('sources')

const languageItems = [
  { title: 'Nederlands', value: 'Nederlands' },
  { title: 'UK English', value: 'UK English' },
  { title: 'US English', value: 'US English' },
  { title: 'Français', value: 'Francais' },
]

const toneItems = [
  { title: 'Professional & Formal', value: 'Professional & Formal' },
  { title: 'Clear & Straightforward', value: 'Clear & Straightforward' },
  { title: 'Warm & Friendly', value: 'Warm & Friendly' },
  { title: 'Confident & Bold', value: 'Confident & Bold' },
  { title: 'Inspiring & Visionary', value: 'Inspiring & Visionary' },
  { title: 'Trusted & Reassuring', value: 'Trusted & Reassuring' },
  { title: 'Energetic & Dynamic', value: 'Energetic & Dynamic' },
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

async function loadData() {
  const id = route.params.id as string
  loading.value = true
  loadError.value = null
  try {
    // Load client
    const resClient = await fetch(`/api/clients/${id}`, { headers: { accept: 'application/json' } })
    if (!resClient.ok) throw new Error(`HTTP ${resClient.status}`)
    const ctype1 = resClient.headers.get('content-type') || ''
    if (!ctype1.includes('application/json')) {
      await resClient.text().catch(() => '')
      throw new Error('API returned non-JSON (likely HTML). Ensure the API server is running: npm run dev:api')
    }
    const dataClient = await resClient.json()
    const c = dataClient?.client || {}
    name.value = c.name || ''
    slug.value = c.slug || ''
    website.value = c.website || ''
    industry.value = c.industry || ''

    // Load profile
    const resProfile = await fetch(`/api/clients/${id}/profile`, { headers: { accept: 'application/json' } })
    if (!resProfile.ok) throw new Error(`HTTP ${resProfile.status}`)
    const ctype2 = resProfile.headers.get('content-type') || ''
    if (!ctype2.includes('application/json')) {
      await resProfile.text().catch(() => '')
      throw new Error('API returned non-JSON (likely HTML). Ensure the API server is running: npm run dev:api')
    }
    const dataProfile = await resProfile.json()
    const p = dataProfile?.profile || {}

    primaryLanguage.value = p.primaryLanguage || ''

    const tone = p.tone || {}
    tonePreset.value = tone.preset || ''
    toneGuidelines.value = tone.guidelines || ''
    const si = p.specialInstructions || {}
    specialInstructions.value = si.instructions || ''

    const objectives = p.objectives || {}
    objectivePrimary.value = (objectives.primary ?? '') as string

    const audiences = p.audiences || {}
    const segs = Array.isArray(audiences.segments) ? audiences.segments : []
    audienceSegments.value = segs.join(', ')

    const prefs = p.platformPrefs || {}
    const firstPlatform = Object.keys(prefs)[0]
    defaultPlatform.value = firstPlatform || 'linkedin'

    // Load existing brand assets
    assetsLoading.value = true
    assetsError.value = null
    try {
      const resAssets = await fetch(`/api/assets?clientId=${id}`, { headers: { accept: 'application/json' } })
      if (!resAssets.ok) {
        const text = await resAssets.text().catch(() => '')
        throw new Error(`Assets HTTP ${resAssets.status}${text ? `: ${text.slice(0,120)}` : ''}`)
      }
      const dataA = await resAssets.json().catch(() => ({}))
      assetsList.value = Array.isArray(dataA?.assets) ? dataA.assets : []
    } catch (e: unknown) {
      assetsError.value = e instanceof Error ? e.message : String(e)
    } finally {
      assetsLoading.value = false
    }
  } catch (err: unknown) {
    loadError.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

onMounted(loadData)

async function updateClient() {
  const id = route.params.id as string
  const res = await fetch('/api/clients/update-client', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      clientId: id,
      name: name.value.trim(),
      slug: slug.value.trim(),
      website: website.value.trim() || undefined,
      industry: industry.value.trim() || undefined,
      profile: {
        primaryCommunicationLanguage: primaryLanguage.value,
        objectives: { primary: objectivePrimary.value.trim() },
        audiences: {
          segments: audienceSegments.value.split(',').map(s => s.trim()).filter(Boolean)
        },
        tone: {
          preset: tonePreset.value,
          guidelines: toneGuidelines.value.trim() || undefined
        },
        specialInstructions: { instructions: specialInstructions.value.trim() },
        platformPrefs: defaultPlatform.value ? { [defaultPlatform.value]: {} } : {}
      }
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data?.statusMessage || data?.error || 'Failed to update client')
  }
}

async function uploadAsset(clientId: string, file: File): Promise<{ assetId: string; url: string }> {
  const fd = new FormData()
  fd.append('clientId', clientId)
  fd.append('file', file)
  const res = await fetch('/api/assets/upload', { method: 'POST', body: fd })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data?.statusMessage || data?.error || 'Asset upload failed')
  }
  // Server returns { ok: true, url, assetId }
  const assetId = data?.assetId
  const url = data?.url
  if (!assetId || !url) {
    throw new Error('Upload succeeded but missing assetId/url in response')
  }
  return { assetId, url }
}

async function onDeleteAsset(a: AssetItem) {
  if (!a?.id) return
  if (!confirm('Remove this asset? This cannot be undone.')) return
  deletingAsset[a.id] = true
  try {
    const res = await fetch(`/api/assets/${a.id}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(data?.statusMessage || data?.error || 'Failed to delete asset')
    }
    assetsList.value = assetsList.value.filter(x => x.id !== a.id)
  } catch (e: unknown) {
    alert((e as Error)?.message || 'Unknown error while deleting asset')
  } finally {
    deletingAsset[a.id] = false
  }
}

async function onSave() {
  if (!validateForm()) {
    await focusFirstError()
    return
  }

  submitting.value = true
  try {
    const id = route.params.id as string

    // 1) Update client + profile
    await updateClient()

    // 2) Upload selected assets and reflect in UI immediately
    if (logoFile.value) {
      const f = logoFile.value
      const { assetId, url } = await uploadAsset(id, f)
      assetsList.value.unshift({ id: assetId, url, type: 'image', originalName: f.name })
      logoFile.value = null
    }
    if (refDocFile.value) {
      const f = refDocFile.value
      const { assetId, url } = await uploadAsset(id, f)
      assetsList.value.unshift({ id: assetId, url, type: 'document', originalName: f.name })
      refDocFile.value = null
    }

    // 3) Uploaded assets are already persisted and linked to the client by the upload endpoint.
    //    No additional PATCH is required here to avoid duplicate/invalid rows.

    // 4) Navigate back to list
    router.push({ name: 'clients', query: { updated: '1' } })
  } catch (e: unknown) {
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
        <v-icon icon="mdi-account-edit-outline" class="me-2" />
        <h1 class="text-h5 text-md-h4 mb-0">Edit Client</h1>
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

    <v-alert
      v-if="loadError"
      type="error"
      density="comfortable"
      class="mb-4"
      :text="loadError"
    />

    <v-progress-linear
      v-if="loading"
      indeterminate
      color="primary"
      class="mb-4"
    />

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
          <v-col cols="12">
            <v-textarea
              v-model="specialInstructions"
              label="Special instructions for the agent"
              placeholder="Any constraints, brand do's/don'ts, must-include or must-avoid phrases, compliance notes, etc."
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

    <!-- Discovery configuration -->
    <v-card class="mb-6" elevation="2">
      <v-card-title class="text-subtitle-1 font-weight-medium">Discovery configuration</v-card-title>
      <v-card-text>
        <v-tabs v-model="discoveryTab" class="mb-4" density="comfortable">
          <v-tab value="sources" prepend-icon="mdi-book-open-variant">Sources</v-tab>
          <v-tab value="keywords" prepend-icon="mdi-tag-text-outline">Keyword themes</v-tab>
        </v-tabs>

        <v-window v-model="discoveryTab">
          <v-window-item value="sources">
            <ClientDiscoverySourcesPanel :client-id="clientId" mode="embedded" />
          </v-window-item>
          <v-window-item value="keywords">
            <ClientDiscoveryKeywordsPanel :client-id="clientId" />
          </v-window-item>
        </v-window>
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

        <v-divider class="my-4" />

        <div class="mb-2 text-body-2">Current assets</div>
        <v-row>
          <v-col v-if="assetsLoading" cols="12">
            <v-progress-linear indeterminate color="primary" />
          </v-col>
          <v-col v-else-if="assetsError" cols="12">
            <v-alert type="error" density="comfortable" :text="assetsError" />
          </v-col>
          <template v-else>
            <v-col v-for="a in assetsList" :key="a.id" cols="12" md="6" lg="4">
              <v-card variant="outlined">
                <v-img v-if="a.type === 'image'" :src="a.url" height="140" cover />
                <v-card-text>
                  <div class="text-body-2">{{ a.originalName || a.filename || a.url }}</div>
                  <div class="text-caption text-medium-emphasis">Type: {{ a.type || 'other' }}</div>
                </v-card-text>
                <v-card-actions class="justify-end">
                  <v-btn
                    variant="text"
                    color="error"
                    :loading="deletingAsset[a.id]"
                    :disabled="deletingAsset[a.id]"
                    @click="onDeleteAsset(a)"
                  >
                    <v-icon icon="mdi-delete-outline" class="me-1" /> Remove
                  </v-btn>
                </v-card-actions>
              </v-card>
            </v-col>
            <v-col v-if="assetsList.length === 0" cols="12">
              <div class="text-medium-emphasis">No assets yet.</div>
            </v-col>
          </template>
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
