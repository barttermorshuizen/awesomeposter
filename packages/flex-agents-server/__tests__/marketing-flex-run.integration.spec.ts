// @vitest-environment node
import { describe, it, expect } from 'vitest'
import type { TaskEnvelope, FlexPlan, FlexEvent } from '@awesomeposter/shared'
import { FlexRunCoordinator } from '../src/services/flex-run-coordinator'

class StubPersistence {
  async createOrUpdateRun() {}
  async updateStatus() {}
  async savePlanSnapshot() {}
  async markNode() {}
  async recordResult() {}
  async ensure() {}
  async recordPendingResult() {}
  async saveRunContext() {}
  async loadFlexRun() {
    return null
  }
  async findFlexRunByThreadId() {
    return null
  }
}

class MarketingPlannerStub {
  constructor(private readonly plan: FlexPlan) {}
  async buildPlan() {
    return this.plan
  }
}

const facetProvenance = (node: FlexPlan['nodes'][number]) =>
  (node.facets?.output ?? []).map((facet) => ({
    facet,
    title: facet,
    direction: 'output' as const,
    pointer: `#/${facet}`
  }))

class MarketingExecutionEngineStub {
  constructor(private readonly nodeOutputs: Record<string, Record<string, unknown>>) {}

  async execute(_runId: string, envelope: TaskEnvelope, plan: FlexPlan, opts: any) {
    const nowIso = () => new Date().toISOString()
    for (const node of plan.nodes) {
      await opts.onEvent({
        type: 'node_start',
        timestamp: nowIso(),
        nodeId: node.id,
        payload: {
          capabilityId: node.capabilityId,
          label: node.label
        }
      })
      const output = this.nodeOutputs[node.id] ?? {}
      if (opts.runContext) {
        opts.runContext.updateFromNode(node, output)
      }
      await opts.onEvent({
        type: 'node_complete',
        timestamp: nowIso(),
        nodeId: node.id,
        payload: {
          capabilityId: node.capabilityId,
          label: node.label,
          output
        },
        facetProvenance: {
          output: facetProvenance(node)
        }
      })
    }
    const finalOutput =
      opts.runContext?.composeFinalOutput(envelope.outputContract, plan) ??
      Object.values(this.nodeOutputs).reduce<Record<string, unknown>>(
        (acc, chunk) => Object.assign(acc, chunk),
        {}
      )
    await opts.onEvent({
      type: 'complete',
      timestamp: nowIso(),
      payload: {
        status: 'completed',
        output: finalOutput
      }
    })
    return finalOutput
  }
}

class HitlServiceStub {
  getMaxRequestsPerRun() {
    return 3
  }
  async loadRunState() {
    return {
      requests: [],
      responses: [],
      pendingRequestId: null,
      deniedCount: 0
    }
  }
  async raiseRequest() {
    throw new Error('HITL not expected in marketing stub')
  }
  async applyResponses(_runId: string) {
    return {
      requests: [],
      responses: [],
      pendingRequestId: null,
      deniedCount: 0
    }
  }
}

