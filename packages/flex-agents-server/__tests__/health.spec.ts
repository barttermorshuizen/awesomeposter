// @vitest-environment node
import { describe, it, expect } from 'vitest'

// Minimal Nitro macro shim
(globalThis as any).defineEventHandler = (fn: any) => fn

describe('health route smoke', () => {
  it('returns health payload with expected shape', async () => {
    const mod = await import('../routes/api/v1/health.get')
    const handler = (mod as any).default as (e: any) => Promise<any>
    const result = await handler({})

    expect(result).toBeTruthy()
    expect(typeof result.status).toBe('string')
    expect(typeof result.timestamp).toBe('string')
    expect(typeof result.uptimeSeconds).toBe('number')
    expect(result.services).toBeTruthy()
    expect(result.services.database).toHaveProperty('ok')
    expect(result.services.openai).toHaveProperty('configured')
    expect(result.env).toBeTruthy()
    expect(result.env).toHaveProperty('nodeEnv')
  })
})

