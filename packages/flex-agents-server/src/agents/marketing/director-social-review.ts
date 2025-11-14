import { getFacetCatalog, type CapabilityRegistration } from '@awesomeposter/shared'

export const DIRECTOR_SOCIAL_REVIEW_ID = 'director.SocialPostingReview' as const

const catalog = getFacetCatalog()
const INPUT_FACETS = ['company_information', 'post_context', 'strategic_rationale', 'post_copy', 'post_visual'] as const
const OUTPUT_FACETS = ['post', 'feedback'] as const

catalog.resolveMany([...INPUT_FACETS], 'input')
catalog.resolveMany([...OUTPUT_FACETS], 'output')

export const DIRECTOR_SOCIAL_REVIEW_CAPABILITY: CapabilityRegistration = {
  capabilityId: DIRECTOR_SOCIAL_REVIEW_ID,
  agentType: 'human',
  version: '1.0.0',
  displayName: 'Director – Social Review',
  summary: 'Reviews campaign deliverables, approves final social posts, or records structured feedback.',
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
      'Review company_information, the assembled social post (copy + visuals), and the strategist rationale.',
      'Approve the deliverable when it meets objectives, or add facet-specific feedback entries when revisions are required.',
      'If approval cannot proceed, clearly document the rationale in the feedback facet.'
    ].join('\n'),
    summary: 'Marketing director approves social post deliverables or logs targeted feedback.'
  },
  assignmentDefaults: {
    role: 'Marketing Director',
    maxNotifications: 2,
    timeoutSeconds: 43200,
    onDecline: 'fail_run'
  },
  metadata: {
    catalogTags: ['marketing-agency', 'sandbox'],
    collection: 'flex.marketing',
    runMode: 'human_assignment',
    scenarios: ['social_post_review'],
    sourceFiles: ['packages/flex-agents-server/src/agents/marketing/director-social-review.ts']
  }
}
