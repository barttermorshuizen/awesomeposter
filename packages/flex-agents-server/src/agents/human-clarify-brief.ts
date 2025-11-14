import { getFacetCatalog, type CapabilityRegistration } from '@awesomeposter/shared'

export const HUMAN_CLARIFY_CAPABILITY_ID = 'HumanAgent.clarifyBrief' as const

const facetCatalog = getFacetCatalog()
const HUMAN_CLARIFY_INPUT_FACETS = [
  'objectiveBrief',
  'audienceProfile',
  'toneOfVoice',
  'writerBrief',
  'clarificationRequest'
] as const
const HUMAN_CLARIFY_OUTPUT_FACETS = ['clarificationResponse'] as const

facetCatalog.resolveMany([...HUMAN_CLARIFY_INPUT_FACETS], 'input')
facetCatalog.resolveMany([...HUMAN_CLARIFY_OUTPUT_FACETS], 'output')

const HUMAN_ASSIGNMENT_TIMEOUT_SECONDS = (() => {
  const configured = Number(process.env.FLEX_HUMAN_ASSIGNMENT_TIMEOUT_SECONDS)
  if (Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured)
  }
  // Default to 15 minutes if not configured
  return 15 * 60
})()

export const HUMAN_CLARIFY_INSTRUCTIONS_APP = [
  'You are stepping in as the human strategist assigned to unblock a flex orchestration run.',
  'Review the objective, audience, tone, and existing writer brief details to understand the current plan.',
  'Examine the outstanding clarification prompts. Provide concise, unambiguous answers for each required item.',
  'If you cannot provide an answer, mark the item as `declined` and include a short rationale—this will fail the run so the requester can resubmit with better information.',
  'Submit the structured response only once. Notifications are not re-sent, so complete all answers before submitting.',
  `You must respond within ${HUMAN_ASSIGNMENT_TIMEOUT_SECONDS} seconds or the task will time out and fail the run automatically.`
].join('\n')

export const HUMAN_CLARIFY_INSTRUCTIONS_NOTIFICATION = [
  'Clarify the pending questions for the current flex run.',
  'Respond within the configured SLA or the run will fail.',
  'Declining any question will stop the run and notify the requester.'
].join(' ')

export const HUMAN_CLARIFY_CAPABILITY: CapabilityRegistration = {
  capabilityId: HUMAN_CLARIFY_CAPABILITY_ID,
  version: '1.0.0',
  displayName: 'Human Operator – Brief Clarification',
  summary:
    'Collects structured clarifications from a human strategist to unblock flex planning when automated context is insufficient.',
  kind: 'structuring',
  agentType: 'human',
  inputTraits: {
    languages: ['en'],
    strengths: ['human_judgment', 'client_context_interpretation'],
    limitations: ['requires_manual_response']
  },
  inputContract: {
    mode: 'facets',
    facets: [...HUMAN_CLARIFY_INPUT_FACETS]
  },
  outputContract: {
    mode: 'facets',
    facets: [...HUMAN_CLARIFY_OUTPUT_FACETS]
  },
  cost: {
    tier: 'human',
    currency: 'EUR'
  },
  instructionTemplates: {
    app: HUMAN_CLARIFY_INSTRUCTIONS_APP,
    notification: HUMAN_CLARIFY_INSTRUCTIONS_NOTIFICATION,
    summary: 'Human strategist clarifies outstanding questions and may decline, which fails the run.'
  },
  assignmentDefaults: {
    role: 'Strategist',
    notifyChannels: ['in_app'],
    maxNotifications: 1,
    timeoutSeconds: HUMAN_ASSIGNMENT_TIMEOUT_SECONDS,
    onDecline: 'fail_run',
    instructions:
      'Complete all clarification responses in one submission. Declining any item or missing the SLA fails the run.'
  },
  metadata: {
    runMode: 'human',
    supportsDecline: true,
    sourceFiles: ['packages/flex-agents-server/src/agents/human-clarify-brief.ts'],
    assignmentPolicy: {
      timeoutSeconds: HUMAN_ASSIGNMENT_TIMEOUT_SECONDS,
      onDecline: 'fail_run'
    }
  }
}

export { HUMAN_ASSIGNMENT_TIMEOUT_SECONDS }
