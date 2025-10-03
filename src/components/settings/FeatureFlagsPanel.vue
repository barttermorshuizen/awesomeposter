<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

const clients = ref<Array<{ id: string; name: string; slug: string | null }>>([])
const clientsLoading = ref(false)
const clientsError = ref<string | null>(null)

const selectedClientId = ref<string | null>(null)
const discoveryEnabled = ref<boolean>(false)
const discoveryOriginal = ref<boolean>(false)
const discoveryLoaded = ref(false)
const flagLoading = ref(false)
const flagError = ref<string | null>(null)
const successMessage = ref<string | null>(null)

const actorStorageKey = 'awesomeposter.featureFlagActor'
const actor = ref<string>('')
const reason = ref<string>('')
const submitting = ref(false)
let lastLoadToken = 0

onMounted(() => {
  const storedActor = typeof window !== 'undefined' ? window.localStorage.getItem(actorStorageKey) : null
  if (storedActor) {
    actor.value = storedActor
  }
  void loadClients()
})

async function loadClients() {
  clientsLoading.value = true
  clientsError.value = null
  try {
    const res = await fetch('/api/clients', { headers: { accept: 'application/json' } })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(text || `HTTP ${res.status}`)
    }
    const ctype = res.headers.get('content-type') || ''
    if (!ctype.includes('application/json')) {
      await res.text().catch(() => '')
      throw new Error('API response was not JSON. Ensure the API server is running (npm run dev:api).')
    }
    const data = await res.json().catch(() => ({}))
    const items = Array.isArray(data?.items) ? data.items : []
    clients.value = items.map((item: any) => ({
      id: String(item.id),
      name: String(item.name ?? 'Unnamed client'),
      slug: item.slug ?? null,
    }))
  } catch (error: unknown) {
    clientsError.value = error instanceof Error ? error.message : String(error)
  } finally {
    clientsLoading.value = false
  }
}

watch(selectedClientId, (id) => {
  discoveryLoaded.value = false
  discoveryEnabled.value = false
  discoveryOriginal.value = false
  successMessage.value = null
  flagError.value = null
  reason.value = ''
  if (typeof id === 'string' && id) {
    void loadFeatureFlags(id)
  }
})

async function loadFeatureFlags(clientId: string) {
  const token = ++lastLoadToken
  flagLoading.value = true
  flagError.value = null
  try {
    const res = await fetch(`/api/clients/${clientId}/feature-flags`, { headers: { accept: 'application/json' } })
    const contentType = res.headers.get('content-type') || ''
    let payload: unknown = null
    if (contentType.includes('application/json')) {
      payload = await res.json().catch(() => null)
    } else {
      payload = await res.text().catch(() => '')
    }

    if (!res.ok) {
      const message = typeof payload === 'string'
        ? (payload || `HTTP ${res.status}`)
        : ((payload as any)?.statusMessage || (payload as any)?.message || (payload as any)?.error || `HTTP ${res.status}`)
      throw new Error(message)
    }

    const flags = (payload as any)?.flags ?? {}
    const enabled = Boolean(flags?.discoveryAgent)
    if (token === lastLoadToken) {
      discoveryEnabled.value = enabled
      discoveryOriginal.value = enabled
    }
  } catch (error: unknown) {
    if (token === lastLoadToken) {
      flagError.value = error instanceof Error ? error.message : String(error)
    }
  } finally {
    if (token === lastLoadToken) {
      flagLoading.value = false
      discoveryLoaded.value = true
    }
  }
}

const isDirty = computed(() =>
  discoveryLoaded.value && discoveryEnabled.value !== discoveryOriginal.value,
)

const disableSubmit = computed(() =>
  submitting.value
  || flagLoading.value
  || !selectedClientId.value
  || !discoveryLoaded.value
  || !actor.value.trim()
  || !isDirty.value,
)

