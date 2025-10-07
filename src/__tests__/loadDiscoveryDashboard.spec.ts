import { beforeEach, describe, expect, it, vi } from 'vitest'

const dashboardStub = { name: 'DiscoveryDashboardViewStub' }
const fallbackStub = { name: 'DiscoveryDashboardFallbackViewStub' }

vi.mock('@/views/discovery/DiscoveryDashboardView.vue', () => ({
  default: dashboardStub,
}))

vi.mock('@/views/discovery/DiscoveryDashboardFallbackView.vue', () => ({
  default: fallbackStub,
}))

vi.mock('@/lib/feature-flags', () => ({
  fetchClientFeatureFlags: vi.fn(),
}))

import { fetchClientFeatureFlags } from '@/lib/feature-flags'
import loadDiscoveryDashboard, { DASHBOARD_CLIENT_STORAGE_KEY } from '@/views/discovery/loadDiscoveryDashboard'

const mockFetchClientFeatureFlags = vi.mocked(fetchClientFeatureFlags)

function setSearchParams(search: string) {
  if (!search) {
    window.history.replaceState({}, '', '/')
    return
  }

  const normalized = search.startsWith('?') ? search : `?${search}`
  window.history.replaceState({}, '', normalized)
}

describe('loadDiscoveryDashboard', () => {
  beforeEach(() => {
    mockFetchClientFeatureFlags.mockReset()
    window.localStorage.clear()
    setSearchParams('')
  })

  it('returns the dashboard view when no client is selected so the user can choose one', async () => {
    const component = await loadDiscoveryDashboard()
    expect(component).toBe(dashboardStub)
    expect(mockFetchClientFeatureFlags).not.toHaveBeenCalled()
  })

  it('invokes fallback when the feature flag is disabled for the client', async () => {
    setSearchParams('clientId=client-123')
    mockFetchClientFeatureFlags.mockResolvedValue({ discoveryFiltersV1: false } as any)

    const component = await loadDiscoveryDashboard()

    expect(mockFetchClientFeatureFlags).toHaveBeenCalledWith('client-123')
    expect(component).toBe(fallbackStub)
  })

  it('returns the dashboard view when the flag is enabled', async () => {
    mockFetchClientFeatureFlags.mockResolvedValue({ discoveryFiltersV1: true } as any)
    setSearchParams('clientId=client-123')

    const component = await loadDiscoveryDashboard()

    expect(mockFetchClientFeatureFlags).toHaveBeenCalledWith('client-123')
    expect(component).toBe(dashboardStub)
  })

  it('uses stored client id when query parameter is missing', async () => {
    window.localStorage.setItem(DASHBOARD_CLIENT_STORAGE_KEY, 'stored-client')
    mockFetchClientFeatureFlags.mockResolvedValue({ discoveryFiltersV1: true } as any)

    const component = await loadDiscoveryDashboard()

    expect(mockFetchClientFeatureFlags).toHaveBeenCalledWith('stored-client')
    expect(component).toBe(dashboardStub)
  })

  it('falls back when flag lookup throws an error', async () => {
    setSearchParams('clientId=client-123')
    mockFetchClientFeatureFlags.mockRejectedValue(new Error('network down'))

    const component = await loadDiscoveryDashboard()

    expect(component).toBe(fallbackStub)
  })
})
