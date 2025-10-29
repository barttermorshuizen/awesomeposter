import { AgentRuntime } from '../../services/agent-runtime'
import { Agent as OAAgent } from '@openai/agents'
import { HITL_TOOL_NAME } from '../../tools/hitl'
import { getFacetCatalog, type CapabilityRegistration } from '@awesomeposter/shared'
import { DEFAULT_MODEL_FALLBACK } from '../../utils/model'

export const COPYWRITER_MESSAGING_ID = 'copywriter.Messaging' as const

const catalog = getFacetCatalog()
const INPUT_FACETS = ['positioning_context', 'positioning_recommendation', 'feedback'] as const
const OUTPUT_FACETS = ['messaging_stack', 'handoff_summary'] as const

catalog.resolveMany([...INPUT_FACETS], 'input')
catalog.resolveMany([...OUTPUT_FACETS], 'output')

export const COPYWRITER_MESSAGING_TOOLS = [HITL_TOOL_NAME] as const

export const COPYWRITER_MESSAGING_INSTRUCTIONS_APP = [
  'You are the Copywriter translating positioning into a messaging stack.',
  'Use positioning_recommendation and positioning_context to craft clear message pillars with proof points, then update handoff_summary.',
  'Escalate with `hitl_request` whenever stakeholder approval or clarity is missing. Set `kind: "approval"` for yes/no decisions; otherwise use `kind: "clarify"` and capture the question without presenting multiple-choice options.',
  'While waiting on human input, describe pending items in the output facets instead of inventing messaging.'
].join('\n')

export const COPYWRITER_MESSAGING_INSTRUCTIONS_CHAT = [
  'Outline the recommended messaging hierarchy in plain language.',
  'Highlight outstanding approvals and request human input only when necessary.'
].join('\n')

export const COPYWRITER_MESSAGING_CAPABILITY: CapabilityRegistration = {
  capabilityId: COPYWRITER_MESSAGING_ID,
  agentType: 'ai',
  version: '1.0.0',
  displayName: 'Copywriter – Messaging Stack',
  summary: 'Converts positioning recommendations into a structured messaging hierarchy.',
  inputTraits: {
    languages: ['en'],
    strengths: ['messaging_frameworks', 'tone_alignment'],
    limitations: ['Requires fresh positioning recommendation data.']
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
    estimatedTokens: 1500,
    pricePer1kTokens: 0.013,
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
    scenarios: ['messaging_framework'],
    sourceFiles: ['packages/flex-agents-server/src/agents/marketing/copywriter-messaging.ts']
  }
}

export function createCopywriterMessagingAgent(
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
  const instructions = mode === 'chat' ? COPYWRITER_MESSAGING_INSTRUCTIONS_CHAT : COPYWRITER_MESSAGING_INSTRUCTIONS_APP
  const tools = runtime.getAgentTools({ allowlist: [...COPYWRITER_MESSAGING_TOOLS], policy: opts?.policy, requestAllowlist: opts?.requestAllowlist }, onEvent) as any
  return new OAAgent({ name: 'Copywriter – Messaging Stack', instructions, tools })
}
