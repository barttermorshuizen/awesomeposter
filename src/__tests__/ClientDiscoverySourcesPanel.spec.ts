import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ClientDiscoverySourcesPanel from '@/components/clients/ClientDiscoverySourcesPanel.vue'
import { useNotificationsStore } from '@/stores/notifications'
import vuetify from '@/plugins/vuetify'
import { subscribeToDiscoveryEvents } from '@/lib/discovery-sse'

let unsubscribeSpy: Mock

vi.mock('@/lib/discovery-sse', () => ({
  subscribeToDiscoveryEvents: vi.fn(),
}))

describe('ClientDiscoverySourcesPanel', () => {
  let lastHandler: any

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
    lastHandler = null
    unsubscribeSpy = vi.fn()
    const subscribeMock = vi.mocked(subscribeToDiscoveryEvents)
    subscribeMock.mockReset()
    subscribeMock.mockImplementation((_clientId: string, handler: any) => {
      lastHandler = handler
      return unsubscribeSpy
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function mountPanel(fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
    vi.spyOn(global, 'fetch').mockImplementation(fetchImpl)
    const wrapper = mount(ClientDiscoverySourcesPanel, {
      props: { clientId: 'client-1' },
      global: { plugins: [vuetify] },
    })
    await flushPromises()
    return wrapper
  }

  it('pushes toast notifications when create call rolls back', async () => {
    const notifications = useNotificationsStore()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/sources') && !init?.method) {
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ message: 'Persistence failed' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    const wrapper = await mountPanel(fetchMock)
    const vm = wrapper.vm as unknown as {
      submit: () => Promise<void>
      form: { url: string }
    }

    vm.form.url = 'https://youtube.com/channel/UC123ABC'
    await vm.submit()
    await flushPromises()

    expect(notifications.toasts).toHaveLength(1)
    expect(notifications.toasts[0]?.message).toContain('Persistence failed')
  })

  it('handles feature_disabled SSE events by rolling back the UI', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/sources') && !init?.method) {
        return new Response(JSON.stringify({
          items: [
            {
              id: 'source-1',
              clientId: 'client-1',
              url: 'https://example.com/feed.xml',
              canonicalUrl: 'https://example.com/feed.xml',
              sourceType: 'rss',
              identifier: 'https://example.com/feed.xml',
              notes: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastFetchStatus: 'idle',
              lastFetchCompletedAt: null,
              lastFailureReason: null,
              lastSuccessAt: null,
              consecutiveFailureCount: 0,
              healthJson: {
                status: 'healthy',
                observedAt: new Date().toISOString(),
                lastFetchedAt: null,
                consecutiveFailures: 0,
              },
            },
          ],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    const wrapper = await mountPanel(fetchMock)
    const vm = wrapper.vm as unknown as {
      featureDisabled: boolean
      featureDisabledMessage: string
      sources: Array<unknown>
    }

    expect(lastHandler).toBeTruthy()
    expect(vm.featureDisabled).toBe(false)
    expect(Array.isArray(vm.sources)).toBe(true)
    expect(vm.sources.length).toBeGreaterThan(0)

    lastHandler.onFeatureDisabled?.({ message: 'Discovery temporarily disabled.' })
    await flushPromises()

    expect(unsubscribeSpy).toHaveBeenCalledTimes(1)
    expect(vm.featureDisabled).toBe(true)
    expect(vm.featureDisabledMessage).toBe('Discovery temporarily disabled.')
    expect(vm.sources.length).toBe(0)
  })

  it('updates status badges when source.health events arrive', async () => {
    const initialObserved = new Date('2025-04-02T08:00:00Z').toISOString()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/sources') && !init?.method) {
        return new Response(JSON.stringify({
          items: [
            {
              id: 'source-h1',
              clientId: 'client-1',
              url: 'https://example.com/feed.xml',
              canonicalUrl: 'https://example.com/feed.xml',
              sourceType: 'rss',
              identifier: 'https://example.com/feed.xml',
              notes: null,
              createdAt: initialObserved,
              updatedAt: initialObserved,
              lastFetchStatus: 'success',
              lastFetchCompletedAt: initialObserved,
              lastFailureReason: null,
              lastSuccessAt: initialObserved,
              consecutiveFailureCount: 0,
              healthJson: {
                status: 'healthy',
                observedAt: initialObserved,
                lastFetchedAt: initialObserved,
                consecutiveFailures: 0,
              },
            },
          ],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    const wrapper = await mountPanel(fetchMock)
    await flushPromises()

    const vm = wrapper.vm as unknown as { sources: Array<{ health: { status: string }; canonicalUrl: string }> }
    expect(vm.sources[0]?.health.status).toBe('healthy')
    expect(wrapper.text()).toContain('Success')

    const observedAt = new Date('2025-04-02T12:00:00Z').toISOString()
    lastHandler.onEvent?.({
      eventType: 'source.health',
      schemaVersion: 1,
      clientId: 'client-1',
      entityId: 'source-h1',
      timestamp: observedAt,
      payload: {
        clientId: 'client-1',
        sourceId: 'source-h1',
        sourceType: 'rss',
        status: 'error',
        lastFetchedAt: observedAt,
        failureReason: 'http_5xx',
        observedAt,
        consecutiveFailures: 4,
        staleSince: null,
      },
    })
    await flushPromises()

    expect(vm.sources[0]?.health.status).toBe('error')
    expect(vm.sources[0]?.health.consecutiveFailures).toBe(4)
    expect(wrapper.text()).toContain('Error')
  })
})
