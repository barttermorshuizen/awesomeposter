// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import type { CapabilityRegistration } from '@awesomeposter/shared'

import { STRATEGIST_SOCIAL_POSTING_CAPABILITY } from '../src/agents/marketing/strategist-social-posting'
import { COPYWRITER_SOCIAL_DRAFTING_CAPABILITY } from '../src/agents/marketing/copywriter-socialpost-drafting'
import { DIRECTOR_POSITIONING_REVIEW_CAPABILITY } from '../src/agents/marketing/director-positioning-review'
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
    await service.register(STRATEGIST_SOCIAL_POSTING_CAPABILITY)
    await service.register(COPYWRITER_SOCIAL_DRAFTING_CAPABILITY)
    await service.register(DIRECTOR_POSITIONING_REVIEW_CAPABILITY)
    await service.register(HUMAN_CLARIFY_CAPABILITY)

    const strategist = await service.getCapabilityById(STRATEGIST_SOCIAL_POSTING_CAPABILITY.capabilityId)
    expect(strategist?.inputContract?.mode).toBe('json_schema')
    expect(strategist?.inputFacets).toEqual(
      expect.arrayContaining(['company_information', 'post_context', 'feedback'])
    )
    expect(strategist?.outputFacets).toEqual(expect.arrayContaining(['creative_brief', 'strategic_rationale', 'handoff_summary']))

    const copywriterRow = repo.getRow(COPYWRITER_SOCIAL_DRAFTING_CAPABILITY.capabilityId)
    expect(copywriterRow?.inputFacets).toEqual([
      'company_information',
      'creative_brief',
      'handoff_summary',
      'feedback'
    ])
    expect(copywriterRow?.outputFacets).toEqual(['post_copy', 'handoff_summary'])

    const directorRow = repo.getRow(DIRECTOR_POSITIONING_REVIEW_CAPABILITY.capabilityId)
    expect(directorRow?.agentType).toBe('human')
    expect(directorRow?.inputFacets).toEqual([
      'company_information',
      'positioning_context',
      'value_canvas',
      'positioning_opportunities',
      'positioning_recommendation',
      'messaging_stack'
    ])
    expect(directorRow?.outputFacets).toEqual(['positioning', 'feedback'])

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
      ...STRATEGIST_SOCIAL_POSTING_CAPABILITY,
      capabilityId: 'Strategist.invalidFacets',
      inputContract: {
        mode: 'facets',
        facets: ['objectiveBrief', 'notRealFacet']
      }
    }

    await expect(service.register(payload)).rejects.toThrow(/notRealFacet/i)
  })

  it('rejects facets with incompatible directionality', async () => {
    const payload: CapabilityRegistration = {
      ...COPYWRITER_SOCIAL_DRAFTING_CAPABILITY,
      capabilityId: 'Copywriter.invalidDirection',
      inputContract: {
        mode: 'facets',
        facets: ['qaFindings']
      }
    }

    await expect(service.register(payload)).rejects.toThrow(/qaFindings/i)
  })

  it('rejects registrations that omit output contracts', async () => {
    const payload: CapabilityRegistration = {
      ...STRATEGIST_SOCIAL_POSTING_CAPABILITY,
      capabilityId: 'Strategist.missingOutput'
    }
    // Simulate a caller failing to provide output contracts
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (payload as any).outputContract

    await expect(service.register(payload)).rejects.toThrow(/missing an output contract/i)
  })
})
