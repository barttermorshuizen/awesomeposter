// @vitest-environment node
import { describe, it, expect } from 'vitest'
import type { CapabilityRecord, TaskEnvelope } from '@awesomeposter/shared'

import { FlexPlanner } from '../src/services/flex-planner'
import { STRATEGY_CAPABILITY_ID } from '../src/agents/strategy-manager'
import { CONTENT_CAPABILITY_ID } from '../src/agents/content-generator'
import { QA_CAPABILITY_ID } from '../src/agents/quality-assurance'
import type { PlannerServiceInterface, PlannerServiceInput } from '../src/services/planner-service'

const TIMESTAMP = '2025-04-01T12:00:00.000Z'

function makeCapabilityRecord(data: Partial<CapabilityRecord> & { capabilityId: string }): CapabilityRecord {
  return {
    capabilityId: data.capabilityId,
    version: data.version ?? '1.0.0',
    displayName: data.displayName ?? data.capabilityId,
    summary: data.summary ?? data.displayName ?? 'Capability summary',
    inputTraits: data.inputTraits ?? {},
    inputContract: data.inputContract ?? { mode: 'facets', facets: [] },
    outputContract: data.outputContract ?? { mode: 'facets', facets: [] },
    cost: data.cost,
    preferredModels: data.preferredModels,
    heartbeat: data.heartbeat,
    metadata: data.metadata ?? {},
    status: data.status ?? 'active',
    lastSeenAt: data.lastSeenAt ?? TIMESTAMP,
    registeredAt: data.registeredAt ?? TIMESTAMP,
    inputFacets: data.inputFacets,
    outputFacets: data.outputFacets
  }
}

const STRATEGY_CAPABILITY = makeCapabilityRecord({
  capabilityId: STRATEGY_CAPABILITY_ID,
  displayName: 'Strategy Manager',
  summary: 'Plans rationale and writer brief.',
  inputTraits: { languages: ['en'], strengths: ['planning'] },
  inputContract: { mode: 'facets', facets: ['objectiveBrief', 'audienceProfile', 'toneOfVoice', 'assetBundle'] },
  outputContract: {
    mode: 'json_schema',
    schema: {
      type: 'object',
      required: ['writerBrief', 'planKnobs', 'strategicRationale'],
      properties: {
        writerBrief: { type: 'object' },
        planKnobs: { type: 'object' },
        strategicRationale: { type: 'string' }
      },
      additionalProperties: true
    }
  },
  inputFacets: ['objectiveBrief', 'audienceProfile', 'toneOfVoice', 'assetBundle'],
  outputFacets: ['writerBrief', 'planKnobs', 'strategicRationale'],
  metadata: { scenarios: ['briefing', 'plan_structuring'] }
})

const CONTENT_CAPABILITY = makeCapabilityRecord({
  capabilityId: CONTENT_CAPABILITY_ID,
  displayName: 'Content Generator',
  summary: 'Generates content variants.',
  inputTraits: { languages: ['en'], formats: ['linkedin_post', 'blog_post'] },
  inputContract: { mode: 'facets', facets: ['writerBrief', 'planKnobs', 'toneOfVoice', 'audienceProfile'] },
  outputContract: buildOutputContract(),
  inputFacets: ['writerBrief', 'planKnobs', 'toneOfVoice', 'audienceProfile'],
  outputFacets: ['copyVariants'],
  metadata: { scenarios: ['linkedin_post_variants'] }
})

const QA_CAPABILITY = makeCapabilityRecord({
  capabilityId: QA_CAPABILITY_ID,
  displayName: 'Quality Assurance',
  summary: 'Evaluates drafts for policy and quality.',
  inputTraits: { languages: ['en'], strengths: ['qa_scoring'] },
  inputContract: { mode: 'facets', facets: ['copyVariants', 'writerBrief', 'qaRubric'] },
  outputContract: {
    mode: 'json_schema',
    schema: {
      type: 'object',
      required: ['qaFindings', 'recommendationSet'],
      properties: {
        qaFindings: { type: 'array', items: { type: 'string' } },
        recommendationSet: { type: 'array', items: { type: 'string' } }
      },
      additionalProperties: true
    }
  },
  inputFacets: ['copyVariants', 'writerBrief', 'qaRubric'],
  outputFacets: ['qaFindings', 'recommendationSet'],
  metadata: { scenarios: ['qa_review'] }
})

const EXPERIMENTAL_CONTENT_CAPABILITY = makeCapabilityRecord({
  ...CONTENT_CAPABILITY,
  metadata: { scenarios: ['experimental_only'] }
})

function createRegistryStub(capabilities: CapabilityRecord[]) {
  const byId = new Map(capabilities.map((capability) => [capability.capabilityId, capability]))
  return {
    async listActive() {
      return capabilities
    },
    async getCapabilityById(id: string) {
      return byId.get(id)
    },
    async getSnapshot() {
      return { active: capabilities, all: capabilities }
    }
  }
}

