import type { CapabilityRecord, CapabilityRegistration } from './types.js'

export const MARKETING_CATALOG_TAG = 'marketing-agency'
export const MARKETING_COLLECTION = 'flex.marketing'
export const MARKETING_CATALOG_TAGS = [MARKETING_CATALOG_TAG, 'sandbox'] as const

type CapabilityPrompt = {
  instructions: string
  toolsAllowlist?: string[]
}

type MarketingCapabilityEntry = {
  record: CapabilityRecord
  prompt?: CapabilityPrompt
}

const BASE_TIMESTAMP = '2025-01-01T00:00:00.000Z'

const marketingCapabilities: MarketingCapabilityEntry[] = [
  {
    record: {
      capabilityId: 'strategist.SocialPosting',
      version: '1.0.0',
      displayName: 'Strategist – Social Posting',
      summary: 'Plans social campaign briefs, rationale, and handoff notes so downstream roles stay aligned.',
      agentType: 'ai',
      inputTraits: {
        languages: ['en'],
        strengths: ['campaign_planning', 'audience_strategy'],
        limitations: ['Requires structured campaign context and relies on run-context feedback for iteration.']
      },
      inputContract: {
        mode: 'facets',
        facets: ['company_information', 'post_context']
      },
      outputContract: {
        mode: 'facets',
        facets: ['creative_brief', 'strategic_rationale', 'handoff_summary']
      },
      cost: {
        tier: 'standard',
        estimatedTokens: 1800,
        pricePer1kTokens: 0.015,
        currency: 'USD'
      },
      preferredModels: ['gpt-4o-mini'],
      heartbeat: {
        intervalSeconds: 900,
        timeoutSeconds: 2400
      },
      metadata: {
        catalogTags: [...MARKETING_CATALOG_TAGS],
        collection: MARKETING_COLLECTION,
        marketingStage: 'strategy',
        sourceFiles: [
          'docs/architecture/flex-agents-server/511-reference-capability-registry.md#strategistsocialposting'
        ]
      },
      status: 'active',
      lastSeenAt: BASE_TIMESTAMP,
      registeredAt: BASE_TIMESTAMP,
      inputFacets: ['company_information', 'post_context'],
      outputFacets: ['creative_brief', 'strategic_rationale', 'handoff_summary']
    },
    prompt: {
      instructions: [
        'Synthesize the campaign context into a creative brief, rationale, and handoff summary.',
        'Address the feedback in the run context with facet = ["creative_brief", "strategic_rationale", "handoff_summary"] before finalising your update.',
        'If required context is missing or conflicting, pause and escalate with the `hitl_request` tool. Use `kind: "approval"` for binary decisions and `kind: "clarify"` for open questions—expect freeform operator input rather than multiple-choice options.',
        'While waiting on a HITL response, insert descriptive placeholders in the output facets so the run can resume safely.'
      ].join(' '),
      toolsAllowlist: ['hitl_request']
    }
  },
  {
    record: {
      capabilityId: 'strategist.Positioning',
      version: '1.0.0',
      displayName: 'Strategist – Positioning',
      summary: 'Translates market and competitive inputs into positioning canvases and opportunity maps.',
      agentType: 'ai',
      inputTraits: {
        languages: ['en'],
        strengths: ['competitive_analysis', 'market_synthesis'],
        limitations: ['Needs positioning context data and uses run-context feedback history.']
      },
      inputContract: {
        mode: 'facets',
        facets: ['company_information', 'positioning_context']
      },
      outputContract: {
        mode: 'facets',
        facets: ['value_canvas', 'positioning_opportunities', 'positioning_recommendation', 'handoff_summary']
      },
      cost: {
        tier: 'standard',
        estimatedTokens: 2000,
        pricePer1kTokens: 0.018,
        currency: 'USD'
      },
      preferredModels: ['gpt-4o-mini'],
      heartbeat: {
        intervalSeconds: 1200,
        timeoutSeconds: 3000
      },
      metadata: {
        catalogTags: [...MARKETING_CATALOG_TAGS],
        collection: MARKETING_COLLECTION,
        marketingStage: 'positioning',
        sourceFiles: [
          'docs/architecture/flex-agents-server/511-reference-capability-registry.md#strategistpositioning'
        ]
      },
      status: 'active',
      lastSeenAt: BASE_TIMESTAMP,
      registeredAt: BASE_TIMESTAMP,
      inputFacets: ['company_information', 'positioning_context'],
      outputFacets: ['value_canvas', 'positioning_opportunities', 'positioning_recommendation', 'handoff_summary']
    },
    prompt: {
      instructions: [
        'Assess market inputs to produce the value canvas, positioning opportunities, and recommendation; document reasoning in the handoff summary.',
        'Address the feedback in the run context with facet = ["value_canvas", "positioning_opportunities", "positioning_recommendation", "handoff_summary"] before finalising your update.',
        'Escalate with `hitl_request` whenever competitive intelligence or approvals are missing. Frame the question succinctly, set `kind: "approval"` for yes/no decisions, and otherwise use `kind: "clarify"` and await a freeform answer.',
        'While waiting on humans, keep the recommendation facet populated with placeholders that describe the outstanding decision.'
      ].join(' '),
      toolsAllowlist: ['hitl_request']
    }
  },
  {
    record: {
      capabilityId: 'copywriter.SocialpostDrafting',
      version: '1.0.0',
      displayName: 'Copywriter – Social Drafting',
      summary: 'Produces social post copy variants that follow strategist direction and reviewer feedback.',
      agentType: 'ai',
      inputTraits: {
        languages: ['en'],
        formats: ['linkedin_post', 'x_thread'],
        strengths: ['tone_adaptation', 'short_form_copy'],
        limitations: ['Needs creative brief and tone guidance.']
      },
      inputContract: {
        mode: 'facets',
        facets: ['company_information', 'creative_brief', 'handoff_summary']
      },
      outputContract: {
        mode: 'facets',
        facets: ['post_copy', 'handoff_summary']
      },
      cost: {
        tier: 'standard',
        estimatedTokens: 1400,
        pricePer1kTokens: 0.012,
        currency: 'USD'
      },
      preferredModels: ['gpt-4o-mini'],
      heartbeat: {
        intervalSeconds: 900,
        timeoutSeconds: 2400
      },
      metadata: {
        catalogTags: [...MARKETING_CATALOG_TAGS],
        collection: MARKETING_COLLECTION,
        marketingStage: 'copywriting',
        sourceFiles: [
          'docs/architecture/flex-agents-server/511-reference-capability-registry.md#copywritersocialpostdrafting'
        ]
      },
      status: 'active',
      lastSeenAt: BASE_TIMESTAMP,
      registeredAt: BASE_TIMESTAMP,
      inputFacets: ['company_information', 'creative_brief', 'handoff_summary'],
      outputFacets: ['post_copy', 'handoff_summary']
    },
    prompt: {
      instructions: [
        'Draft compliant social copy variants from the creative brief and update the handoff summary with decisions made.',
        'Address the feedback in the run context with facet = ["post_copy", "handoff_summary"] before finalising your update.',
        'If policy, brand, or tone conflicts emerge, raise a `hitl_request` instead of guessing. Describe the human decision, use `kind: "approval"` for binary outcomes or `kind: "clarify"` for follow-up questions, and pause output while awaiting the response.'
      ].join(' '),
      toolsAllowlist: ['hitl_request']
    }
  },
  {
    record: {
      capabilityId: 'copywriter.Messaging',
      version: '1.0.0',
      displayName: 'Copywriter – Messaging Stack',
      summary: 'Converts positioning recommendations into message pillars and supporting copy guidance.',
      agentType: 'ai',
      inputTraits: {
        languages: ['en'],
        strengths: ['messaging_frameworks', 'tone_alignment'],
        limitations: ['Depends on fresh positioning recommendation context and prior run-context feedback.']
      },
      inputContract: {
        mode: 'facets',
        facets: ['company_information', 'positioning_context', 'positioning_recommendation']
      },
      outputContract: {
        mode: 'facets',
        facets: ['messaging_stack', 'handoff_summary']
      },
      cost: {
        tier: 'standard',
        estimatedTokens: 1600,
        pricePer1kTokens: 0.013,
        currency: 'USD'
      },
      preferredModels: ['gpt-4o-mini'],
      heartbeat: {
        intervalSeconds: 900,
        timeoutSeconds: 2400
      },
      metadata: {
        catalogTags: [...MARKETING_CATALOG_TAGS],
        collection: MARKETING_COLLECTION,
        marketingStage: 'messaging',
        sourceFiles: [
          'docs/architecture/flex-agents-server/511-reference-capability-registry.md#copywritermessaging'
        ]
      },
      status: 'active',
      lastSeenAt: BASE_TIMESTAMP,
      registeredAt: BASE_TIMESTAMP,
      inputFacets: ['company_information', 'positioning_context', 'positioning_recommendation'],
      outputFacets: ['messaging_stack', 'handoff_summary']
    },
    prompt: {
      instructions: [
        'Transform the positioning recommendation into a messaging stack with proof points and keep the handoff summary current.',
        'Address the feedback in the run context with facet = ["messaging_stack", "handoff_summary"] before finalising your update.',
        'When stakeholder approval or clarity is missing, call `hitl_request` with a concise question. Provide option lists only when multiple vetted phrasings are available; otherwise rely on the operator response and pause outputs using placeholders.'
      ].join(' '),
      toolsAllowlist: ['hitl_request']
    }
  },
  {
    record: {
      capabilityId: 'designer.VisualDesign',
      version: '1.0.0',
      displayName: 'Designer – Visual Design',
      summary: 'Creates or sources campaign visuals aligned with the strategist brief and ongoing revisions.',
      agentType: 'human',
      inputTraits: undefined,
      inputContract: {
        mode: 'facets',
        facets: ['company_information', 'creative_brief', 'handoff_summary', 'feedback']
      },
      outputContract: {
        mode: 'facets',
        facets: ['post_visual', 'handoff_summary']
      },
      cost: undefined,
      preferredModels: undefined,
      heartbeat: {
        intervalSeconds: 21600,
        timeoutSeconds: 43200
      },
      instructionTemplates: {
        app: 'Review the creative brief and produce campaign-ready visual assets. Update the handoff summary with key decisions.'
      },
      assignmentDefaults: {
        role: 'Visual Designer',
        maxNotifications: 3,
        timeoutSeconds: 43200,
        onDecline: 'requeue'
      },
      metadata: {
        catalogTags: [...MARKETING_CATALOG_TAGS],
        collection: MARKETING_COLLECTION,
        marketingStage: 'visual_design',
        runMode: 'human_assignment'
      },
      status: 'active',
      lastSeenAt: BASE_TIMESTAMP,
      registeredAt: BASE_TIMESTAMP,
      inputFacets: ['company_information', 'creative_brief', 'handoff_summary', 'feedback'],
      outputFacets: ['post_visual', 'handoff_summary']
    }
  },
  {
    record: {
      capabilityId: 'director.SocialPostingReview',
      version: '1.0.0',
      displayName: 'Director – Social Review',
      summary: 'Reviews campaign assets, approves final posts, or routes feedback for targeted revisions.',
      agentType: 'human',
      inputTraits: undefined,
      inputContract: {
        mode: 'facets',
        facets: ['company_information', 'post_context', 'strategic_rationale', 'post_copy', 'post_visual']
      },
      outputContract: {
        mode: 'facets',
        facets: ['post', 'feedback']
      },
      cost: undefined,
      preferredModels: undefined,
      heartbeat: {
        intervalSeconds: 21600,
        timeoutSeconds: 43200
      },
      instructionTemplates: {
        app: 'Evaluate the assembled social post. Approve when it meets objectives or add feedback items linked to specific facets.'
      },
      assignmentDefaults: {
        role: 'Marketing Director',
        maxNotifications: 2,
        timeoutSeconds: 43200,
        onDecline: 'fail_run'
      },
      metadata: {
        catalogTags: [...MARKETING_CATALOG_TAGS],
        collection: MARKETING_COLLECTION,
        marketingStage: 'review',
        runMode: 'human_assignment'
      },
      status: 'active',
      lastSeenAt: BASE_TIMESTAMP,
      registeredAt: BASE_TIMESTAMP,
      inputFacets: ['company_information', 'post_context', 'strategic_rationale', 'post_copy', 'post_visual'],
      outputFacets: ['post', 'feedback']
    }
  },
  {
    record: {
      capabilityId: 'director.PositioningReview',
      version: '1.0.0',
      displayName: 'Director – Positioning Review',
      summary: 'Approves positioning recommendations and messaging stacks or returns targeted feedback for revisions.',
      agentType: 'human',
      inputTraits: undefined,
      inputContract: {
        mode: 'facets',
        facets: [
          'company_information',
          'positioning_context',
          'value_canvas',
          'positioning_opportunities',
          'positioning_recommendation',
          'messaging_stack'
        ]
      },
      outputContract: {
        mode: 'facets',
        facets: ['positioning', 'feedback']
      },
      cost: undefined,
      preferredModels: undefined,
      heartbeat: {
        intervalSeconds: 21600,
        timeoutSeconds: 43200
      },
      instructionTemplates: {
        app: 'Review the positioning package. Approve the final positioning summary or add facet-specific feedback so strategists can iterate.'
      },
      assignmentDefaults: {
        role: 'Brand Director',
        maxNotifications: 2,
        timeoutSeconds: 43200,
        onDecline: 'fail_run'
      },
      metadata: {
        catalogTags: [...MARKETING_CATALOG_TAGS],
        collection: MARKETING_COLLECTION,
        marketingStage: 'positioning_review',
        runMode: 'human_assignment'
      },
      status: 'active',
      lastSeenAt: BASE_TIMESTAMP,
      registeredAt: BASE_TIMESTAMP,
      inputFacets: [
        'company_information',
        'positioning_context',
        'value_canvas',
        'positioning_opportunities',
        'positioning_recommendation',
        'messaging_stack'
      ],
      outputFacets: ['positioning', 'feedback']
    }
  }
]

export function getMarketingCapabilitiesSnapshot(): { active: CapabilityRecord[]; all: CapabilityRecord[] } {
  const records = marketingCapabilities.map(({ record }) => ({ ...record }))
  return { active: records, all: records }
}

export function getMarketingCapabilityCatalog(): Array<{
  id: string
  name: string
  description: string
  prompt?: CapabilityPrompt
}> {
  return marketingCapabilities.map(({ record, prompt }) => ({
    id: record.capabilityId,
    name: record.displayName,
    description: record.summary,
    ...(prompt ? { prompt } : {})
  }))
}

export function getMarketingCapabilityIds(): string[] {
  return marketingCapabilities.map(({ record }) => record.capabilityId)
}

export function getMarketingCapabilityRegistrations(): CapabilityRegistration[] {
  return marketingCapabilities.map(({ record }) => {
    const { status: _status, lastSeenAt: _lastSeenAt, registeredAt: _registeredAt, inputFacets: _inputFacets, outputFacets: _outputFacets, ...registration } = record
    return registration
  })
}
