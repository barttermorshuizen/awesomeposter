// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import type { CapabilityRegistration } from '@awesomeposter/shared'

import {
  FlexCapabilityRegistryService
} from '../src/services/flex-capability-registry'
import {
  type FlexCapabilityRepository,
  type FlexCapabilityRow
} from '../src/services/flex-capability-repository'

class InMemoryFlexCapabilityRepository implements FlexCapabilityRepository {
  private store = new Map<string, FlexCapabilityRow>()

  async upsert(payload: CapabilityRegistration, { now }: { now: Date }): Promise<void> {
    const existing = this.store.get(payload.capabilityId)
    const registeredAt = existing?.registeredAt ?? now
    const createdAt = existing?.createdAt ?? now
    const row: FlexCapabilityRow = {
      capabilityId: payload.capabilityId,
      version: payload.version,
      displayName: payload.displayName,
      summary: payload.summary,
      inputTraits: (payload.inputTraits ?? null) as any,
      inputContract: (payload.inputContract ?? null) as any,
      outputContract: (payload.outputContract ?? null) as any,
      cost: (payload.cost ?? null) as any,
      preferredModels: payload.preferredModels ?? [],
      heartbeat: (payload.heartbeat ?? null) as any,
      metadata: (payload.metadata ?? null) as any,
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
    ids.forEach((id) => {
      const row = this.store.get(id)
      if (!row) return
      row.status = 'inactive'
      row.updatedAt = timestamp
    })
  }

  getRow(id: string) {
    const row = this.store.get(id)
    return row ? { ...row } : undefined
  }
}

describe('FlexCapabilityRegistryService', () => {
  let repo: InMemoryFlexCapabilityRepository
  let now: Date
  let service: FlexCapabilityRegistryService

  const basePayload: CapabilityRegistration = {
    capabilityId: 'writer.en',
    version: '1.0.0',
    displayName: 'English Writer',
    summary: 'Writes marketing copy in English.',
    inputTraits: { languages: ['en'] },
    inputContract: {
      mode: 'json_schema',
      schema: {
        type: 'object',
        properties: {
          writerBrief: { type: 'object' },
          payload: { type: 'object' }
        },
        additionalProperties: true
      }
    },
    outputContract: {
      schema: {
        type: 'object',
        properties: {
          content: { type: 'string' }
        },
        required: ['content']
      }
    },
    cost: { tier: 'standard' },
    preferredModels: ['gpt-4o-mini'],
    heartbeat: { intervalSeconds: 5, timeoutSeconds: 10 },
    metadata: { team: 'writers' }
  }

  beforeEach(() => {
    now = new Date('2025-01-01T00:00:00.000Z')
    repo = new InMemoryFlexCapabilityRepository()
    service = new FlexCapabilityRegistryService(repo, {
      cacheTtlMs: 0,
      now: () => now
    })
  })

  it('registers a capability and exposes it via the active registry', async () => {
    const record = await service.register(basePayload)
    expect(record.status).toBe('active')
    expect(record.lastSeenAt).toBe(now.toISOString())

    const active = await service.listActive()
    expect(active).toHaveLength(1)
    expect(active[0].capabilityId).toBe('writer.en')
  })

  it('deduplicates by capabilityId and updates lastSeenAt on refresh', async () => {
    await service.register(basePayload)
    const firstSnapshot = await service.getSnapshot()
    expect(firstSnapshot.active[0].registeredAt).toBe(now.toISOString())

    now = new Date('2025-01-01T00:02:00.000Z')
    await service.register({ ...basePayload, summary: 'Updated summary' })

    const active = await service.listActive()
    expect(active).toHaveLength(1)
    expect(active[0].summary).toBe('Updated summary')
    expect(active[0].lastSeenAt).toBe(now.toISOString())
    expect(active[0].registeredAt).toBe(firstSnapshot.active[0].registeredAt)
  })

  it('marks capabilities inactive when heartbeat timeout elapses', async () => {
    await service.register(basePayload)
    const activeBefore = await service.listActive()
    expect(activeBefore).toHaveLength(1)

    now = new Date('2025-01-01T00:00:15.000Z')
    const activeAfter = await service.listActive()
    expect(activeAfter).toHaveLength(0)

    const snapshot = await service.getSnapshot()
    expect(snapshot.all).toHaveLength(1)
    expect(snapshot.all[0].status).toBe('inactive')

    const stored = repo.getRow('writer.en')
    expect(stored?.status).toBe('inactive')
  })
})
