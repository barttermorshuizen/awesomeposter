import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ClientDiscoveryKeywordsPanel from '@/components/clients/ClientDiscoveryKeywordsPanel.vue'
import vuetify from '@/plugins/vuetify'
import type { DiscoveryEventHandlers } from '@/lib/discovery-sse'
import { subscribeToDiscoveryEvents } from '@/lib/discovery-sse'

vi.mock('@/lib/discovery-sse', () => ({
  subscribeToDiscoveryEvents: vi.fn().mockReturnValue(() => {}),
}))

describe('ClientDiscoveryKeywordsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(subscribeToDiscoveryEvents as unknown as vi.Mock).mockReturnValue(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function mountPanel(fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
    vi.spyOn(global, 'fetch').mockImplementation(fetchImpl)
    const wrapper = mount(ClientDiscoveryKeywordsPanel, {
      props: { clientId: '123' },
      global: { plugins: [vuetify] },
    })
    await flushPromises()
    return wrapper
  }

  it('rejects non-ASCII keywords before submitting', async () => {
    const wrapper = await mountPanel(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/keywords') && !init?.method) {
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    const vm = wrapper.vm as unknown as {
      submit: () => Promise<void>
      form: { keyword: string }
      fieldError: string | null
    }

    vm.form.keyword = 'café'
    await vm.submit()
    await flushPromises()
    expect(vm.fieldError ?? '').toContain('ASCII')
  })

  it('blocks duplicates that only differ by hyphenation', async () => {
    const wrapper = await mountPanel(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/keywords') && !init?.method) {
        return new Response(JSON.stringify({
          items: [
            {
              id: 'kw-1',
              clientId: '123',
              keyword: 'account-based marketing',
              addedBy: null,
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
      form: { keyword: string }
      duplicateWarning: string | null
    }

    vm.form.keyword = 'account based marketing'
    await vm.submit()
    await flushPromises()
    expect(vm.duplicateWarning ?? '').toContain('already exists')
  })

  it('stops new entries when the keyword limit is reached', async () => {
    const wrapper = await mountPanel(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/keywords') && !init?.method) {
        return new Response(JSON.stringify({
          items: Array.from({ length: 20 }).map((_, index) => ({
            id: `kw-${index}`,
            clientId: '123',
            keyword: `keyword-${index}`,
            addedBy: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })),
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    const vm = wrapper.vm as unknown as {
      submit: () => Promise<void>
      form: { keyword: string }
    }

    vm.form.keyword = 'new keyword'
    await vm.submit()
    await flushPromises()
    const postCalls = (fetch as unknown as vi.Mock).mock.calls.filter(([, requestInit]) => requestInit?.method === 'POST')
    expect(postCalls).toHaveLength(0)
    expect(wrapper.html()).toContain('Keyword limit reached (20)')
  })

  it('reloads keywords when SSE keyword updates arrive', async () => {
    const listeners: DiscoveryEventHandlers[] = []
    ;(subscribeToDiscoveryEvents as unknown as vi.Mock).mockImplementation((_clientId, handler) => {
      listeners.push(handler)
      return () => {}
    })

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/keywords') && !init?.method) {
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    await mountPanel(fetchMock)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const handler = listeners[0]
    handler.onKeywordUpdated?.({
      clientId: '123',
      keywords: ['example'],
      updatedAt: new Date().toISOString(),
    })
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
