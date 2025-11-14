// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createApp, eventHandler, readBody as h3ReadBody, toNodeListener } from 'h3'
import { fetchNodeRequestHandler } from 'node-mock-http'

import {
  FlexCapabilityRegistryService,
  setFlexCapabilityRegistryService,
  resetFlexCapabilityRegistryService
} from '../src/services/flex-capability-registry'
import {
  type FlexCapabilityRepository,
  type FlexCapabilityRow
} from '../src/services/flex-capability-repository'
import {
  buildPostConditionMetadata,
  buildPostConditionDslSnapshot,
  type CapabilityRegistration
} from '@awesomeposter/shared'

class InMemoryRepository implements FlexCapabilityRepository {
  private store = new Map<string, FlexCapabilityRow>()

  async upsert(
    payload: CapabilityRegistration,
    { now }: { now: Date },
    facets: { input: string[]; output: string[] }
  ): Promise<void> {
    const existing = this.store.get(payload.capabilityId)
    const registeredAt = existing?.registeredAt ?? now
    const createdAt = existing?.createdAt ?? now
    const postConditions = payload.postConditions && payload.postConditions.length ? payload.postConditions : null
    const postConditionsDsl = postConditions ? buildPostConditionDslSnapshot(postConditions) : null
    const postConditionMetadata = postConditions ? buildPostConditionMetadata(postConditions) : null
    const row: FlexCapabilityRow = {
      capabilityId: payload.capabilityId,
      version: payload.version,
      displayName: payload.displayName,
      summary: payload.summary,
      agentType: payload.agentType ?? 'ai',
      inputTraits: (payload.inputTraits ?? null) as any,
      inputContract: (payload.inputContract ?? null) as any,
      outputContract: (payload.outputContract ?? null) as any,
      inputFacets: facets.input,
      outputFacets: facets.output,
      cost: (payload.cost ?? null) as any,
      preferredModels: payload.preferredModels ?? [],
      heartbeat: (payload.heartbeat ?? null) as any,
      instructionTemplates: (payload.instructionTemplates ?? null) as any,
      assignmentDefaults: (payload.assignmentDefaults ?? null) as any,
      metadata: (payload.metadata ?? null) as any,
      postConditionsDsl,
      postConditionMetadata,
      status: 'active',
      lastSeenAt: now,
      registeredAt,
      createdAt,
      updatedAt: now
    }
    this.store.set(payload.capabilityId, row)
  }

  async list(): Promise<FlexCapabilityRow[]> {
    return Array.from(this.store.values()).map((row) => ({ ...row }))
  }

  async markInactive(ids: string[], timestamp: Date): Promise<void> {
    for (const id of ids) {
      const row = this.store.get(id)
      if (!row) continue
      row.status = 'inactive'
      row.updatedAt = timestamp
    }
  }
}

function makeApp(handler: any) {
  const app = createApp()
  app.use('/api/v1/flex/capabilities/register', handler)
  const listener = toNodeListener(app) as unknown as Parameters<typeof fetchNodeRequestHandler>[0]
  return async (payload?: any) => {
    const method = 'POST'
    const body = payload ? JSON.stringify(payload) : undefined
    const headers: Record<string, string> = { accept: 'application/json' }
    if (body) headers['content-type'] = 'application/json'
    const res = await fetchNodeRequestHandler(listener, 'http://test.local/api/v1/flex/capabilities/register', {
      method,
      headers,
      body
    })
    const text = await res.text()
    let parsed: any = null
    if (text) {
      try { parsed = JSON.parse(text) } catch { parsed = text }
    }
    return { status: res.status, body: parsed }
  }
}

describe('POST /api/v1/flex/capabilities/register', () => {
  let service: FlexCapabilityRegistryService

  beforeEach(() => {
    vi.stubGlobal('defineEventHandler', (fn: any) => eventHandler(fn))
    vi.stubGlobal('readBody', (event: any) => h3ReadBody(event as any))
    service = new FlexCapabilityRegistryService(new InMemoryRepository(), { cacheTtlMs: 0 })
    setFlexCapabilityRegistryService(service)
  })

  afterEach(() => {
    resetFlexCapabilityRegistryService()
    vi.unstubAllGlobals()
  })

  it('validates payloads and registers capabilities', async () => {
    const { default: handler } = await import('../routes/api/v1/flex/capabilities/register.post')
    const request = makeApp(handler as any)
    const payload: CapabilityRegistration = {
      capabilityId: 'planner.core',
      version: '0.0.1',
      displayName: 'Planner Core',
      summary: 'Plans tasks dynamically.',
      agentType: 'ai',
      inputContract: {
        mode: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            objective: { type: 'string' },
            constraints: { type: 'object' }
          },
          additionalProperties: true
        }
      },
      heartbeat: { intervalSeconds: 5 },
      outputContract: {
        mode: 'json_schema',
        schema: {
          type: 'object',
          properties: { plan: { type: 'array' } }
        }
      },
      cost: { tier: 'standard' }
    }

    const res = await request(payload)
    expect(res.status).toBe(200)
    expect(res.body?.ok).toBe(true)
    expect(res.body?.record?.capabilityId).toBe('planner.core')
    expect(res.body?.registry?.count).toBe(1)
  })

  it('returns 400 for invalid payloads', async () => {
    const { default: handler } = await import('../routes/api/v1/flex/capabilities/register.post')
    const request = makeApp(handler as any)

    const res = await request({ displayName: 'Broken' })
    expect(res.status).toBe(400)
    expect(res.body?.statusMessage).toBe('Invalid capability registration payload')
  })
})