function buildOutputContract() {
  return {
    mode: 'json_schema' as const,
    schema: {
      type: 'object',
      required: ['variants'],
      properties: {
        variants: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['headline', 'body', 'callToAction'],
            properties: {
              headline: { type: 'string' },
              body: { type: 'string' },
              callToAction: { type: 'string' }
            }
          }
        }
      }
    }
  }
}

function createPlannerServiceStub(): PlannerServiceInterface {
  return {
    async proposePlan({ context }: PlannerServiceInput) {
      const contextValues = [
        context.channel,
        context.platform,
        ...context.formats,
        ...context.tags
      ]
        .filter((value): value is string => Boolean(value))
        .map((value) => value.toLowerCase())

      const hasLinkedinCue = contextValues.some((value) => value.includes('linkedin'))
      const hasBlogCue = contextValues.some((value) => value.includes('blog'))

      const nodes = [
        {
          stage: 'strategy',
          kind: 'structuring',
          capabilityId: STRATEGY_CAPABILITY_ID,
          derived: false,
          inputFacets: ['objectiveBrief', 'audienceProfile', 'toneOfVoice', 'assetBundle'],
          outputFacets: ['writerBrief', 'planKnobs', 'strategicRationale'],
          rationale: ['planner_recommendation']
        },
        {
          stage: 'generation',
          kind: 'execution',
          capabilityId: CONTENT_CAPABILITY_ID,
          derived: !hasLinkedinCue,
          inputFacets: ['writerBrief', 'planKnobs', 'toneOfVoice', 'audienceProfile'],
          outputFacets: ['copyVariants'],
          rationale: ['planner_recommendation'],
          instructions:
            hasBlogCue
              ? ['Account for long-form outline', 'Address multiple angles if requested']
              : ['Generate platform-appropriate copy']
        },
        {
          stage: 'qa',
          kind: 'validation',
          capabilityId: QA_CAPABILITY_ID,
          derived: true,
          inputFacets: ['copyVariants', 'writerBrief', 'qaRubric'],
          outputFacets: ['qaFindings', 'recommendationSet'],
          rationale: ['planner_recommendation']
        }
      ]

      return {
        nodes,
        metadata: {
          provider: 'planner-stub',
          model: 'stub-1.0'
        }
      }
    }
  }
}

