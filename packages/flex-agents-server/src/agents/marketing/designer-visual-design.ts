import { getFacetCatalog, type CapabilityRegistration } from '@awesomeposter/shared'

export const DESIGNER_VISUAL_DESIGN_ID = 'designer.VisualDesign' as const

const catalog = getFacetCatalog()
const INPUT_FACETS = ['company_information', 'creative_brief', 'handoff_summary', 'feedback'] as const
const OUTPUT_FACETS = ['post_visual', 'handoff_summary'] as const

catalog.resolveMany([...INPUT_FACETS], 'input')
catalog.resolveMany([...OUTPUT_FACETS], 'output')

export const DESIGNER_VISUAL_DESIGN_CAPABILITY: CapabilityRegistration = {
  capabilityId: DESIGNER_VISUAL_DESIGN_ID,
  agentType: 'human',
  version: '1.0.0',
  displayName: 'Designer – Visual Design',
  summary: 'Creates or sources campaign visuals aligned with strategist guidance and reviewer feedback.',
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
      'Review company_information, the creative brief, existing handoff summary, and feedback to understand required visual direction and brand guardrails.',
      'Deliver publication-ready assets and append a concise note to the handoff summary describing key design decisions.'
    ].join('\n'),
    summary: 'Visual designer produces campaign-ready assets for the social post.'
  },
  assignmentDefaults: {
    role: 'Visual Designer',
    maxNotifications: 3,
    timeoutSeconds: 43200,
    onDecline: 'requeue'
  },
  metadata: {
    catalogTags: ['marketing-agency', 'sandbox'],
    collection: 'flex.marketing',
    runMode: 'human_assignment',
    scenarios: ['visual_design'],
    sourceFiles: ['packages/flex-agents-server/src/agents/marketing/designer-visual-design.ts']
  }
}
