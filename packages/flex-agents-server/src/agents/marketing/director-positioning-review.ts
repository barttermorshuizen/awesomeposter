import { getFacetCatalog, type CapabilityRegistration } from '@awesomeposter/shared'

export const DIRECTOR_POSITIONING_REVIEW_ID = 'director.PositioningReview' as const

const catalog = getFacetCatalog()
const INPUT_FACETS = [
  'company_information',
  'positioning_context',
  'value_canvas',
  'positioning_opportunities',
  'positioning_recommendation',
  'messaging_stack'
] as const
const OUTPUT_FACETS = ['positioning', 'feedback'] as const

catalog.resolveMany([...INPUT_FACETS], 'input')
catalog.resolveMany([...OUTPUT_FACETS], 'output')

export const DIRECTOR_POSITIONING_REVIEW_CAPABILITY: CapabilityRegistration = {
  capabilityId: DIRECTOR_POSITIONING_REVIEW_ID,
  agentType: 'human',
  version: '1.0.0',
  displayName: 'Director – Positioning Review',
  summary: 'Approves positioning recommendations and messaging stacks or records actionable feedback.',
  kind: 'validation',
  inputContract: {
    mode: 'facets',
    facets: [...INPUT_FACETS]
  },
  outputContract: {
    mode: 'facets',
    facets: [...OUTPUT_FACETS]
  },
  heartbeat: {
    intervalSeconds: 21600,
    timeoutSeconds: 43200
  },
  instructionTemplates: {
    app: [
      'Review company_information, the positioning recommendation, opportunity analysis, and messaging stack.',
      'Approve when the positioning summary is ready for publication, or add targeted feedback entries describing required adjustments.',
      'If approval is blocked, clearly state the reason in the feedback facet.'
    ].join('\n'),
    summary: 'Brand director finalises or redirects positioning recommendations.'
  },
  assignmentDefaults: {
    role: 'Brand Director',
    maxNotifications: 2,
    timeoutSeconds: 43200,
    onDecline: 'fail_run'
  },
  metadata: {
    catalogTags: ['marketing-agency', 'sandbox'],
    collection: 'flex.marketing',
    runMode: 'human_assignment',
    scenarios: ['positioning_review'],
    sourceFiles: ['packages/flex-agents-server/src/agents/marketing/director-positioning-review.ts']
  }
}
