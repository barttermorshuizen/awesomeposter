import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import ClientSourcesView from '@/views/ClientSourcesView.vue'
import vuetify from '@/plugins/vuetify'

class MockEventSource {
  public readyState = 1
  private listeners: Record<string, Array<(event: MessageEvent<string>) => void>> = {}

  constructor(public readonly url: string) {}

  addEventListener(type: string, handler: (event: MessageEvent<string>) => void) {
    this.listeners[type] = this.listeners[type] || []
    this.listeners[type].push(handler)
  }

  removeEventListener(type: string, handler: (event: MessageEvent<string>) => void) {
    this.listeners[type] = (this.listeners[type] || []).filter((fn) => fn !== handler)
  }

  close() {
    this.readyState = 2
  }

  emit(type: string, data: unknown) {
    const handlers = this.listeners[type]
    if (!handlers) return
    const event = { data: JSON.stringify(data) } as MessageEvent<string>
    handlers.forEach((fn) => fn(event))
  }
}

declare global {
  interface Window {
    EventSource: typeof MockEventSource
  }
}

describe('ClientSourcesView', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource)
    setActivePinia(createPinia())
  })

  async function mountView(fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
    vi.spyOn(global, 'fetch').mockImplementation(fetchImpl)
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/clients/:id/sources', name: 'clients-sources', component: ClientSourcesView },
        { path: '/clients/:id/edit', name: 'clients-edit', component: { template: '<div />' } },
      ],
    })
    router.push('/clients/123/sources')
    await router.isReady()

    const wrapper = mount(ClientSourcesView, {
      global: {
        plugins: [vuetify, router],
      },
    })
    await flushPromises()
    return wrapper
  }

  it('surfaces inline validation for unsupported protocols', async () => {
    const wrapper = await mountView(async (input) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/sources')) {
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    const vm = wrapper.vm as unknown as {
      submit: () => Promise<void>
      form: { url: string }
      fieldErrors: { url?: string }
    }

    vm.form.url = 'ftp://example.com'
    await vm.submit()
    expect(vm.fieldErrors.url).toContain('Only HTTP(S) URLs are supported')
  })

  it('blocks duplicate submissions before calling the API', async () => {
    const wrapper = await mountView(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.endsWith('/sources') && !init?.method) {
        return new Response(JSON.stringify({
          items: [
            {
              id: 'src-1',
              clientId: '123',
              url: 'https://example.com/feed.xml',
              canonicalUrl: 'https://example.com/feed.xml',
              sourceType: 'rss',
              identifier: 'https://example.com/feed.xml',
              notes: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    const vm = wrapper.vm as unknown as {
      submit: () => Promise<void>
      form: { url: string }
      duplicateWarning: string | null
    }

    vm.form.url = 'https://example.com/feed.xml?utm=123'
    await vm.submit()
    await flushPromises()

    expect(wrapper.html()).toContain('This source already exists for the client.')
    const postCalls = (fetch as unknown as vi.Mock).mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(postCalls).toHaveLength(0)
  })

  it('replaces optimistic row with API response on success', async () => {
    let postCalls = 0
    const wrapper = await mountView(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.endsWith('/sources') && !init?.method) {
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.endsWith('/sources') && init?.method === 'POST') {
        postCalls += 1
        return new Response(JSON.stringify({
          source: {
            id: 'src-2',
            clientId: '123',
            url: 'https://www.youtube.com/channel/UC123',
            canonicalUrl: 'https://www.youtube.com/channel/UC123',
            sourceType: 'youtube-channel',
            identifier: 'UC123',
            notes: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    const vm = wrapper.vm as unknown as {
      submit: () => Promise<void>
      form: { url: string }
      sources: Array<{ id: string; pending?: boolean }>
    }

    vm.form.url = 'https://www.youtube.com/channel/UC123'
    await vm.submit()
    await flushPromises()

    expect(postCalls).toBe(1)
    expect(vm.sources[0]?.id).toBe('src-2')
    expect(vm.sources[0]?.pending).toBeFalsy()
  })
})
