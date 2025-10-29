// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, eventHandler, toNodeListener } from 'h3'
import { fetchNodeRequestHandler } from 'node-mock-http'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'pathe'
import {
  getMarketingCapabilityIds,
  getMarketingCapabilityCatalog
} from '@awesomeposter/shared'
import { isFlexSandboxEnabled } from '../src/utils/flex-sandbox'

const ROUTE_PATH = '../routes/api/v1/flex/sandbox/metadata.get'

function makeRequest(handler: any) {
  const app = createApp()
  app.use('/api/v1/flex/sandbox/metadata', handler)
  const listener = toNodeListener(app)
  return async () => {
    const res = await fetchNodeRequestHandler(listener, 'http://test.local/api/v1/flex/sandbox/metadata', {
      method: 'GET',
      headers: { accept: 'application/json' }
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
    return { status: res.status, body: parsed }
  }
}

describe('GET /api/v1/flex/sandbox/metadata', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('defineEventHandler', (fn: any) => eventHandler(fn))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env = { ...originalEnv }
  })

  it('returns 404 when sandbox flag disabled', async () => {
    process.env.USE_FLEX_DEV_SANDBOX = 'false'
    process.env.VITE_USE_FLEX_DEV_SANDBOX = 'false'
    expect(isFlexSandboxEnabled()).toBe(false)
    const { default: handler } = await import(ROUTE_PATH)
    const request = makeRequest(handler as any)
    const res = await request()
    expect(res.status).toBe(404)
  })

  it('returns facet, capability, and template data when enabled', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'flex-sandbox-'))
    try {
      const templatePath = join(tempDir, 'flex-sample.json')
      await fs.writeFile(
        templatePath,
        JSON.stringify({
          objective: 'Inspect planner output',
          inputs: {},
          policies: { runtime: [] },
          outputContract: { mode: 'json_schema', schema: { type: 'object', additionalProperties: true } }
        }),
        'utf8'
      )

      process.env.USE_FLEX_DEV_SANDBOX = 'true'
      process.env.VITE_USE_FLEX_DEV_SANDBOX = 'true'
      process.env.FLEX_SANDBOX_TEMPLATE_DIR = tempDir

      const { default: handler } = await import(ROUTE_PATH)
      const request = makeRequest(handler as any)
      const res = await request()
      expect(res.status).toBe(200)

      const marketingIds = getMarketingCapabilityIds()
      const catalogIds = getMarketingCapabilityCatalog().map((entry) => entry.id)

      expect(res.body).toMatchObject({
        facets: expect.arrayContaining([
          expect.objectContaining({ name: 'post_context' }),
          expect.objectContaining({ name: 'creative_brief' }),
          expect.objectContaining({ name: 'post_copy' })
        ]),
        capabilities: {
          active: expect.arrayContaining(marketingIds.map((id) => expect.objectContaining({ capabilityId: id }))),
          all: expect.arrayContaining(marketingIds.map((id) => expect.objectContaining({ capabilityId: id })))
        },
        capabilityCatalog: expect.arrayContaining(
          catalogIds.map((id) => expect.objectContaining({ id }))
        ),
        templates: expect.arrayContaining([
          expect.objectContaining({
            id: expect.stringContaining('sample'),
            filename: 'flex-sample.json',
            envelope: expect.objectContaining({ objective: 'Inspect planner output' })
          })
        ])
      })
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

  it('falls back to legacy registry when FLEX_SANDBOX_LEGACY_CATALOG=true', async () => {
    const tempDir = await fs.mkdtemp(join(tmpdir(), 'flex-sandbox-legacy-'))
    try {
      const templatePath = join(tempDir, 'flex-legacy.json')
      await fs.writeFile(
        templatePath,
        JSON.stringify({
          objective: 'Legacy planner output'
        }),
        'utf8'
      )

      process.env.USE_FLEX_DEV_SANDBOX = 'true'
      process.env.VITE_USE_FLEX_DEV_SANDBOX = 'true'
      process.env.FLEX_SANDBOX_TEMPLATE_DIR = tempDir
      process.env.FLEX_SANDBOX_LEGACY_CATALOG = 'true'

      const snapshot = {
        active: [
          {
            capabilityId: 'writer.v1',
            version: '1.0',
            displayName: 'Writer',
            summary: 'Writes things',
            inputTraits: null,
            inputContract: null,
            outputContract: { mode: 'json_schema', schema: { type: 'object' } },
            cost: null,
            preferredModels: [],
            heartbeat: null,
            metadata: null,
            status: 'active',
            lastSeenAt: new Date().toISOString(),
            registeredAt: new Date().toISOString(),
            inputFacets: ['objectiveBrief'],
            outputFacets: ['copyVariants']
          }
        ],
        all: [
          {
            capabilityId: 'writer.v1',
            version: '1.0',
            displayName: 'Writer',
            summary: 'Writes things',
            inputTraits: null,
            inputContract: null,
            outputContract: { mode: 'json_schema', schema: { type: 'object' } },
            cost: null,
            preferredModels: [],
            heartbeat: null,
            metadata: null,
            status: 'active',
            lastSeenAt: new Date().toISOString(),
            registeredAt: new Date().toISOString(),
            inputFacets: ['objectiveBrief'],
            outputFacets: ['copyVariants']
          }
        ]
      }

      vi.doMock('../src/services/flex-capability-registry', () => ({
        getFlexCapabilityRegistryService: () => ({
          getSnapshot: vi.fn().mockResolvedValue(snapshot)
        })
      }))

      vi.doMock('../src/services/agents-container', () => ({
        getCapabilityRegistry: () => [
          { id: 'strategy', name: 'Strategy', description: 'Plans things', create: vi.fn() },
          { id: 'qa', name: 'QA', description: 'Checks things', create: vi.fn() }
        ],
        resolveCapabilityPrompt: (id: string) =>
          id === 'strategy'
            ? { instructions: 'Plan carefully', toolsAllowlist: ['plan'] }
            : { instructions: 'Check output', toolsAllowlist: ['verify'] }
      }))

      const { default: handler } = await import(ROUTE_PATH)
      const request = makeRequest(handler as any)
      const res = await request()
      expect(res.status).toBe(200)
      expect(res.body.capabilityCatalog).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'strategy' }), expect.objectContaining({ id: 'qa' })])
      )
      expect(res.body.capabilities.active).toEqual(
        expect.arrayContaining([expect.objectContaining({ capabilityId: 'writer.v1' })])
      )
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })
})
