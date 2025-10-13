// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, eventHandler, readBody as h3ReadBody, toNodeListener } from 'h3'
import { fetchNodeRequestHandler } from 'node-mock-http'

const requireFeatureMock = vi.fn<(clientId: string) => Promise<void>>()

class MockFeatureFlagDisabledError extends Error {
  statusCode = 403
  clientId: string
  feature: string

  constructor(clientId: string, feature: string, message?: string) {
    super(message ?? `${feature} disabled for client ${clientId}`)
    this.name = 'FeatureFlagDisabledError'
    this.clientId = clientId
    this.feature = feature
  }
}

vi.mock('../src/utils/feature-flags', () => ({
  FeatureFlagDisabledError: MockFeatureFlagDisabledError,
  requireDiscoveryFeatureEnabled: requireFeatureMock
}))

function buildApp(handler: any) {
  const app = createApp()
  app.use('/api/v1/flex/run.stream', handler)
  const listener = toNodeListener(app)
  return async (payload: unknown) => {
    const method = 'POST'
    const body = payload ? JSON.stringify(payload) : undefined
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/json'
    }
    const res = await fetchNodeRequestHandler(listener, 'http://test.local/api/v1/flex/run.stream', {
      method,
      headers,
      body
    })
    const text = await res.text()
    let parsed: any = null
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = text
      }
    }
    return { status: res.status, body: parsed, headers: res.headers }
  }
}

describe('POST /api/v1/flex/run.stream feature gating', () => {
  beforeEach(() => {
    vi.stubGlobal('defineEventHandler', (fn: any) => eventHandler(fn))
    vi.stubGlobal('readBody', (event: any) => h3ReadBody(event as any))
    requireFeatureMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects requests missing metadata.clientId', async () => {
    const { default: handler } = await import('../routes/api/v1/flex/run.stream.post')
    const request = buildApp(handler as any)

    const payload = {
      objective: 'Write something great',
      outputContract: { mode: 'json_schema', schema: {} }
    }

    const res = await request(payload)
    expect(res.status).toBe(400)
    expect(res.body?.statusMessage).toBe('Flex runs require metadata.clientId for feature gating')
    expect(res.headers.get('x-correlation-id')).toBeTruthy()
    expect(requireFeatureMock).not.toHaveBeenCalled()
  })

  it('returns 403 when discovery feature flag is disabled', async () => {
    requireFeatureMock.mockImplementation(async (clientId) => {
      throw new MockFeatureFlagDisabledError(clientId, 'discovery', 'Discovery agent is not enabled for this client.')
    })

    const { default: handler } = await import('../routes/api/v1/flex/run.stream.post')
    const request = buildApp(handler as any)

    const payload = {
      objective: 'Generate Linkedin posts',
      metadata: { clientId: '  tenant-123  ' },
      outputContract: { mode: 'json_schema', schema: {} }
    }

    const res = await request(payload)
    expect(requireFeatureMock).toHaveBeenCalledWith('tenant-123')
    expect(res.status).toBe(403)
    expect(res.body?.statusMessage).toBe('Discovery agent is not enabled for this client.')
  })
})
