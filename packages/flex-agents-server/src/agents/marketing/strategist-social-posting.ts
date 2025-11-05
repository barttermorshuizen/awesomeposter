import { AgentRuntime } from '../../services/agent-runtime'
import { Agent as OAAgent } from '@openai/agents'
import { HITL_TOOL_NAME } from '../../tools/hitl'
import { STRATEGIST_KNOWLEDGE_TOOL_NAME } from '../../tools/strategist'
import { getFacetCatalog, type CapabilityRegistration } from '@awesomeposter/shared'
import { DEFAULT_MODEL_FALLBACK } from '../../utils/model'
import { STRATEGIST_CORPUS_ID } from '../../services/strategist-retrieval-service'

export const STRATEGIST_SOCIAL_POSTING_ID = 'strategist.SocialPosting' as const

const facetCatalog = getFacetCatalog()
const INPUT_FACETS = ['company_information', 'post_context'] as const
const OUTPUT_FACETS = ['creative_brief', 'strategic_rationale', 'handoff_summary'] as const

facetCatalog.resolveMany([...INPUT_FACETS], 'input')
facetCatalog.resolveMany([...OUTPUT_FACETS], 'output')

const FEEDBACK_DIRECTIVE = `Address feedback in the run context with facet = ["${OUTPUT_FACETS.join('", "')}"] before finalising your update.`

export const STRATEGIST_SOCIAL_POSTING_TOOLS = [HITL_TOOL_NAME, STRATEGIST_KNOWLEDGE_TOOL_NAME] as const

export const STRATEGIST_SOCIAL_POSTING_INSTRUCTIONS_APP = [
  'You are the Strategist responsible for planning social posting work.',
  'Review company_information and post_context to understand goals, audience, and brand guardrails.',
  'Before drafting, call the `strategist_retrieve_knowledge` tool with a concise query capturing the objective, channel, and any unresolved questions. Incorporate relevant snippets (or fallback guidance) into your plan.',
  FEEDBACK_DIRECTIVE,
  'Produce a concise strategic_rationale, an actionable creative_brief, and update the handoff_summary with key decisions.',
  'If critical context is missing or contradictory, pause and call the `hitl_request` tool. Clearly state the human decision required.',
  'When you invoke the `hitl_request` tool (approval or clarify), stop further planning and emit JSON that still satisfies the creative_brief, strategic_rationale, and handoff_summary schema—use `PENDING_HITL: …` placeholder strings and minimal placeholder list entries so the structure remains valid.',
  'Do not send standalone prose while paused; always respond with the contract-shaped JSON populated by those placeholders until the human responds.',
  'Do not raise a new HITL question if any prior human response resolves the same missing field, even if other fields remain unresolved.'
].join('\n')

export const STRATEGIST_SOCIAL_POSTING_INSTRUCTIONS_CHAT = [
  'You are the Strategist providing guidance in natural language.',
  'When additional context would help, call `strategist_retrieve_knowledge` with a focused query and weave the insights into your response.',
  FEEDBACK_DIRECTIVE,
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
    limitations: ['Requires structured campaign context, company profile, and uses run-context feedback for revision history.']
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
    sourceFiles: ['packages/flex-agents-server/src/agents/marketing/strategist-social-posting.ts'],
    retrieval: {
      mode: 'vector_store',
      corpusId: STRATEGIST_CORPUS_ID,
      storage: 'postgres.pgvector',
      embeddingModel: 'text-embedding-3-small',
      refreshCadence: 'monthly'
    },
    healthSignals: [
      'strategist_retrieval_ready',
      'strategist_retrieval_fallback',
      'strategist_retrieval_unavailable'
    ]
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
