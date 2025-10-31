import { AgentRuntime } from '../../services/agent-runtime'
import { Agent as OAAgent } from '@openai/agents'
import { HITL_TOOL_NAME } from '../../tools/hitl'
import { getFacetCatalog, type CapabilityRegistration } from '@awesomeposter/shared'
import { DEFAULT_MODEL_FALLBACK } from '../../utils/model'

export const STRATEGIST_POSITIONING_ID = 'strategist.Positioning' as const

const catalog = getFacetCatalog()
const INPUT_FACETS = ['company_information', 'positioning_context', 'feedback'] as const
const OUTPUT_FACETS = ['value_canvas', 'positioning_opportunities', 'positioning_recommendation', 'handoff_summary'] as const

catalog.resolveMany([...INPUT_FACETS], 'input')
catalog.resolveMany([...OUTPUT_FACETS], 'output')

export const STRATEGIST_POSITIONING_TOOLS = [HITL_TOOL_NAME] as const

export const STRATEGIST_POSITIONING_INSTRUCTIONS_APP = [
  'You are the Strategist evaluating company positioning.',
  'Review company_information, positioning_context, and feedback to understand brand guardrails and market landscape before generating updates.',
  'Emit value_canvas, positioning_opportunities, positioning_recommendation, and update handoff_summary with rationale.',
  'Whenever competitive intel or stakeholder approval is missing, trigger the `hitl_request` tool with a concise question. Use `kind: "approval"` for yes/no decisions and `kind: "clarify"` for open questions—never provide multiple-choice options.',
  'If you have raised approval or clarify HITL, still emit a JSON object matching the output facet schemas; fill each required field with descriptive `PENDING_HITL: …` placeholders and include at least one entry for required arrays so downstream validators receive valid structure.'
].join('\n')

export const STRATEGIST_POSITIONING_INSTRUCTIONS_CHAT = [
  'Explain the recommended positioning in plain language.',
  'Highlight open questions and request human input only when required.',
  'Default to conservative recommendations unless clarified otherwise.'
].join('\n')

export const STRATEGIST_POSITIONING_CAPABILITY: CapabilityRegistration = {
  capabilityId: STRATEGIST_POSITIONING_ID,
  agentType: 'ai',
  version: '1.0.0',
  displayName: 'Strategist – Positioning',
  summary: 'Transforms market inputs into an updated positioning canvas, opportunity list, and recommendation.',
  inputTraits: {
    languages: ['en'],
    strengths: ['competitive_analysis', 'market_synthesis'],
    limitations: ['Needs company profile, positioning context, and prior feedback to operate effectively.']
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
    estimatedTokens: 2000,
    pricePer1kTokens: 0.018,
    currency: 'USD'
  },
  preferredModels: [DEFAULT_MODEL_FALLBACK],
  heartbeat: {
    intervalSeconds: 1200,
    timeoutSeconds: 3000
  },
  metadata: {
    catalogTags: ['marketing-agency', 'sandbox'],
    collection: 'flex.marketing',
    runMode: 'agent',
    scenarios: ['positioning_analysis'],
    sourceFiles: ['packages/flex-agents-server/src/agents/marketing/strategist-positioning.ts']
  }
}

export function createStrategistPositioningAgent(
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
  const instructions = mode === 'chat' ? STRATEGIST_POSITIONING_INSTRUCTIONS_CHAT : STRATEGIST_POSITIONING_INSTRUCTIONS_APP
  const tools = runtime.getAgentTools({ allowlist: [...STRATEGIST_POSITIONING_TOOLS], policy: opts?.policy, requestAllowlist: opts?.requestAllowlist }, onEvent) as any
  return new OAAgent({ name: 'Strategist – Positioning', instructions, tools })
}
