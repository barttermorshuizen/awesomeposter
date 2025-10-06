import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import BriefsView from '@/views/BriefsView.vue'
import vuetify from '@/plugins/vuetify'
import { useHitlStore } from '@/stores/hitl'

function waitForPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('BriefsView HITL actions', () => {
  const briefRow = {
    id: 'brief-1',
    title: 'Test Brief',
    clientId: 'client-1',
    clientName: 'Client One',
    objective: 'Drive awareness',
    status: 'draft',
    deadlineAt: '2025-01-01T00:00:00.000Z',
    createdAt: '2025-01-01T00:00:00.000Z'
  }

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  function mockFetchWithPendingRun() {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url === '/api/briefs') {
        return new Response(JSON.stringify({ items: [briefRow] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }
      if (url === '/api/hitl/pending') {
        return new Response(
          JSON.stringify({
            runs: [
              {
                runId: 'run-1',
                threadId: 'brief-1',
                briefId: 'brief-1',
                pendingRequestId: 'req-1',
                status: 'awaiting_hitl',
                updatedAt: '2025-01-01T01:00:00.000Z'
              }
            ]
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      }
      return new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    })
  }

  async function mountView() {
    const fetchMock = mockFetchWithPendingRun()
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', name: 'briefs', component: { template: '<div />' } }]
    })
    router.push('/')
    await router.isReady()

    const wrapper = mount(BriefsView, {
      global: {
        plugins: [vuetify, router, pinia],
        stubs: {
          AgentResultsPopup: { template: '<div class="agent-results-popup-stub" />' }
        }
      }
    })
    await waitForPromises()
    return { wrapper, fetchMock }
  }

  it('exposes resume/remove actions when a pending run exists for the brief', async () => {
    const { wrapper } = await mountView()
    const vm = wrapper.vm as unknown as {
      canResumeRun: (id: string) => boolean
      canRemoveRun: (id: string) => boolean
      onMenuToggle: (open: boolean, row: typeof briefRow) => Promise<void>
    }

    await vm.onMenuToggle(true, briefRow)

    expect(vm.canResumeRun('brief-1')).toBe(true)
    expect(vm.canRemoveRun('brief-1')).toBe(true)
    expect(vm.canResumeRun('brief-other')).toBe(false)
  })

  it('removes a suspended run when operator confirms the action', async () => {
    const { wrapper } = await mountView()
    const vm = wrapper.vm as unknown as {
      onRemoveRun: (row: typeof briefRow) => Promise<void>
    }
    const store = useHitlStore()
    const removeSpy = vi.spyOn(store, 'removePendingRun').mockResolvedValue({ ok: true } as any)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})

    await vm.onRemoveRun(briefRow)

    expect(removeSpy).toHaveBeenCalledWith({ reason: 'Operator removed run from brief action menu' })
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(alertSpy).toHaveBeenCalledWith('Running create post removed.')
  })

  it('opens the create-post flow when resuming a suspended run', async () => {
    const { wrapper } = await mountView()
    const vm = wrapper.vm as unknown as {
      onResumeRun: (row: typeof briefRow) => Promise<void>
    }
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})

    await vm.onResumeRun(briefRow)

    expect(alertSpy).not.toHaveBeenCalled()
    // The popup should be opened for the brief that triggered resume.
    expect((wrapper.vm as any).createPostOpen).toBe(true)
    expect((wrapper.vm as any).selectedBrief?.id).toBe('brief-1')
  })

  it('hides resume action for briefs without pending runs', async () => {
    const { wrapper } = await mountView()
    const vm = wrapper.vm as unknown as {
      onMenuToggle: (open: boolean, row: typeof briefRow) => Promise<void>
      canResumeRun: (id: string) => boolean
    }

    await vm.onMenuToggle(true, briefRow)
    expect(vm.canResumeRun('brief-1')).toBe(true)

    const otherBrief = { ...briefRow, id: 'brief-2' }
    await vm.onMenuToggle(true, otherBrief)

    expect(vm.canResumeRun('brief-1')).toBe(true)
    expect(vm.canResumeRun('brief-2')).toBe(false)
  })
})
