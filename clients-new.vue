<template>
	<div class="space-y-6">
		<h1 class="text-2xl font-semibold">New Client</h1>

		<UCard>
			<template #header>
				<div class="font-medium">Client basics</div>
			</template>
			<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
				<UFormField label="Name *" required>
					<div class="form-field">
						<UInput 
							v-model="name" 
							placeholder="Acme Inc" 
							size="md" 
							:class="{ 'border-red-500': errors.name }"
							ref="nameInput"
						/>
						<div v-if="errors.name" class="error-message">{{ errors.name }}</div>
					</div>
				</UFormField>
				<UFormField label="Slug *" description="Lowercase, numbers and hyphens" required>
					<div class="form-field">
						<UInput 
							v-model="slug" 
							placeholder="acme" 
							size="md" 
							:class="{ 'border-red-500': errors.slug }"
							ref="slugInput"
						/>
						<div v-if="errors.slug" class="error-message">{{ errors.slug }}</div>
					</div>
				</UFormField>
				<UFormField label="Website">
					<div class="form-field">
						<UInput v-model="website" placeholder="https://acme.com" size="md" />
					</div>
				</UFormField>
				<UFormField label="Industry">
					<div class="form-field">
						<UInput v-model="industry" placeholder="SaaS" size="md" />
					</div>
				</UFormField>
			</div>
		</UCard>

		<UCard>
			<template #header>
				<div class="font-medium">Tone & Profile</div>
			</template>
			<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
				<UFormField label="Primary communication language *" required>
					<div class="form-field mt-1">
						<div class="choice-row">
							<label v-for="opt in languageItems" :key="opt.value" class="choice-chip">
								<input type="radio" class="sr-only" name="language" :value="opt.value" v-model="primaryLanguage" />
								<span>{{ opt.label }}</span>
							</label>
						</div>
						<div v-if="errors.primaryLanguage" class="error-message">{{ errors.primaryLanguage }}</div>
					</div>
				</UFormField>
				<UFormField label="Tone of voice *" required>
					<div class="form-field mt-1">
						<div class="choice-row">
							<label v-for="opt in toneItems" :key="opt.value" class="choice-chip">
								<input type="radio" class="sr-only" name="tone" :value="opt.value" v-model="tonePreset" />
								<span>{{ opt.label }}</span>
							</label>
						</div>
						<div v-if="errors.tonePreset" class="error-message">{{ errors.tonePreset }}</div>
					</div>
				</UFormField>
				<UFormField label="Tone guidelines">
					<div class="form-field">
						<UTextarea v-model="toneGuidelines" placeholder="Clear, concise, confident." />
					</div>
				</UFormField>
				<UFormField label="Primary objective *" required>
					<div class="form-field">
						<UInput 
							v-model="objectivePrimary" 
							placeholder="Lead generation" 
							size="md" 
							:class="{ 'border-red-500': errors.objectivePrimary }"
							ref="objectiveInput"
						/>
						<div v-if="errors.objectivePrimary" class="error-message">{{ errors.objectivePrimary }}</div>
					</div>
				</UFormField>
				<UFormField label="Audience segments (comma-separated) *" required>
					<div class="form-field">
						<UInput 
							v-model="audienceSegments" 
							placeholder="Founders, Product Managers" 
							size="md" 
							:class="{ 'border-red-500': errors.audienceSegments }"
							ref="audienceInput"
						/>
						<div v-if="errors.audienceSegments" class="error-message">{{ errors.audienceSegments }}</div>
					</div>
				</UFormField>
				<UFormField label="Default platform *" required>
					<div class="form-field mt-1">
						<div class="choice-row">
							<label v-for="opt in platformItems" :key="opt.value" class="choice-chip">
								<input type="radio" class="sr-only" name="platform" :value="opt.value" v-model="defaultPlatform" />
								<span>{{ opt.label }}</span>
							</label>
						</div>
						<div v-if="errors.defaultPlatform" class="error-message">{{ errors.defaultPlatform }}</div>
					</div>
				</UFormField>
			</div>
		</UCard>

		<UCard>
			<template #header>
				<div class="font-medium">Brand assets</div>
			</template>
			<div class="space-y-3">
				<UFormField label="Logo file">
					<input type="file" ref="logoInput" class="file-input" accept="image/*" />
				</UFormField>
				<UFormField label="Reference document">
					<input type="file" ref="refInput" class="file-input" accept="application/pdf,image/*" />
				</UFormField>
			</div>
		</UCard>

		<div class="flex items-center gap-2">
			<UButton color="primary" :loading="submitting" icon="i-heroicons-check" label="Save" @click="onSave" />
			<NuxtLink to="/clients"><UButton variant="ghost" label="Cancel" /></NuxtLink>
		</div>
	</div>
</template>

<script setup lang="ts">
const router = useRouter()
const toast = useToast()

const name = ref('')
const slug = ref('')
const website = ref('')
const industry = ref('')

const primaryLanguage = ref('')
const tonePreset = ref('')
const toneGuidelines = ref('')
const objectivePrimary = ref('')
const audienceSegments = ref('')
const defaultPlatform = ref('linkedin')

const logoInput = ref<HTMLInputElement | null>(null)
const refInput = ref<HTMLInputElement | null>(null)

const languageItems = [
  { label: 'Nederlands', value: 'Nederlands' },
  { label: 'UK English', value: 'UK English' },
  { label: 'US English', value: 'US English' },
  { label: 'Français', value: 'Francais' }
]
const toneItems = [
  { label: 'Professional', value: 'Professional' },
  { label: 'Friendly', value: 'Friendly' },
  { label: 'Bold', value: 'Bold' }
]
const platformItems = [
  { label: 'LinkedIn', value: 'linkedin' }
]

const submitting = ref(false)

