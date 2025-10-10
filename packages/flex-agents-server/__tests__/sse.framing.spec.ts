// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

// Mock h3 setHeader used by createSse
vi.mock('h3', () => ({
  setHeader: (event: any, name: string, value: string) => event?.node?.res?.setHeader?.(name, value)
}))

function createFakeRes() {
  const headers: Record<string, string> = {}
  let ended = false
  const chunks: string[] = []
  return {
    setHeader: (k: string, v: string) => {
      headers[k] = v
    },
    write: (chunk: any) => {
      if (ended) return false
      const str = typeof chunk === 'string' ? chunk : String(chunk)
      chunks.push(str)
      return true
    },
    end: () => {
      ended = true
    },
    flushHeaders: () => {},
    _chunks: chunks,
    _headers: headers,
    _ended: () => ended
  }
}

describe('SSE framing and order', () => {
  it('writes named event frames with incremental ids', async () => {
    const { createSse } = await import('../src/utils/sse')
    const req: any = { on: () => {} }
    const res = createFakeRes()
    const event: any = { node: { req, res } }
    const sse = createSse(event, { correlationId: 'cid-1', heartbeatMs: 60_000 })

    await sse.send({ type: 'start', message: 'a' })
    await sse.send({ type: 'metrics', tokens: 1 })
    await sse.send({ type: 'complete', data: { ok: true } })
    sse.close()

    const joined = res._chunks.join('')
    expect(joined.startsWith(':\n\n')).toBe(true)
    expect(joined).toContain('event: start')
    expect(joined).toContain('event: metrics')
    expect(joined).toContain('event: complete')
    expect(joined).toMatch(/id: 1\n/)
    expect(joined).toMatch(/id: 2\n/)
    expect(joined).toMatch(/id: 3\n/)
    const dataLines = joined
      .split('\n')
      .filter((l: string) => l.startsWith('data: '))
      .map((l: string) => l.slice(6))
    for (const d of dataLines) JSON.parse(d)
    // Headers set
    expect(res._headers['Content-Type']).toContain('text/event-stream')
    expect(res._headers['X-Accel-Buffering']).toBe('no')
  })
})
