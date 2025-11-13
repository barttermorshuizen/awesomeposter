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
      objective: 'Plan and approve a LinkedIn welcome post for our new QA lead.',
      inputs: {
        company_information: {
          name: 'AwesomePoster',
          website: 'https://awesomeposter.ai',
          industry: 'Marketing Software',
          tone_of_voice: 'Confident and friendly',
          preferred_channels: 'LinkedIn, email newsletters',
          brand_assets: ['https://cdn.awesomeposter.ai/brand/logo.svg']
        },
        post_context: {
          type: 'new_employee',
          data: {
            content_description: 'Welcome Quinn as our new QA lead and highlight the impact on customer trust.',
            employee_name: 'Quinn Rivers',
            role: 'QA Lead',
            start_date: '2025-11-01',
            assets: ['https://cdn.awesomeposter.ai/team/quinn-rivers.png']
          }
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
              input: { mode: 'facets', facets: ['company_information', 'post_context'] },
              output: {
                mode: 'facets',
                facets: ['creative_brief', 'strategic_rationale', 'handoff_summary', 'feedback']
              }
            }
          },
          contracts: {
            input: { mode: 'facets', facets: ['company_information', 'post_context'] },
            output: {
              mode: 'facets',
              facets: ['creative_brief', 'strategic_rationale', 'handoff_summary', 'feedback']
            }
          },
          facets: {
            input: ['company_information', 'post_context'],
            output: ['creative_brief', 'strategic_rationale', 'handoff_summary', 'feedback']
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
              input: { mode: 'facets', facets: ['company_information', 'creative_brief', 'handoff_summary'] },
              output: { mode: 'facets', facets: ['post_copy', 'handoff_summary', 'feedback'] }
            }
          },
          contracts: {
            input: {
              mode: 'facets',
              facets: ['company_information', 'creative_brief', 'handoff_summary']
            },
            output: { mode: 'facets', facets: ['post_copy', 'handoff_summary', 'feedback'] }
          },
          facets: {
            input: ['company_information', 'creative_brief', 'handoff_summary'],
            output: ['post_copy', 'handoff_summary', 'feedback']
          },
          provenance: { input: [], output: [] },
          rationale: ['Draft welcome-post copy variants'],
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
              input: {
                mode: 'facets',
                facets: ['company_information', 'post_context', 'strategic_rationale', 'post_copy']
              },
              output: { mode: 'facets', facets: ['post', 'feedback'] }
            }
          },
          contracts: {
            input: {
              mode: 'facets',
              facets: ['company_information', 'post_context', 'strategic_rationale', 'post_copy']
            },
            output: { mode: 'facets', facets: ['post', 'feedback'] }
          },
          facets: {
            input: ['company_information', 'post_context', 'strategic_rationale', 'post_copy'],
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
          core_message: 'Celebrate Quinn joining as QA lead and stress our commitment to quality.',
          tone: 'Welcoming & Visionary',
          audience: 'Operations leaders'
        },
        strategic_rationale: 'Introduces Quinn to reinforce QA excellence and employer brand credibility.',
        handoff_summary: ['Strategy approved'],
        feedback: [
          {
            id: 'fb-strategy-1',
            facet: 'creative_brief',
            path: '/core_message',
            message: 'Confirmed QA leadership angle.',
            resolution: 'addressed',
            note: 'Brief now highlights Quinn’s remit.',
            author: 'strategist.SocialPosting'
          }
        ]
      },
      'node-copywriter': {
        post_copy: ['Say hello to Quinn Rivers, our new QA Lead keeping every release rock solid.'],
        handoff_summary: ['Copy ready for director review'],
        feedback: [
          {
            id: 'fb-copy-cta',
            facet: 'post_copy',
            path: '/0',
            message: 'CTA tightened per director request.',
            resolution: 'addressed',
            note: 'Swapped “drop a welcome” CTA for “say hello”.',
            author: 'copywriter.SocialpostDrafting'
          }
        ]
      },
      'node-director': {
        post: {
          platform: 'linkedin',
          content: 'Join us in welcoming Quinn Rivers, AwesomePoster’s new QA Lead ensuring flawless launches. Drop a welcome note!'
        },
        feedback: [
          {
            id: 'fb-copy-cta',
            facet: 'post_copy',
            path: '/0',
            message: 'CTA tightened per director request.',
            resolution: 'addressed',
            note: 'Swapped “drop a welcome” CTA for “say hello”.',
            author: 'copywriter.SocialpostDrafting'
          }
        ]
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
        core_message: 'Celebrate Quinn joining as QA lead and stress our commitment to quality.'
      }),
      strategic_rationale: expect.stringContaining('Quinn'),
      post_copy: expect.arrayContaining([expect.stringContaining('Quinn Rivers')]),
      post: expect.objectContaining({
        platform: 'linkedin'
      }),
      feedback: expect.arrayContaining([
        expect.objectContaining({
          facet: 'post_copy',
          resolution: 'addressed',
          note: expect.stringContaining('CTA')
        })
      ])
    })

    const planGenerated = events.find((evt) => evt.type === 'plan_generated')
    expect(planGenerated?.payload && (planGenerated.payload as any).plan?.nodes?.length).toBe(3)

    const nodeCompleteCount = events.filter((evt) => evt.type === 'node_complete').length
    expect(nodeCompleteCount).toBe(3)

    const completeEvent = events.find((evt) => evt.type === 'complete')
    expect((completeEvent?.payload as any)?.status).toBe('completed')
  })
})
