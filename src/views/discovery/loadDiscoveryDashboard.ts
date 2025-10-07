import type { Component } from 'vue'
import { fetchClientFeatureFlags } from '@/lib/feature-flags'

export const DASHBOARD_CLIENT_STORAGE_KEY = 'awesomeposter.discovery.clientId'

function resolveClientIdFromContext(): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const params = new URLSearchParams(window.location.search)
    const queryClient = params.get('clientId')?.trim()
    if (queryClient) {
      return queryClient
    }

    const stored = window.localStorage?.getItem(DASHBOARD_CLIENT_STORAGE_KEY)
    return stored?.trim() || null
  } catch {
    return null
  }
}

export default async function loadDiscoveryDashboard(): Promise<Component> {
  const loadDashboardView = async () => (await import('@/views/discovery/DiscoveryDashboardView.vue')).default
  const loadFallbackView = async () => (await import('@/views/discovery/DiscoveryDashboardFallbackView.vue')).default

  if (typeof window === 'undefined') {
    return loadFallbackView()
  }

  const clientId = resolveClientIdFromContext()
  if (!clientId) {
    console.info('Discovery dashboard: no persisted client found, rendering shell for selection.')
    return loadDashboardView()
  }

  try {
    const flags = await fetchClientFeatureFlags(clientId)
    if (!flags.discoveryFiltersV1) {
      console.warn('Discovery filters flag disabled; rendering fallback placeholder.')
      return loadFallbackView()
    }
  } catch (error) {
    console.warn('Discovery dashboard flag lookup failed; rendering fallback placeholder.', error)
    return loadFallbackView()
  }

  return loadDashboardView()
}
