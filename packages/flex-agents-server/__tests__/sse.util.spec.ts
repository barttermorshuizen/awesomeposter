// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'

// Mock h3 setHeader used by createSse
vi.mock('h3', () => ({
  setHeader: (event: any, name: string, value: string) => event?.node?.res?.setHeader?.(name, value)
}))

describe('createSse disconnect handling', () => {
  it('stops sending after client abort', async () => {
    const { createSse } = await import('../src/utils/sse')

    const req = new EventEmitter() as any
    const chunks: string[] = []
    const res = {
      setHeader: (_k: string, _v: string) => {},
      write: (chunk: any) => {
        chunks.push(typeof chunk === 'string' ? chunk : String(chunk))
        return true
      },
      end: () => {},
      flushHeaders: () => {}
    } as any

    const event: any = { node: { req, res } }
    const sse = createSse(event, { correlationId: 'cid', heartbeatMs: 60_000 })

    await sse.send({ type: 'start', message: 'hello' })
    // Simulate client abort
    req.emit('aborted')

    // Further sends should be ignored (no additional frames)
    const before = chunks.length
    await sse.send({ type: 'message', message: 'ignored' })
    expect(chunks.length).toBe(before)

    sse.close()
  })
})