// Add validation state
const errors = ref<Record<string, string>>({})

// Add refs for form inputs
const nameInput = ref<HTMLInputElement>()
const slugInput = ref<HTMLInputElement>()
const objectiveInput = ref<HTMLInputElement>()
const audienceInput = ref<HTMLInputElement>()

// Validation function
function validateForm(): boolean {
  errors.value = {}
  
  if (!name.value?.trim()) {
    errors.value.name = 'Name is required'
  }
  
  if (!slug.value?.trim()) {
    errors.value.slug = 'Slug is required'
  }
  
  if (!primaryLanguage.value) {
    errors.value.primaryLanguage = 'Please select a primary communication language'
  }

  if (!tonePreset.value) {
    errors.value.tonePreset = 'Please select a tone of voice'
  }
  
  if (!objectivePrimary.value?.trim()) {
    errors.value.objectivePrimary = 'Primary objective is required'
  }
  
  if (!audienceSegments.value?.trim()) {
    errors.value.audienceSegments = 'Audience segments are required'
  }
  
  if (!defaultPlatform.value) {
    errors.value.defaultPlatform = 'Please select a default platform'
  }
  
  return Object.keys(errors.value).length === 0
}

// Focus first error field
function focusFirstError() {
  if (errors.value.name) {
    nameInput.value?.focus()
  } else if (errors.value.slug) {
    slugInput.value?.focus()
  } else if (errors.value.primaryLanguage) {
    // Focus first language option
    const firstLanguageInput = document.querySelector('input[name="language"]') as HTMLInputElement
    firstLanguageInput?.focus()
  } else if (errors.value.tonePreset) {
    // Focus first tone option
    const firstToneInput = document.querySelector('input[name="tone"]') as HTMLInputElement
    firstToneInput?.focus()
  } else if (errors.value.objectivePrimary) {
    objectiveInput.value?.focus()
  } else if (errors.value.audienceSegments) {
    audienceInput.value?.focus()
  } else if (errors.value.defaultPlatform) {
    // Focus first platform option
    const firstPlatformInput = document.querySelector('input[name="platform"]') as HTMLInputElement
    firstPlatformInput?.focus()
  }
}

async function onSave() {
	// Clear previous errors
	errors.value = {}
	
	// Validate form
	if (!validateForm()) {
		// Focus first error field
		nextTick(() => {
			focusFirstError()
		})
		return
	}

	if (!name.value || !slug.value) {
		toast.add({ color: 'error', title: 'Missing fields', description: 'Name and slug are required.' })
		return
	}
	try {
		submitting.value = true
		// 1) Create client
		const createClientRes = await $fetch<{ ok: boolean, id: string }>('/api/clients', {
			method: 'POST',
			body: { 
				name: name.value, 
				slug: slug.value, 
				website: website.value || undefined,
				industry: industry.value || undefined
			}
		})
		const clientId = createClientRes.id

		// 2) Create profile (tone, objectives, audiences, platform prefs)
		const objectives = { primary: objectivePrimary.value || '—' }
		const audiences = { segments: audienceSegments.value.split(',').map(s => s.trim()).filter(Boolean) }
		const tone = { preset: tonePreset.value || undefined, guidelines: toneGuidelines.value || undefined }
		const platformPrefs = defaultPlatform.value ? { [defaultPlatform.value]: {} } : {}
		await $fetch('/api/clients/' + clientId + '/profile', {
			method: 'PATCH',
			body: { primaryCommunicationLanguage: primaryLanguage.value, objectives, audiences, tone, platformPrefs }
		})

		// 3) Upload brand assets (optional files)
		async function uploadAndCreate(type: string, file: File) {
			const fd = new FormData()
			fd.append('clientId', clientId)
			fd.append('file', file)
			const up = await $fetch<{ ok: boolean, url: string }>('/api/assets/upload', {
				method: 'POST', body: fd
			})
			await $fetch('/api/assets', { method: 'POST', body: { clientId, url: up.url, type } })
		}
		if (logoInput.value?.files?.[0]) {
			await uploadAndCreate('logo', logoInput.value.files[0])
		}
		if (refInput.value?.files?.[0]) {
			await uploadAndCreate('doc', refInput.value.files[0])
		}

		toast.add({ title: 'Client created', description: 'Client and profile saved.' })
		// 4) Navigate to Clients list (omit landing on detail as requested)
		router.push('/clients?created=1')
	} catch (e: unknown) {
		toast.add({ color: 'error', title: 'Save failed', description: (e as Error)?.message || 'Unknown error occurred' })
	} finally {
		submitting.value = false
	}
}
</script>

<style scoped>


/* Custom styles for form fields and chips */
.form-field { margin-top: 4px; }
.form-field :deep(input),
.form-field :deep(textarea) {
  padding-left: 12px !important;
  padding-right: 12px !important;
  min-height: 32px !important; /* Adjusted height */
  background-color: #374151 !important;
  color: var(--fg) !important;
}

.form-field :deep(input):focus,
.form-field :deep(textarea):focus {
  background-color: #4b5563 !important;
  border-color: var(--accent) !important;
  outline: none !important;
  box-shadow: 0 0 0 2px rgba(110, 168, 254, 0.2) !important;
}
.file-input {
  display: block;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background-color: #374151;
  color: var(--fg);
}
.choice-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.choice-chip {
  display: inline-flex;
  align-items: center;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  background-color: var(--panel);
  color: var(--fg);
  transition: all 0.2s ease;
}
.choice-chip:hover {
  background-color: rgba(255, 255, 255, 0.1);
}
.choice-chip input:checked + span {
  color: var(--accent);
  font-weight: 600;
}
.error-message {
  color: #ef4444;
  font-size: 0.875rem;
  margin-top: 4px;
  margin-left: 4px;
}
</style>
