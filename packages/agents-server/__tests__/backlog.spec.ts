// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Shim Nitro auto-imports used by route files
vi.stubGlobal('defineEventHandler', (fn: any) => fn)
vi.stubGlobal('createError', (opts: any) => {
  const err: any = new Error(opts?.statusMessage || 'Error')
  if (opts?.statusCode) err.statusCode = opts.statusCode
  return err
})
vi.stubGlobal('readBody', (e: any) => Promise.resolve(e?.context?.body))
vi.stubGlobal('getHeader', (e: any, name: string) => e.headers?.[String(name || '').toLowerCase()] || '')

// Mock h3 for header setting in 503 path
vi.mock('h3', () => ({
  setHeader: (event: any, name: string, value: string) => event?.setHeader?.(name, value)
}))

describe('backlog guard', () => {
  beforeEach(() => {
    process.env.SSE_MAX_PENDING = '0' // force immediate rejection
  })

  it('returns 503 when backlog is full before opening SSE', async () => {
    const mod = await import('../routes/api/v1/agent/run.stream.post')
    const handler = (mod as any).default as (e: any) => Promise<any>

    const event: any = {
      headers: { 'x-correlation-id': 'cid-test' },
      context: { body: { mode: 'app', objective: 'x' } },
      setHeader: () => {}
    }

    await expect(handler(event)).rejects.toHaveProperty('statusCode', 503)
  })
})
