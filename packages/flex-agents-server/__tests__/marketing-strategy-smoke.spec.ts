// @vitest-environment node
import { describe, it, expect } from 'vitest'
import type { CapabilityRecord, TaskEnvelope } from '@awesomeposter/shared'
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
        inputFacets: ['post_context', 'feedback'],
        outputFacets: ['creative_brief', 'strategic_rationale', 'handoff_summary'],
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
      objective: 'Plan LinkedIn launch content',
      inputs: {
        post_context: {
          campaign: 'Launch Campaign',
          type: 'launch',
          summary: 'Announce the new product launch to enterprise buyers with strong CTA.',
          audience: {
            persona: 'Enterprise buyer',
            industry: 'SaaS'
          },
          channels: ['linkedin']
        },
        feedback: []
      },
      outputContract: {
        mode: 'facets',
        facets: ['creative_brief', 'strategic_rationale', 'handoff_summary']
      }
    }

    const plan = await planner.buildPlan('run-marketing-strategy', envelope)

    expect(plan.nodes).toHaveLength(1)
    const node = plan.nodes[0]
    expect(node.capabilityId).toBe('strategist.SocialPosting')
    expect(node.facets.input).toEqual(expect.arrayContaining(['post_context', 'feedback']))
    expect(node.facets.output).toEqual(
      expect.arrayContaining(['creative_brief', 'strategic_rationale', 'handoff_summary'])
    )
    const catalogIds = getMarketingCapabilityCatalog().map((entry) => entry.id)
    expect(catalogIds).toContain('strategist.SocialPosting')
  })
})
