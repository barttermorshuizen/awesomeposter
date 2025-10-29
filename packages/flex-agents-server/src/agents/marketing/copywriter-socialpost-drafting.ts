import { AgentRuntime } from '../../services/agent-runtime'
import { Agent as OAAgent } from '@openai/agents'
import { HITL_TOOL_NAME } from '../../tools/hitl'
import { getFacetCatalog, type CapabilityRegistration } from '@awesomeposter/shared'
import { DEFAULT_MODEL_FALLBACK } from '../../utils/model'

export const COPYWRITER_SOCIAL_DRAFTING_ID = 'copywriter.SocialpostDrafting' as const

const catalog = getFacetCatalog()
const INPUT_FACETS = ['creative_brief', 'handoff_summary', 'feedback'] as const
const OUTPUT_FACETS = ['post_copy', 'handoff_summary'] as const

catalog.resolveMany([...INPUT_FACETS], 'input')
catalog.resolveMany([...OUTPUT_FACETS], 'output')

export const COPYWRITER_SOCIAL_DRAFTING_TOOLS = [HITL_TOOL_NAME] as const

export const COPYWRITER_SOCIAL_DRAFTING_INSTRUCTIONS_APP = [
  'You are the Copywriter producing social post variants from the strategist’s brief.',
  'Follow the creative_brief faithfully, respect tone and audience guidance, and append concise notes to handoff_summary.',
  'If brand, legal, or tone conflicts cannot be resolved confidently, pause and call `hitl_request`. Use `kind: "approval"` for binary decisions and `kind: "clarify"` for outstanding questions—never supply multiple-choice options.',
  'While waiting on HITL guidance, output placeholders that describe the pending approval.'
].join('\n')

export const COPYWRITER_SOCIAL_DRAFTING_INSTRUCTIONS_CHAT = [
  'Draft the requested social copy.',
  'Keep the tone aligned with the brief and call out any missing approvals.',
  'Ask for human input sparingly; prefer safe defaults when possible.'
].join('\n')

export const COPYWRITER_SOCIAL_DRAFTING_CAPABILITY: CapabilityRegistration = {
  capabilityId: COPYWRITER_SOCIAL_DRAFTING_ID,
  agentType: 'ai',
  version: '1.0.0',
  displayName: 'Copywriter – Social Drafting',
  summary: 'Generates or revises campaign copy using strategist output and reviewer feedback.',
  inputTraits: {
    languages: ['en'],
    formats: ['linkedin_post'],
    strengths: ['tone_adaptation', 'short_form_copy'],
    limitations: ['Needs a complete creative brief before drafting.']
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
    estimatedTokens: 1400,
    pricePer1kTokens: 0.012,
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
    scenarios: ['social_copy_generation'],
    sourceFiles: ['packages/flex-agents-server/src/agents/marketing/copywriter-socialpost-drafting.ts']
  }
}

export function createCopywriterSocialDraftingAgent(
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
  const instructions = mode === 'chat' ? COPYWRITER_SOCIAL_DRAFTING_INSTRUCTIONS_CHAT : COPYWRITER_SOCIAL_DRAFTING_INSTRUCTIONS_APP
  const tools = runtime.getAgentTools({ allowlist: [...COPYWRITER_SOCIAL_DRAFTING_TOOLS], policy: opts?.policy, requestAllowlist: opts?.requestAllowlist }, onEvent) as any
  return new OAAgent({ name: 'Copywriter – Social Drafting', instructions, tools })
}
