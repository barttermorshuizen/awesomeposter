<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter, type RouteLocationRaw } from 'vue-router'
import { useDisplay } from 'vuetify'
import { useUiStore } from '@/stores/ui'
import AppNotifications from '@/components/AppNotifications.vue'
import { isFlexSandboxEnabledClient } from '@/lib/featureFlags'

const router = useRouter()
const route = useRoute()
const { smAndDown } = useDisplay()
const ui = useUiStore()

const flexSandboxEnabled = isFlexSandboxEnabledClient()

const baseNavItems = [
  { title: 'Dashboard', icon: 'mdi-view-dashboard-outline', to: { name: 'dashboard' } },
  { title: 'Briefs', icon: 'mdi-file-document-edit-outline', to: { name: 'briefs' } },
  { title: 'Inbox', icon: 'mdi-inbox-arrow-down-outline', to: { name: 'inbox' } },
  { title: 'Clients', icon: 'mdi-account-multiple-outline', to: { name: 'clients' } },
  { title: 'Assets', icon: 'mdi-folder-multiple-image', to: { name: 'assets' } },
  { title: 'Analytics', icon: 'mdi-chart-line', to: { name: 'analytics' } },
  { title: 'Sandbox', icon: 'mdi-flask-outline', to: { name: 'sandbox' } },
  { title: 'Settings', icon: 'mdi-cog-outline', to: { name: 'settings' } },
]

const rawNavItems = computed(() => {
  const items = [...baseNavItems]
  if (flexSandboxEnabled) {
    items.splice(items.length - 1, 0, {
      title: 'Flex Sandbox',
      icon: 'mdi-graph-outline',
      to: { name: 'flex-sandbox' },
    })
  }
  return items
})

const resolveRouteName = (target: RouteLocationRaw): string | null => {
  try {
    const resolved = router.resolve(target)
    return (resolved?.name as string | null) ?? null
  } catch {
    return null
  }
}

const navItems = computed(() => rawNavItems.value.filter((item) => resolveRouteName(item.to)))

const isNavActive = (target: RouteLocationRaw): boolean => resolveRouteName(target) === route.name

const currentIndex = computed(() => {
  const idx = navItems.value.findIndex((item) => isNavActive(item.to))
  return idx === -1 ? 0 : idx
})

// Top search (placeholder)
const search = ref('')

// Quick create dialog (placeholder)
const quickCreateOpen = computed({
  get: () => ui.quickCreateOpen,
  set: (v: boolean) => (ui.quickCreateOpen = v),
})

// Drawer behavior
const isMobile = computed(() => smAndDown.value)
const drawerModel = computed({
  get: () => (isMobile.value ? ui.drawerMobileOpen : ui.drawerDesktopOpen),
  set: (val: boolean) => {
    if (isMobile.value) ui.drawerMobileOpen = val
    else ui.drawerDesktopOpen = val
  },
})
</script>

<template>
  <!-- App Bar -->
  <v-app-bar density="comfortable" flat>
    <!-- Mobile drawer toggle -->
    <v-app-bar-nav-icon class="d-sm-none" @click.stop="drawerModel = !drawerModel" />

    <!-- Desktop rail toggle -->
    <v-btn
      class="d-none d-sm-flex"
      icon
      variant="text"
      :title="ui.drawerDesktopRail ? 'Expand sidebar' : 'Collapse to icons'"
      @click="ui.toggleDesktopRail()"
    >
      <v-icon :icon="ui.drawerDesktopRail ? 'mdi-chevron-double-right' : 'mdi-chevron-double-left'" />
    </v-btn>

    <v-toolbar-title class="text-subtitle-1 text-md-h6">AwesomePoster</v-toolbar-title>

    <!-- Wide, growing search on desktop -->
    <div class="d-none d-sm-flex flex-grow-1 mx-2">
      <v-text-field
        v-model="search"
        hide-details
        density="comfortable"
        variant="solo-filled"
        flat
        rounded
        prepend-inner-icon="mdi-magnify"
        placeholder="Search (placeholder)"
        style="width: 100%"
      />
    </div>
    <v-btn color="primary" prepend-icon="mdi-plus" @click="quickCreateOpen = true" class="mx-1">
      <span class="d-none d-md-inline">Quick create</span>
    </v-btn>
    <v-menu>
      <template #activator="{ props }">
        <v-btn v-bind="props" icon variant="text">
          <v-icon icon="mdi-account-circle" />
        </v-btn>
      </template>
      <v-list>
        <v-list-item>
          <v-list-item-title>Profile (placeholder)</v-list-item-title>
        </v-list-item>
        <v-list-item>
          <v-list-item-title>Logout (placeholder)</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-menu>
  </v-app-bar>

  <!-- Navigation Drawer -->
  <v-navigation-drawer
    v-model="drawerModel"
    :temporary="isMobile"
    :permanent="!isMobile"
    :rail="!isMobile && ui.drawerDesktopRail"
    width="260"
    rail-width="72"
  >
    <v-list density="comfortable" nav>
      <v-list-subheader v-if="!ui.drawerDesktopRail">Navigation</v-list-subheader>
      <v-divider class="mb-1" />
      <v-list-item
        v-for="item in navItems"
        :key="item.title"
        :to="item.to"
        link
        rounded="lg"
        :active="isNavActive(item.to)"
        @click="isMobile && (drawerModel = false)"
      >
        <template #prepend>
          <v-icon :icon="item.icon" />
        </template>
        <v-list-item-title v-if="!ui.drawerDesktopRail">{{ item.title }}</v-list-item-title>
      </v-list-item>
    </v-list>
  </v-navigation-drawer>

  <!-- Main content -->
  <v-main>
    <slot />
  </v-main>

  <!-- Bottom navigation (mobile) -->
  <v-bottom-navigation
    v-if="isMobile"
    grow
    mode="shift"
    elevation="8"
    :model-value="currentIndex"
    @update:model-value="(i:number) => router.push(navItems[i].to)"
  >
    <v-btn
      v-for="(item, i) in navItems"
      :key="item.title"
      :value="i"
      stacked
      :active="isNavActive(item.to)"
    >
      <v-icon :icon="item.icon" />
      <span class="text-caption">{{ item.title }}</span>
    </v-btn>
  </v-bottom-navigation>

  <!-- Quick Create Dialog (placeholder) -->
  <v-dialog v-model="quickCreateOpen" max-width="520">
    <v-card>
      <v-card-title class="text-h6">
        <v-icon icon="mdi-plus" class="me-2" /> Quick create
      </v-card-title>
      <v-card-text>
        <p class="text-medium-emphasis">Placeholder actions:</p>
        <v-list density="comfortable">
          <v-list-item prepend-icon="mdi-file-document-edit-outline" title="New Brief (placeholder)" />
          <v-list-item prepend-icon="mdi-account-plus-outline" title="New Client (placeholder)" />
          <v-list-item prepend-icon="mdi-folder-plus-outline" title="Upload Asset (placeholder)" />
        </v-list>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="quickCreateOpen = false">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <AppNotifications />
</template>

<style scoped>
</style>