describe('FlexRunCoordinator marketing integration (stubbed)', () => {
  it('streams marketing capability events and composes final facets', async () => {
    const envelope: TaskEnvelope = {
      objective: 'Plan and approve a LinkedIn launch announcement.',
      inputs: {
        post_context: {
          campaign: 'Launch Campaign',
          type: 'launch',
          summary: 'Announce the AwesomePoster launch to enterprise buyers.',
          audience: {
            persona: 'Enterprise buyer',
            industry: 'SaaS'
          },
          channels: ['linkedin']
        },
        feedback: []
      },
      metadata: {
        correlationId: 'cid-test'
      },
      policies: {
        runtime: []
      },
      outputContract: {
        mode: 'facets',
        facets: [
          'creative_brief',
          'strategic_rationale',
          'handoff_summary',
          'post_copy',
          'post',
          'feedback'
        ]
      }
    }

    const runId = 'run-marketing'
    const objective = envelope.objective
    const plan: FlexPlan = {
      runId,
      version: 1,
      createdAt: new Date().toISOString(),
      nodes: [
        {
          id: 'node-strategist',
          kind: 'execution',
          capabilityId: 'strategist.SocialPosting',
          capabilityLabel: 'Strategist – Social Posting',
          capabilityVersion: '1.0.0',
          derivedCapability: undefined,
          label: 'Strategist – Social Posting',
          bundle: {
            runId,
            nodeId: 'node-strategist',
            objective,
            instructions: [],
            contract: {
              input: { mode: 'facets', facets: ['post_context', 'feedback'] },
              output: { mode: 'facets', facets: ['creative_brief', 'strategic_rationale', 'handoff_summary'] }
            }
          },
          contracts: {
            input: { mode: 'facets', facets: ['post_context', 'feedback'] },
            output: { mode: 'facets', facets: ['creative_brief', 'strategic_rationale', 'handoff_summary'] }
          },
          facets: {
            input: ['post_context', 'feedback'],
            output: ['creative_brief', 'strategic_rationale', 'handoff_summary']
          },
          provenance: { input: [], output: [] },
          rationale: ['Produce marketing strategy deliverables'],
          metadata: { plannerStage: 'strategy' }
        },
        {
          id: 'node-copywriter',
          kind: 'execution',
          capabilityId: 'copywriter.SocialpostDrafting',
          capabilityLabel: 'Copywriter – Social Drafting',
          capabilityVersion: '1.0.0',
          derivedCapability: undefined,
          label: 'Copywriter – Social Drafting',
          bundle: {
            runId,
            nodeId: 'node-copywriter',
            objective,
            instructions: [],
            contract: {
              input: { mode: 'facets', facets: ['creative_brief', 'handoff_summary', 'feedback'] },
              output: { mode: 'facets', facets: ['post_copy', 'handoff_summary'] }
            }
          },
          contracts: {
            input: { mode: 'facets', facets: ['creative_brief', 'handoff_summary', 'feedback'] },
            output: { mode: 'facets', facets: ['post_copy', 'handoff_summary'] }
          },
          facets: {
            input: ['creative_brief', 'handoff_summary', 'feedback'],
            output: ['post_copy', 'handoff_summary']
          },
          provenance: { input: [], output: [] },
          rationale: ['Draft launch-ready copy variants'],
          metadata: { plannerStage: 'copywriting' }
        },
        {
          id: 'node-director',
          kind: 'execution',
          capabilityId: 'director.SocialPostingReview',
          capabilityLabel: 'Director – Social Review',
          capabilityVersion: '1.0.0',
          derivedCapability: undefined,
          label: 'Director – Social Review',
          bundle: {
            runId,
            nodeId: 'node-director',
            objective,
            instructions: [],
            contract: {
              input: { mode: 'facets', facets: ['post_context', 'strategic_rationale', 'post_copy'] },
              output: { mode: 'facets', facets: ['post', 'feedback'] }
            }
          },
          contracts: {
            input: { mode: 'facets', facets: ['post_context', 'strategic_rationale', 'post_copy'] },
            output: { mode: 'facets', facets: ['post', 'feedback'] }
          },
          facets: {
            input: ['post_context', 'strategic_rationale', 'post_copy'],
            output: ['post', 'feedback']
          },
          provenance: { input: [], output: [] },
          rationale: ['Ensure quality and approve final creative'],
          metadata: { plannerStage: 'review' }
        }
      ],
      edges: [
        { from: 'node-strategist', to: 'node-copywriter' },
        { from: 'node-copywriter', to: 'node-director' }
      ],
      metadata: {
        variantCount: 1,
        plannerContext: {
          channel: 'linkedin',
          platform: null,
          formats: ['short_form'],
          languages: ['en'],
          audiences: ['enterprise_buyers'],
          tags: ['marketing'],
          specialInstructions: []
        },
        plannerAttempts: 1
      }
    }

    const nodeOutputs: Record<string, Record<string, unknown>> = {
      'node-strategist': {
        creative_brief: {
          core_message: 'Highlight automation ROI',
          tone: 'Confident & Bold',
          audience: 'Enterprise buyer'
        },
        strategic_rationale: 'Aligns messaging to ROI and launch urgency.',
        handoff_summary: ['Strategy approved']
      },
      'node-copywriter': {
        post_copy: ['Introducing AwesomePoster — automate your marketing ops.'],
        handoff_summary: ['Copy ready for director review']
      },
      'node-director': {
        post: {
          platform: 'linkedin',
          content: 'We just launched AwesomePoster — automate marketing ops and ship faster. Learn more: awesomeposter.ai'
        },
        feedback: []
      }
    }

    const events: FlexEvent[] = []
    const coordinator = new FlexRunCoordinator(
      new StubPersistence() as any,
      new MarketingPlannerStub(plan) as any,
      new MarketingExecutionEngineStub(nodeOutputs) as any,
      new HitlServiceStub() as any
    )

    const result = await coordinator.run(envelope, {
      correlationId: 'cid-test',
      onEvent: async (event) => {
        events.push(event)
      }
    })

    expect(result.status).toBe('completed')
    expect(result.output).toMatchObject({
      creative_brief: expect.objectContaining({
        core_message: 'Highlight automation ROI'
      }),
      strategic_rationale: expect.stringContaining('launch'),
      post_copy: expect.arrayContaining([expect.stringContaining('AwesomePoster')]),
      post: expect.objectContaining({
        platform: 'linkedin'
      })
    })

    const planGenerated = events.find((evt) => evt.type === 'plan_generated')
    expect(planGenerated?.payload && (planGenerated.payload as any).plan?.nodes?.length).toBe(3)

    const nodeCompleteCount = events.filter((evt) => evt.type === 'node_complete').length
    expect(nodeCompleteCount).toBe(3)

    const completeEvent = events.find((evt) => evt.type === 'complete')
    expect((completeEvent?.payload as any)?.status).toBe('completed')
  })
})