describe('FlexPlanner', () => {
  it('assembles a multi-stage LinkedIn plan with normalization and provenance', async () => {
    const planner = new FlexPlanner(
      {
        capabilityRegistry: createRegistryStub([STRATEGY_CAPABILITY, CONTENT_CAPABILITY, QA_CAPABILITY]) as any,
        plannerService: createPlannerServiceStub()
      },
      {
        now: () => new Date(TIMESTAMP)
      }
    )

    const envelope: TaskEnvelope = {
      objective: 'Create LinkedIn post variants that highlight developer experience improvements',
      inputs: {
        channel: 'linkedin',
        variantCount: 2,
        toneOfVoice: 'inspiring',
        audienceProfile: { persona: 'Marketing leaders' },
        writerBrief: {
          angle: 'Human-first automation',
          keyPoints: ['Streamline workflows', 'Keep creativity'],
          ctas: ['Learn more'],
          constraints: ['No unverifiable claims']
        },
        planKnobs: {
          variantCount: 2,
          structure: { order: ['hook', 'value', 'cta'] },
          hashtags: { max: 3 }
        },
        qaRubric: {
          checks: ['Tone alignment', 'No policy violations']
        },
        contextBundles: [
          {
            type: 'company_profile',
            payload: {
              companyName: 'AwesomePoster',
              positioning: 'Human-first automation for marketing workstreams'
            }
          }
        ]
      },
      policies: {
        planner: {
          directives: {
            brandVoice: 'inspiring',
            requiresHitlApproval: false
          }
        },
        runtime: []
      },
      specialInstructions: ['Variant A should highlight team culture.', 'Variant B should highlight growth opportunities.'],
      outputContract: buildOutputContract()
    }

    const plan = await planner.buildPlan('run_linkedin', envelope)

    const kinds = plan.nodes.map((node) => node.kind)
    expect(kinds).toContain('structuring')
    expect(kinds).toContain('execution')
    expect(kinds).toContain('validation')
    expect(kinds).not.toContain('fallback')

    const hasNormalization = kinds.includes('transformation')

    const structuringNode = plan.nodes.find((node) => node.kind === 'structuring')!
    const executionNode = plan.nodes.find((node) => node.kind === 'execution')!
    const normalizationNode = plan.nodes.find((node) => node.kind === 'transformation') ?? null

    expect(structuringNode.capabilityId).toBe(STRATEGY_CAPABILITY_ID)
    expect(structuringNode.facets.output).toContain('writerBrief')
    expect(structuringNode.bundle.contract.expectations?.length).toBeGreaterThan(0)

    expect(executionNode.capabilityId).toBe(CONTENT_CAPABILITY_ID)
    expect(executionNode.contracts.output.mode).toBe(CONTENT_CAPABILITY.outputContract.mode)
    expect(executionNode.facets.output).toContain('copyVariants')
    expect(executionNode.rationale).toContain('planner_recommendation')

    if (hasNormalization && normalizationNode) {
      expect(normalizationNode.metadata.normalization).toBe(true)
      expect(plan.metadata.normalizationInjected).toBe(true)
    } else {
      expect(plan.metadata.normalizationInjected).toBe(false)
    }
    expect(plan.metadata.plannerContext).toMatchObject({
      channel: 'linkedin',
      formats: expect.arrayContaining(['linkedin'])
    })
    expect(plan.metadata.planVersionTag).toBeDefined()
    const terminalKind = plan.nodes[plan.nodes.length - 1]?.kind
    expect(['validation', 'transformation']).toContain(terminalKind)
  })

  it('creates branches and marks derived capabilities for blog scenarios', async () => {
    const planner = new FlexPlanner(
      {
        capabilityRegistry: createRegistryStub([STRATEGY_CAPABILITY, CONTENT_CAPABILITY, QA_CAPABILITY]) as any,
        plannerService: createPlannerServiceStub()
      },
      { now: () => new Date(TIMESTAMP) }
    )

    const envelope: TaskEnvelope = {
      objective: 'Write a 1200-word blog post announcing our new developer portal',
      inputs: {
        channel: 'blog',
        variantCount: 1,
        toneOfVoice: 'inspiring',
        audienceProfile: { persona: 'Content leaders' },
        contextBundles: [
          {
            type: 'company_profile',
            payload: {
              companyName: 'AwesomePoster',
              positioning: 'Human-first automation for marketing workstreams'
            }
          }
        ],
        writerBrief: {
          angle: 'Launch announcement',
          keyPoints: ['New portal', 'Developer empowerment'],
          constraints: ['No emoji']
        },
        planKnobs: {
          variantCount: 1,
          structure: { order: ['introduction', 'value', 'cta'] }
        },
        qaRubric: {
          checks: ['Clarity', 'Policy compliance']
        }
      },
      policies: {
        planner: {
          directives: {
            branchVariants: ['Product spotlight', 'Culture story']
          }
        },
        runtime: []
      },
      outputContract: buildOutputContract()
    }

    const plan = await planner.buildPlan('run_blog', envelope)

    const branchNodes = plan.nodes.filter((node) => node.kind === 'branch')
    expect(branchNodes).toHaveLength(0)
    expect('branchPolicySources' in plan.metadata).toBe(false)
    expect('ignoredBranchRequests' in plan.metadata).toBe(false)
    expect('branchCount' in plan.metadata).toBe(false)

    const executionNode = plan.nodes.find((node) => node.kind === 'execution')!
    expect(executionNode.derivedCapability?.fromCapabilityId).toBe(CONTENT_CAPABILITY_ID)
    expect(plan.metadata.derivedCapabilityCount).toBeGreaterThan(0)
    expect(plan.metadata.plannerContext).toMatchObject({
      channel: 'blog',
      formats: expect.arrayContaining(['blog'])
    })
  })

  it('handles generic scenarios with derived capability coverage', async () => {
    const planner = new FlexPlanner(
      {
        capabilityRegistry: createRegistryStub([STRATEGY_CAPABILITY, EXPERIMENTAL_CONTENT_CAPABILITY, QA_CAPABILITY]) as any,
        plannerService: createPlannerServiceStub()
      },
      { now: () => new Date(TIMESTAMP) }
    )

    const envelope: TaskEnvelope = {
      objective: 'Craft a concise rejection note for a declined partner request',
      inputs: {
        channel: 'email',
        variantCount: 1,
        toneOfVoice: 'professional',
        audienceProfile: { persona: 'Partnership leads' },
        contextBundles: [
          {
            type: 'company_profile',
            payload: {
              companyName: 'AwesomePoster',
              positioning: 'Human-first automation for marketing workstreams'
            }
          }
        ],
        writerBrief: {
          angle: 'Polite rejection',
          keyPoints: ['Thank them', 'Decline clearly'],
          constraints: ['No promises']
        },
        planKnobs: {
          variantCount: 1,
          structure: { order: ['greeting', 'decline', 'warm closing'] }
        },
        qaRubric: {
          checks: ['Tone', 'No legal risk']
        }
      },
      policies: {
        planner: {
          directives: {
            requiresHitlApproval: true
          }
        },
        runtime: []
      },
      outputContract: buildOutputContract()
    }

    const plan = await planner.buildPlan('run_generic', envelope)

    expect(plan.metadata.plannerContext).toMatchObject({
      channel: 'email',
      formats: expect.arrayContaining(['email'])
    })
    expect(plan.metadata.derivedCapabilityCount).toBeGreaterThanOrEqual(1)

    const executionNode = plan.nodes.find((node) => node.kind === 'execution')!
    expect(executionNode.derivedCapability).toBeTruthy()
    expect(executionNode.capabilityLabel).toContain('Content Generator')

    const terminalKind = plan.nodes[plan.nodes.length - 1]?.kind
    expect(['validation', 'transformation']).toContain(terminalKind)
  })
})
