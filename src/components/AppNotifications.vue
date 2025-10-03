<script setup lang="ts">
import { reactive, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useNotificationsStore } from '@/stores/notifications'

const notifications = useNotificationsStore()
const { toasts } = storeToRefs(notifications)

const openState = reactive<Record<string, boolean>>({})

watch(
  toasts,
  (current) => {
    const ids = new Set(current.map((toast) => toast.id))
    for (const toast of current) {
      if (!(toast.id in openState)) {
        openState[toast.id] = true
      }
    }
    for (const id of Object.keys(openState)) {
      if (!ids.has(id)) {
        delete openState[id]
      }
    }
  },
  { deep: true, immediate: true },
)

const LOCATION = 'top end'

function colorFor(kind: string) {
  switch (kind) {
    case 'success':
      return 'success'
    case 'warning':
      return 'warning'
    case 'error':
      return 'error'
    default:
      return 'primary'
  }
}

function dismiss(id: string) {
  notifications.dismiss(id)
}
</script>

<template>
  <div class="app-notifications">
    <v-snackbar
      v-for="toast in toasts"
      :key="toast.id"
      v-model="openState[toast.id]"
      :color="colorFor(toast.kind)"
      :timeout="toast.timeout"
      variant="elevated"
      elevation="8"
      :location="LOCATION"
      multi-line
      @update:model-value="value => {
        if (!value) {
          dismiss(toast.id)
        }
      }"
    >
      <div class="d-flex align-center justify-space-between w-100 gap-4">
        <span>{{ toast.message }}</span>
        <v-btn
          icon
          size="small"
          variant="text"
          density="comfortable"
          @click="dismiss(toast.id)"
        >
          <v-icon icon="mdi-close" />
        </v-btn>
      </div>
    </v-snackbar>
  </div>
</template>

<style scoped>
.app-notifications {
  position: fixed;
  top: 0;
  right: 0;
  z-index: 2000;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  pointer-events: none;
}

.app-notifications :deep(.v-snackbar__wrapper) {
  pointer-events: all;
}
</style>
