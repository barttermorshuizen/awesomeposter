// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const runSpy = vi.fn()

vi.mock('../src/utils/sse', () => ({
  createSse: () => ({
    send: vi.fn().mockResolvedValue(undefined),
    close: vi.fn()
  })
}))

vi.mock('../src/utils/concurrency', () => ({
  withSseConcurrency: async (fn: () => Promise<void>) => {
    await fn()
  },
  sseSemaphore: { pending: 0, used: 0 },
  isBacklogFull: () => false,
  backlogSnapshot: () => ({ pending: 0, limit: 1 })
}))

vi.mock('../src/services/flex-run-coordinator', () => ({
  FlexRunCoordinator: class {
    async run(envelope: unknown) {
      runSpy(envelope)
    }
  }
}))

vi.mock('../src/services/logger', () => ({
  genCorrelationId: () => 'cid-test',
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn()
  })
}))

// Shim Nitro helpers consumed by the route
vi.stubGlobal('defineEventHandler', (fn: any) => fn)
vi.stubGlobal('createError', (opts: any) => {
  const err: any = new Error(opts?.statusMessage || 'Error')
  err.statusCode = opts?.statusCode
  err.data = opts?.data
  return err
})
vi.stubGlobal('sendNoContent', vi.fn())
vi.stubGlobal('setHeader', vi.fn())
vi.stubGlobal('readBody', (event: any) => Promise.resolve(event?.context?.body))
vi.stubGlobal('getHeader', () => undefined)
vi.stubGlobal('getMethod', (event: any) => event?.node?.req?.method ?? 'POST')

describe('flex run DSL validation', () => {
  beforeEach(() => {
    runSpy.mockReset()
  })

  it('rejects invalid DSL expressions before starting the run', async () => {
    const mod = await import('../routes/api/v1/flex/run.stream.post')
    const handler = (mod as any).default as (event: any) => Promise<unknown>

    const event: any = {
      node: {
        req: { method: 'POST', headers: {} },
        res: { setHeader: vi.fn() }
      },
      context: {
        body: {
          objective: 'Invalid DSL run',
          inputs: {},
          policies: {
            runtime: [
              {
                id: 'invalid_dsl',
                trigger: { kind: 'onNodeComplete', condition: { dsl: 'facets.planKnobs.hookIntensity <' } },
                action: { type: 'replan' }
              }
            ]
          },
          outputContract: { mode: 'json_schema', schema: { type: 'object' } }
        }
      }
    }

    await expect(handler(event)).rejects.toMatchObject({ statusCode: 400, data: { code: 'invalid_condition_dsl' } })
    expect(runSpy).not.toHaveBeenCalled()
  })

  it('compiles DSL expressions into JSON-Logic before invoking the coordinator', async () => {
    const mod = await import('../routes/api/v1/flex/run.stream.post')
    const handler = (mod as any).default as (event: any) => Promise<unknown>

    const envelope = {
      objective: 'Valid DSL run',
      inputs: {},
      policies: {
        runtime: [
          {
            id: 'qa_gate',
            trigger: {
              kind: 'onNodeComplete',
              condition: { dsl: 'facets.planKnobs.hookIntensity < 0.4' }
            },
            action: { type: 'replan' }
          }
        ]
      },
      outputContract: { mode: 'json_schema', schema: { type: 'object' } }
    }

    const event: any = {
      node: {
        req: { method: 'POST', headers: {} },
        res: { setHeader: vi.fn() }
      },
      context: { body: envelope }
    }

    await handler(event)

    expect(runSpy).toHaveBeenCalledTimes(1)
    const normalized = runSpy.mock.calls[0][0] as any
    const condition = normalized.policies.runtime[0].trigger.condition

    expect(condition.jsonLogic).toEqual({
      '<': [{ var: 'metadata.runContextSnapshot.facets.planKnobs.value.hookIntensity' }, 0.4]
    })
    expect(condition.dsl).toBe('facets.planKnobs.hookIntensity < 0.4')
    expect(condition.canonicalDsl).toBe('facets.planKnobs.hookIntensity < 0.4')
  })
})
