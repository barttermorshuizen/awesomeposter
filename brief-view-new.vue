<template>
  <div class="space-y-4">
    <div class="flex items-center gap-4">
      <UButton
        icon="i-heroicons-arrow-left"
        variant="ghost"
        @click="goBack"
      >
        Back
      </UButton>
      <h1 class="text-2xl font-semibold">
        {{ brief?.title || 'Loading...' }}
      </h1>
    </div>

    <div v-if="pending" class="flex justify-center py-8">
      <UIcon name="i-heroicons-arrow-path" class="w-8 h-8 animate-spin" />
    </div>

    <UAlert
      v-else-if="error"
      title="Error loading brief"
      :description="error.message || 'Failed to load brief details'"
      icon="i-heroicons-exclamation-triangle"
      color="red"
    />

    <div v-else-if="brief" class="space-y-6">
      <UCard>
        <template #header>
          <h2 class="text-lg font-medium">Brief Details</h2>
        </template>
        
        <div class="space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Title</label>
              <p class="text-gray-900 dark:text-white">{{ brief.title || 'Untitled' }}</p>
            </div>
            
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
              <UBadge :label="brief.status" :color="getStatusColor(brief.status)" />
            </div>
            
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Client</label>
              <p class="text-gray-900 dark:text-white">{{ brief.clientName || '—' }}</p>
            </div>
            
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Created</label>
              <p class="text-gray-900 dark:text-white">{{ formatDate(brief.createdAt) }}</p>
            </div>
          </div>
          
          <div v-if="brief.objective">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Objective</label>
            <p class="text-gray-900 dark:text-white">{{ brief.objective }}</p>
          </div>
          
          <div v-if="brief.deadlineAt">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Deadline</label>
            <p class="text-gray-900 dark:text-white">{{ formatDate(brief.deadlineAt) }}</p>
          </div>
        </div>
      </UCard>
    </div>
  </div>
</template>

<script setup lang="ts">
type Brief = {
  id: string
  title: string | null
  clientId: string
  clientName: string | null
  objective: string | null
  status: 'draft' | 'approved' | 'sent' | 'published'
  deadlineAt: string | null
  createdAt: string | null
}

const route = useRoute()
const router = useRouter()

const briefId = computed(() => route.query.id as string)

const { data, pending, error } = await useFetch(`/api/briefs/${briefId.value}`, {
  query: computed(() => ({ id: briefId.value })),
  default: () => ({ ok: false, brief: null })
})

const brief = computed<Brief | null>(() => {
  if (!data.value || !data.value.ok) return null
  return (data.value as { brief: Brief }).brief
})

function goBack() {
  router.back()
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'draft': return 'gray'
    case 'approved': return 'green'
    case 'sent': return 'blue'
    case 'published': return 'purple'
    default: return 'gray'
  }
}

onMounted(() => {
  if (!briefId.value) {
    router.push('/briefs')
  }
})
</script>
