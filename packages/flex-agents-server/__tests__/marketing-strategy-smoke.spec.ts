// @vitest-environment node
import { describe, it, expect } from 'vitest'
import type { CapabilityRecord, TaskEnvelope, FlexCrcsSnapshot } from '@awesomeposter/shared'
import {
  getMarketingCapabilitiesSnapshot,
  getMarketingCapabilityCatalog
} from '@awesomeposter/shared'
import { FlexPlanner } from '../src/services/flex-planner'
import type { PlannerServiceInterface, PlannerServiceInput } from '../src/services/planner-service'
import type { FlexCapabilityRegistryService } from '../src/services/flex-capability-registry'

class MarketingRegistryStub implements FlexCapabilityRegistryService {
  private readonly snapshot = getMarketingCapabilitiesSnapshot()
  async register(): Promise<CapabilityRecord> {
    throw new Error('not implemented')
  }
  async listActive(): Promise<CapabilityRecord[]> {
    return this.snapshot.active
  }
  async getCapabilityById(capabilityId: string): Promise<CapabilityRecord | undefined> {
    return this.snapshot.active.find((entry) => entry.capabilityId === capabilityId)
  }
  async getSnapshot(): Promise<{ active: CapabilityRecord[]; all: CapabilityRecord[] }> {
    return this.snapshot
  }
  async computeCrcsSnapshot(): Promise<FlexCrcsSnapshot> {
    const rows = this.snapshot.active.map((capability, index) => ({
      capabilityId: capability.capabilityId,
      displayName: capability.displayName,
      kind: 'execution' as const,
      inputFacets: capability.inputFacets ?? [],
      outputFacets: capability.outputFacets ?? [],
      reasonCodes: ['path'] as const,
      source: 'mrcs' as const
    }))
    const reasonCounts: Record<string, number> = {}
    rows.forEach((row) => {
      row.reasonCodes.forEach((reason) => {
        reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1
      })
    })
    return {
      rows,
      totalRows: rows.length,
      mrcsSize: rows.length,
      reasonCounts,
      rowCap: rows.length,
      truncated: false,
      pinnedCapabilityIds: [],
      mrcsCapabilityIds: rows.map((row) => row.capabilityId),
      missingPinnedCapabilityIds: []
    }
  }
  invalidate(): void {}
}

class StubPlannerService implements PlannerServiceInterface {
  constructor(private readonly nodes: { capabilityId: string; kind?: string }[]) {}
  async proposePlan(_: PlannerServiceInput) {
    return {
      nodes: this.nodes.map((node) => ({
        stage: 'strategy',
        capabilityId: node.capabilityId,
        kind: node.kind ?? 'structuring',
        inputFacets: ['company_information', 'post_context'],
        outputFacets: ['creative_brief', 'strategic_rationale', 'handoff_summary', 'feedback'],
        rationale: ['stub']
      })),
      metadata: { provider: 'stub', model: 'stub' }
    }
  }
}

describe('Marketing capabilities smoke test', () => {
  it('plans a strategist.SocialPosting run when provided required facets', async () => {
    const registry = new MarketingRegistryStub()
    const stubPlanner = new StubPlannerService([{ capabilityId: 'strategist.SocialPosting' }])
    const planner = new FlexPlanner({ capabilityRegistry: registry, plannerService: stubPlanner })

    const envelope: TaskEnvelope = {
      objective: 'Plan LinkedIn welcome content for new QA leader',
      inputs: {
        company_information: {
          name: 'Acme Analytics',
          website: 'https://acmeanalytics.io',
          industry: 'Industrial IoT',
          tone_of_voice: 'Authoritative but friendly',
          preferred_channels: 'LinkedIn, industry newsletters',
          brand_assets: ['https://assets.acmeanalytics.io/logos/wordmark.svg']
        },
        post_context: {
          type: 'new_employee',
          data: {
            content_description: 'Introduce Quinn Rivers as QA leader and emphasize quality leadership.',
            employee_name: 'Quinn Rivers',
            role: 'QA Leader',
            start_date: '2025-11-01',
            assets: ['https://assets.acmeanalytics.io/team/quinn-rivers.jpg']
          }
        },
        feedback: []
      },
      outputContract: {
        mode: 'facets',
        facets: ['creative_brief', 'strategic_rationale', 'handoff_summary', 'feedback']
      }
    }

    const plan = await planner.buildPlan('run-marketing-strategy', envelope)

    expect(plan.nodes).toHaveLength(1)
    const node = plan.nodes[0]
    expect(node.capabilityId).toBe('strategist.SocialPosting')
    expect(node.facets.input).toEqual(expect.arrayContaining(['company_information', 'post_context']))
    expect(node.facets.output).toEqual(
      expect.arrayContaining(['creative_brief', 'strategic_rationale', 'handoff_summary', 'feedback'])
    )
    const catalogIds = getMarketingCapabilityCatalog().map((entry) => entry.id)
    expect(catalogIds).toContain('strategist.SocialPosting')
  })
})