async function applyChanges() {
  if (!selectedClientId.value || !discoveryLoaded.value) {
    return
  }
  const trimmedActor = actor.value.trim()

  submitting.value = true
  flagError.value = null
  successMessage.value = null
  try {
    const res = await fetch(`/api/clients/${selectedClientId.value}/feature-flags`, {
      method: 'PATCH',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        feature: 'discovery-agent',
        enabled: discoveryEnabled.value,
        actor: trimmedActor,
        reason: reason.value.trim() || undefined,
      }),
    })

    const contentType = res.headers.get('content-type') || ''
    let payload: unknown = null
    if (contentType.includes('application/json')) {
      payload = await res.json().catch(() => null)
    } else {
      payload = await res.text().catch(() => '')
    }

    if (!res.ok) {
      const message = typeof payload === 'string'
        ? (payload || `HTTP ${res.status}`)
        : ((payload as any)?.statusMessage || (payload as any)?.message || (payload as any)?.error || `HTTP ${res.status}`)
      throw new Error(message)
    }

    const flag = (payload as any)?.flag ?? {}
    const nextEnabled = Boolean(flag?.enabled)
    discoveryOriginal.value = nextEnabled
    discoveryEnabled.value = nextEnabled
    discoveryLoaded.value = true

    const changed = typeof (payload as any)?.changed === 'boolean' ? (payload as any).changed : true
    successMessage.value = changed === false
      ? 'Flag already matched the requested state. No change necessary.'
      : 'Discovery agent flag updated. Propagation may take up to 2 minutes.'

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(actorStorageKey, trimmedActor)
    }
  } catch (error: unknown) {
    flagError.value = error instanceof Error ? error.message : String(error)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <v-card elevation="2">
    <v-card-title class="text-subtitle-1 d-flex align-center">
      <v-icon icon="mdi-flag-variant" class="me-2" />
      Feature Flags
    </v-card-title>
    <v-card-text>
      <p class="text-body-2 text-medium-emphasis mb-4">
        Manage per-client discovery rollout. Changes publish cache invalidation events and audit logs automatically.
      </p>

      <v-row class="mb-4" dense>
        <v-col cols="12" md="6">
         <v-select
            v-model="selectedClientId"
            :items="clients"
            :loading="clientsLoading"
            item-title="name"
            item-value="id"
            label="Select client"
            placeholder="Choose a client"
            density="comfortable"
            variant="outlined"
            :disabled="clientsLoading"
            :error="Boolean(clientsError)"
            :error-messages="clientsError ? [clientsError] : []"
            hide-details="auto"
          >
            <template #item="{ props, item }">
              <v-list-item v-bind="props" :title="item.raw.name" :subtitle="item.raw.slug || undefined" />
            </template>
          </v-select>
        </v-col>
        <v-col cols="12" md="6" class="d-flex align-end">
          <div class="text-caption text-medium-emphasis">
            Only discovery feature flags are managed here. Other flags remain environment-controlled.
          </div>
        </v-col>
      </v-row>

      <v-divider class="my-4" />

      <div v-if="selectedClientId">
        <v-alert
          v-if="flagError"
          type="error"
          density="comfortable"
          class="mb-4"
          :text="flagError"
        />
        <v-alert
          v-if="successMessage"
          type="success"
          density="comfortable"
          class="mb-4"
          :text="successMessage"
        />

        <div class="d-flex align-center justify-space-between mb-3 flex-wrap gap-3">
          <div>
            <div class="text-subtitle-2">Discovery agent</div>
            <div class="text-caption text-medium-emphasis">
              Controls ingestion, scoring, and dashboard visibility for the pilot discovery experience.
            </div>
          </div>
          <div class="d-flex align-center gap-3">
            <v-chip
              v-if="discoveryLoaded"
              :color="discoveryEnabled ? 'success' : 'grey'"
              variant="elevated"
              size="small"
            >
              {{ discoveryEnabled ? 'Enabled' : 'Disabled' }}
            </v-chip>
            <v-switch
              v-model="discoveryEnabled"
              :loading="flagLoading"
              :disabled="flagLoading || submitting"
              inset
              hide-details
              color="primary"
            />
          </div>
        </div>

        <v-row class="mb-2" dense>
          <v-col cols="12" md="6">
            <v-text-field
              v-model="actor"
              label="Operator identifier"
              hint="Email or name logged with the audit record"
              persistent-hint
              density="comfortable"
              variant="outlined"
              :disabled="submitting"
              :error-messages="!actor.trim() && submitting ? ['Actor is required.'] : []"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-text-field
              v-model="reason"
              label="Reason (optional)"
              density="comfortable"
              variant="outlined"
              :disabled="submitting"
            />
          </v-col>
        </v-row>

        <div class="d-flex align-center justify-space-between flex-wrap gap-4 mt-4">
          <div class="text-caption text-medium-emphasis">
            Propagation may take up to 2 minutes while caches refresh across services.
          </div>
          <v-btn
            color="primary"
            :disabled="disableSubmit"
            :loading="submitting"
            @click="applyChanges"
          >
            Save changes
          </v-btn>
        </div>
      </div>
      <div v-else class="text-medium-emphasis text-body-2">
        Select a client to view feature flag status.
      </div>
    </v-card-text>
</v-card>
</template>
