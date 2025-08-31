<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-semibold">New Brief</h1>

    <UCard>
      <template #header>
        <div class="font-medium">Brief basics</div>
      </template>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <UFormField label="Title *" required>
          <div class="form-field">
            <UInput 
              v-model="title" 
              placeholder="Q4 Product Launch Campaign" 
              size="md" 
              :class="{ 'border-red-500': errors.title }"
              ref="titleInput"
            />
            <div v-if="errors.title" class="error-message">{{ errors.title }}</div>
          </div>
        </UFormField>
        <UFormField label="Client *" required>
          <div class="form-field">
            <select
              v-model="clientId"
              :class="{ 'border-red-500': errors.clientId }"
              ref="clientInput"
              class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Select a client</option>
              <option v-for="client in clientOptions" :key="client.value" :value="client.value">
                {{ client.label }}
              </option>
            </select>
            <div v-if="errors.clientId" class="error-message">{{ errors.clientId }}</div>
          </div>
        </UFormField>
        <UFormField label="Objective *" required>
          <div class="form-field">
            <UInput 
              v-model="objective" 
              placeholder="Increase brand awareness and drive signups" 
              size="md" 
              :class="{ 'border-red-500': errors.objective }"
              ref="objectiveInput"
            />
            <div v-if="errors.objective" class="error-message">{{ errors.objective }}</div>
          </div>
        </UFormField>
        <UFormField label="Description" class="md:col-span-2">
          <div class="form-field">
            <UTextarea 
              v-model="description" 
              placeholder="Provide additional context, requirements, or campaign details..." 
              rows="3"
              size="md" 
            />
          </div>
        </UFormField>
        <UFormField label="Deadline">
          <div class="form-field">
            <UInput 
              v-model="deadline" 
              type="datetime-local"
              size="md" 
            />
          </div>
        </UFormField>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <div class="font-medium">Campaign Details</div>
      </template>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <UFormField label="Target Audience">
          <div class="form-field">
            <UInput 
              v-model="audienceId" 
              placeholder="e.g., tech-savvy professionals" 
              size="md" 
            />
          </div>
        </UFormField>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <div class="font-medium">Assets</div>
      </template>
      <AssetUpload
        :client-id="clientId"
        v-model="uploadedAssets"
        @upload="onAssetUpload"
      />
    </UCard>

    <div class="flex items-center gap-2">
      <UButton color="primary" :loading="submitting" icon="i-heroicons-check" label="Create Brief" @click="onSave" />
      <NuxtLink to="/briefs"><UButton variant="ghost" label="Cancel" /></NuxtLink>
    </div>
  </div>
</template>

<script setup lang="ts">
const router = useRouter()
const toast = useToast()

// Form fields
const title = ref('')
const clientId = ref('')
const objective = ref('')
const description = ref('')
const deadline = ref('')
const audienceId = ref('')

// Asset management
const uploadedAssets = ref<any[]>([])

// Form validation
const errors = ref<Record<string, string>>({})

// Form refs
const titleInput = ref<HTMLInputElement>()
const clientInput = ref<HTMLInputElement>()
const objectiveInput = ref<HTMLInputElement>()



// Get clients for dropdown
const { data: clientsData } = await useFetch('/api/clients')
const clientOptions = computed(() => {
  const items = (clientsData.value as { items?: Array<{ id: string, name: string }> })?.items ?? []
  return items.map(client => ({
    label: client.name,
    value: client.id
  }))
})

const submitting = ref(false)

// Validation function
function validateForm(): boolean {
  errors.value = {}
  
  if (!title.value?.trim()) {
    errors.value.title = 'Title is required'
  }
  
  if (!clientId.value) {
    errors.value.clientId = 'Please select a client'
  }
  
  if (!objective.value?.trim()) {
    errors.value.objective = 'Objective is required'
  }
  
  return Object.keys(errors.value).length === 0
}

// Focus first error field
function focusFirstError() {
  if (errors.value.title) {
    titleInput.value?.focus()
  } else if (errors.value.clientId) {
    clientInput.value?.focus()
  } else if (errors.value.objective) {
    objectiveInput.value?.focus()
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

  try {
    submitting.value = true
    
    // Prepare brief data
    const briefData = {
      clientId: clientId.value,
      title: title.value.trim(),
      description: description.value.trim() || undefined,
      objective: objective.value.trim(),
      audienceId: audienceId.value.trim() || undefined,
      deadlineAt: deadline.value ? new Date(deadline.value).toISOString() : undefined
    }
    
    // Create brief
    const response = await $fetch<{ ok: boolean, brief: any }>('/api/briefs', {
      method: 'POST',
      body: briefData
    })
    
    if (response.ok) {
      // If assets were uploaded, associate them with the new brief
      if (uploadedAssets.value.length > 0) {
        try {
          for (const asset of uploadedAssets.value) {
            await $fetch(`/api/assets/${asset.id}`, {
              method: 'PATCH',
              body: { briefId: response.brief.id }
            })
          }
        } catch (error) {
          console.warn('Failed to associate some assets with brief:', error)
        }
      }
      
      toast.add({ 
        title: 'Brief created', 
        description: 'The brief was saved successfully.', 
        icon: 'i-heroicons-check-circle' 
      })
      
      // Navigate to briefs list
      router.push('/briefs?created=1')
    } else {
      throw new Error('Failed to create brief')
    }
  } catch (e: unknown) {
    console.error('Error creating brief:', e)
    
    let errorMessage = 'Failed to create brief. Please try again.'
    if (e instanceof Error) {
      errorMessage = e.message
    }
    
    toast.add({ 
      color: 'error', 
      title: 'Save failed', 
      description: errorMessage,
      icon: 'i-heroicons-x-circle'
    })
  } finally {
    submitting.value = false
  }
}

function onAssetUpload(asset: any) {
  // Asset is automatically added to uploadedAssets via v-model
  console.log('Asset uploaded:', asset)
}
</script>

<style scoped>
/* Custom styles for form fields */
.form-field { margin-top: 4px; }
.form-field :deep(input),
.form-field :deep(textarea),
.form-field :deep(select) {
  padding-left: 12px !important;
  padding-right: 12px !important;
  min-height: 32px !important;
  background-color: #374151 !important;
  color: var(--fg) !important;
}

.form-field :deep(input):focus,
.form-field :deep(textarea):focus,
.form-field :deep(select):focus {
  background-color: #4b5563 !important;
  border-color: var(--accent) !important;
  outline: none !important;
  box-shadow: 0 0 0 2px rgba(110, 168, 254, 0.2) !important;
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
