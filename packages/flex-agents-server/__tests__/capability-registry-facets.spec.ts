// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import type { CapabilityRegistration } from '@awesomeposter/shared'

import { STRATEGY_CAPABILITY } from '../src/agents/strategy-manager'
import { CONTENT_CAPABILITY } from '../src/agents/content-generator'
import { QA_CAPABILITY } from '../src/agents/quality-assurance'
import {
  HUMAN_ASSIGNMENT_TIMEOUT_SECONDS,
  HUMAN_CLARIFY_CAPABILITY
} from '../src/agents/human-clarify-brief'
import {
  FlexCapabilityRegistryService
} from '../src/services/flex-capability-registry'
import {
  type FlexCapabilityRepository,
  type FlexCapabilityRow
} from '../src/services/flex-capability-repository'

class InMemoryRepository implements FlexCapabilityRepository {
  private readonly store = new Map<string, FlexCapabilityRow>()

  async upsert(
    payload: CapabilityRegistration,
    { now }: { now: Date },
    facets: { input: string[]; output: string[] }
  ): Promise<void> {
    const existing = this.store.get(payload.capabilityId)
    const registeredAt = existing?.registeredAt ?? now
    const createdAt = existing?.createdAt ?? now
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

  getRow(id: string) {
    const row = this.store.get(id)
    return row ? { ...row } : undefined
  }
}

describe('FlexCapabilityRegistryService with facet contracts', () => {
  let repo: InMemoryRepository
  let service: FlexCapabilityRegistryService

  beforeEach(() => {
    repo = new InMemoryRepository()
    service = new FlexCapabilityRegistryService(repo, { cacheTtlMs: 0 })
  })

  it('compiles facet-backed contracts for registered capabilities', async () => {
    await service.register(STRATEGY_CAPABILITY)
    await service.register(CONTENT_CAPABILITY)
    await service.register(QA_CAPABILITY)
    await service.register(HUMAN_CLARIFY_CAPABILITY)

    const strategy = await service.getCapabilityById(STRATEGY_CAPABILITY.capabilityId)
    expect(strategy?.inputContract?.mode).toBe('json_schema')
    expect(strategy?.inputFacets).toEqual(expect.arrayContaining(['objectiveBrief', 'audienceProfile', 'toneOfVoice', 'assetBundle']))
    expect(strategy?.outputFacets).toEqual(expect.arrayContaining(['writerBrief', 'planKnobs', 'strategicRationale']))

    const persisted = repo.getRow(CONTENT_CAPABILITY.capabilityId)
    expect(persisted?.inputFacets).toEqual(['writerBrief', 'planKnobs', 'toneOfVoice', 'audienceProfile'])
    expect(persisted?.outputFacets).toEqual(['copyVariants'])

    const humanRow = repo.getRow(HUMAN_CLARIFY_CAPABILITY.capabilityId)
    expect(humanRow?.agentType).toBe('human')
    expect(humanRow?.assignmentDefaults).toEqual(
      expect.objectContaining({
        timeoutSeconds: HUMAN_ASSIGNMENT_TIMEOUT_SECONDS,
        maxNotifications: 1,
        onDecline: 'fail_run'
      })
    )

    const human = await service.getCapabilityById(HUMAN_CLARIFY_CAPABILITY.capabilityId)
    expect(human?.agentType).toBe('human')
    expect(human?.inputFacets).toEqual([
      'objectiveBrief',
      'audienceProfile',
      'toneOfVoice',
      'writerBrief',
      'clarificationRequest'
    ])
    expect(human?.outputFacets).toEqual(['clarificationResponse'])
    expect(human?.instructionTemplates?.app).toContain('human strategist')
    expect(human?.assignmentDefaults?.timeoutSeconds).toBe(HUMAN_ASSIGNMENT_TIMEOUT_SECONDS)
    expect(human?.assignmentDefaults?.maxNotifications).toBe(1)
    expect(human?.assignmentDefaults?.onDecline).toBe('fail_run')
  })

  it('rejects registrations that reference unknown facets', async () => {
    const payload: CapabilityRegistration = {
      ...STRATEGY_CAPABILITY,
      capabilityId: 'StrategyManagerAgent.invalidFacets',
      inputContract: {
        mode: 'facets',
        facets: ['objectiveBrief', 'notRealFacet']
      }
    }

    await expect(service.register(payload)).rejects.toThrow(/notRealFacet/i)
  })

  it('rejects facets with incompatible directionality', async () => {
    const payload: CapabilityRegistration = {
      ...CONTENT_CAPABILITY,
      capabilityId: 'ContentGeneratorAgent.invalidDirection',
      inputContract: {
        mode: 'facets',
        facets: ['qaFindings']
      }
    }

    await expect(service.register(payload)).rejects.toThrow(/qaFindings/i)
  })

  it('rejects registrations that omit output contracts', async () => {
    const payload: CapabilityRegistration = {
      ...STRATEGY_CAPABILITY,
      capabilityId: 'StrategyManagerAgent.missingOutput'
    }
    // Simulate a legacy caller failing to provide output contracts
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (payload as any).outputContract

    await expect(service.register(payload)).rejects.toThrow(/missing an output contract/i)
  })
})
