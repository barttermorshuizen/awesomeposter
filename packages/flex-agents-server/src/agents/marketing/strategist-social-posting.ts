import { AgentRuntime } from '../../services/agent-runtime'
import { Agent as OAAgent } from '@openai/agents'
import { HITL_TOOL_NAME } from '../../tools/hitl'
import { getFacetCatalog, type CapabilityRegistration } from '@awesomeposter/shared'
import { DEFAULT_MODEL_FALLBACK } from '../../utils/model'

export const STRATEGIST_SOCIAL_POSTING_ID = 'strategist.SocialPosting' as const

const facetCatalog = getFacetCatalog()
const INPUT_FACETS = ['company_information', 'post_context', 'feedback'] as const
const OUTPUT_FACETS = ['creative_brief', 'strategic_rationale', 'handoff_summary'] as const

facetCatalog.resolveMany([...INPUT_FACETS], 'input')
facetCatalog.resolveMany([...OUTPUT_FACETS], 'output')

export const STRATEGIST_SOCIAL_POSTING_TOOLS = [HITL_TOOL_NAME] as const

export const STRATEGIST_SOCIAL_POSTING_INSTRUCTIONS_APP = [
  'You are the Strategist responsible for planning social posting work.',
  'Review company_information, post_context, and any existing feedback to understand goals, audience, and brand guardrails.',
  'Produce a concise strategic_rationale, an actionable creative_brief, and update the handoff_summary with key decisions.',
  'If critical context is missing or contradictory, pause and call the `hitl_request` tool. Clearly state the human decision required.',
  'When you invoke the `hitl_request` tool (approval or clarify), stop further planning and emit JSON that still satisfies the creative_brief, strategic_rationale, and handoff_summary schema—use `PENDING_HITL: …` placeholder strings and minimal placeholder list entries so the structure remains valid.',
  'Do not send standalone prose while paused; always respond with the contract-shaped JSON populated by those placeholders until the human responds.',
  'Do not raise a new HITL question if any prior human response resolves the same missing field, even if other fields remain unresolved.'
].join('\n')

export const STRATEGIST_SOCIAL_POSTING_INSTRUCTIONS_CHAT = [
  'You are the Strategist providing guidance in natural language.',
  'Explain the recommended approach and highlight any missing context.',
  'Ask for clarification sparingly; prefer safe defaults unless human approval is required.'
].join('\n')

export const STRATEGIST_SOCIAL_POSTING_CAPABILITY: CapabilityRegistration = {
  capabilityId: STRATEGIST_SOCIAL_POSTING_ID,
  agentType: 'ai',
  version: '1.0.0',
  displayName: 'Strategist – Social Posting',
  summary: 'Plans social campaign briefs, rationale, and handoff notes from marketing-context inputs.',
  inputTraits: {
    languages: ['en'],
    strengths: ['campaign_planning', 'audience_strategy'],
    limitations: ['Requires structured campaign context, company profile, and audience detail.']
  },
  inputContract: {
    mode: 'facets',
    facets: [...INPUT_FACETS]
  },
  outputContract: {
    mode: 'facets',
    facets: [...OUTPUT_FACETS]
  },
  cost: {
    tier: 'standard',
    estimatedTokens: 1600,
    pricePer1kTokens: 0.015,
    currency: 'USD'
  },
  preferredModels: [DEFAULT_MODEL_FALLBACK],
  heartbeat: {
    intervalSeconds: 900,
    timeoutSeconds: 2400
  },
  metadata: {
    catalogTags: ['marketing-agency', 'sandbox'],
    collection: 'flex.marketing',
    runMode: 'agent',
    scenarios: ['social_post_strategy'],
    sourceFiles: ['packages/flex-agents-server/src/agents/marketing/strategist-social-posting.ts']
  }
}

export function createStrategistSocialPostingAgent(
  runtime: AgentRuntime,
  onEvent?: (
    ev: {
      type: 'tool_call' | 'tool_result' | 'metrics'
      name?: string
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      args?: any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      result?: any
      durationMs?: number
      tokens?: number
    }
  ) => void,
  opts?: { policy?: 'auto' | 'required' | 'off'; requestAllowlist?: string[] },
  mode: 'chat' | 'app' = 'app'
) {
  const instructions = mode === 'chat' ? STRATEGIST_SOCIAL_POSTING_INSTRUCTIONS_CHAT : STRATEGIST_SOCIAL_POSTING_INSTRUCTIONS_APP
  const tools = runtime.getAgentTools({ allowlist: [...STRATEGIST_SOCIAL_POSTING_TOOLS], policy: opts?.policy, requestAllowlist: opts?.requestAllowlist }, onEvent) as any
  return new OAAgent({ name: 'Strategist – Social Posting', instructions, tools })
}
