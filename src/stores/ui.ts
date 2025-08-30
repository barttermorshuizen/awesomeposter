import { defineStore } from 'pinia'

export const useUiStore = defineStore('ui', {
  state: () => ({
    // Sidebar drawer states
    drawerDesktopOpen: true as boolean,
    drawerMobileOpen: false as boolean,

    // Desktop rail (collapsed sidebar showing icons only)
    drawerDesktopRail: false as boolean,

    // Quick create dialog
    quickCreateOpen: false as boolean,
  }),
  actions: {
    toggleDesktopDrawer() {
      this.drawerDesktopOpen = !this.drawerDesktopOpen
    },
    toggleMobileDrawer() {
      this.drawerMobileOpen = !this.drawerMobileOpen
    },
    toggleDesktopRail() {
      this.drawerDesktopRail = !this.drawerDesktopRail
    },
    openQuickCreate() {
      this.quickCreateOpen = true
    },
    closeQuickCreate() {
      this.quickCreateOpen = false
    },
  },
})