import { AgentRuntime } from '../services/agent-runtime'
import { Agent as OAAgent } from '@openai/agents'
import { HITL_TOOL_NAME } from '../tools/hitl'
import { getFacetCatalog, type CapabilityRegistration } from '@awesomeposter/shared'
import { DEFAULT_MODEL_FALLBACK } from '../utils/model'

export class StrategyManagerAgent {
  constructor(private runtime: AgentRuntime) {}
}

export const STRATEGY_CAPABILITY_ID = `${StrategyManagerAgent.name}.briefing` as const

const facetCatalog = getFacetCatalog()
const STRATEGY_INPUT_FACETS = ['objectiveBrief', 'audienceProfile', 'toneOfVoice', 'assetBundle'] as const
const STRATEGY_OUTPUT_FACETS = ['writerBrief', 'planKnobs', 'strategicRationale'] as const
facetCatalog.resolveMany([...STRATEGY_INPUT_FACETS], 'input')
facetCatalog.resolveMany([...STRATEGY_OUTPUT_FACETS], 'output')

export const STRATEGY_CAPABILITY = {
  capabilityId: STRATEGY_CAPABILITY_ID,
  agentType: 'ai',
  version: '1.0.0',
  displayName: 'Strategy Manager',
  summary: 'Plans rationale, writer brief, and knob configuration using client profile, brief inputs, and asset analysis.',
  inputTraits: {
    languages: ['en', 'nl'],
    strengths: ['brief_planning', 'knob_configuration', 'asset_analysis'],
    limitations: ['Requires objective and audience details from the client brief before proceeding.']
  },
  inputContract: {
    mode: 'facets',
    facets: [...STRATEGY_INPUT_FACETS]
  },
  outputContract: {
    mode: 'facets',
    facets: [...STRATEGY_OUTPUT_FACETS]
  },
  cost: {
    tier: 'standard',
    estimatedTokens: 1800,
    currency: 'USD',
    pricePer1kTokens: 0.015
  },
  preferredModels: [DEFAULT_MODEL_FALLBACK],
  heartbeat: {
    intervalSeconds: 600,
    timeoutSeconds: 1800
  },
  metadata: {
    sourceFiles: [
      'packages/flex-agents-server/src/agents/strategy-manager.ts',
      'packages/flex-agents-server/src/tools/strategy.ts'
    ],
    runMode: 'agent',
    scenarios: ['briefing', 'knob_planning']
  }
} as CapabilityRegistration

// Agents SDK configuration for the Strategy specialist
export const STRATEGY_TOOLS = [
  'strategy_analyze_assets',
  'strategy_plan_knobs',
  HITL_TOOL_NAME
] as const

const HITL_ENABLED = process.env.ENABLE_HITL === 'true'

export const STRATEGY_INSTRUCTIONS_APP = [
  'You are the Strategy Manager agent for social content. Your job is to create a rationale, a detailed writer brief and a strict knob configuration for the Content Creator agent based on the provided Client Profile and Brief',
  'Before planning, validate the brief: if the objective is missing, extremely short (< 10 characters), or obviously placeholder text (e.g., "tbd", "???", "kkk"), or if the audienceId is empty/unknown, you must pause and escalate.',
  'Escalate by calling hitl_request with a concise human-readable question that states exactly what decision the operator needs to make. Use `kind: "approval"` for binary decisions and `kind: "clarify"` for open questions—do not present multiple-choice options.',
  'After raising hitl_request (including clarify questions), you must still return exactly one JSON object that follows the output contract. Populate each required field with an explicit placeholder such as "Awaiting operator clarification for <detail>" so the runtime can pause safely.',
  'Plan using the 4‑knob system and enforce strict knob typing.',
  'Never invent assets or client data. Use tools to analyze assets before choosing a format.',
  'formatType MUST be achievable with available assets. If a requested format is unachievable, select the closest achievable alternative and explain the tradeoff in rationale.',
  '',
  'Knob schema (STRICT):',
  '- formatType: one of "text" | "single_image" | "multi_image" | "document_pdf" | "video" (must be achievable).',
  '- hookIntensity: number 0.0–1.0 (opening line strength).',
  '- expertiseDepth: number 0.0–1.0 (practitioner‑level specificity).',
  '- structure: { lengthLevel: number 0.0–1.0, scanDensity: number 0.0–1.0 }.',
  '',
  'Use tools:',
  '- strategy_analyze_assets to determine achievableFormats and recommendations.',
  '- strategy_plan_knobs to compute a compliant knob configuration given the objective and asset analysis.',
  '',
  'Deliverable (APP/WORKFLOW MODE): return ONE JSON object only (no code fences) with fields: rationale, writerBrief (including knob settings), and knobs. Do NOT generate content drafts.',
  'Output MUST always be JSON: never emit freeform commentary before or after the JSON object, even if you are waiting on human clarification.',
  'If information is missing because a hitl_request is pending, keep the JSON structure intact and use descriptive placeholder strings that clearly state which human details are required.',
  'Determine the best angle, hooks and CTAs based on the description, objective and audience of the client brief.',
  'Output contract (strict JSON, one object only):',
  '{',
  '  "rationale": "<short reasoning for the chosen approach and key strategic choices>",',
  '  "writerBrief": {',
  '    "clientName": "<exact client/company name>",',
  '    "objective": "<what the content must achieve>",',
  '    "description": "<the description as given in the client brief>",',
  '    "audience": "<who we are targeting>",',
  '    "platform": "<e.g., linkedin | x>",',
  '    "language": "<e.g., nl | en>",',
  '    "tone": "<tone of voice and tone guidelines from the client>",',
  '    "angle": "<selected angle>",',
  '    "hooks": [ "<hook option 1>", "<hook option 2>" ],',
  '    "cta": "<clear CTA (if any)>",',
  '    "customInstructions": [ "<exact client special instructions for the writer to follow>" ],',
  '    "constraints": { "maxLength?": <number> },',
  '    "knobs": {',
  '      "formatType": "text" | "single_image" | "multi_image" | "document_pdf" | "video",',
  '      "hookIntensity": <number 0.0-1.0>,',
  '      "expertiseDepth": <number 0.0-1.0>,',
  '      "structure": { "lengthLevel": <number 0.0-1.0>, "scanDensity": <number 0.0-1.0> }',
  '    }',
  '  },',
  '  "knobs": {',
  '    "formatType": "text" | "single_image" | "multi_image" | "document_pdf" | "video",',
  '    "hookIntensity": <number 0.0-1.0>,',
  '    "expertiseDepth": <number 0.0-1.0>,',
  '    "structure": { "lengthLevel": <number 0.0-1.0>, "scanDensity": <number 0.0-1.0> }',
  '  }',
  '}',
  'Notes:',
  '- Use the client/company name from the provided Client Profile (do not invent or translate it).',
  '- writerBrief.knobs must mirror the top‑level knobs exactly.',
  '- Keep rationale concise (3–5 sentences max).',
  '- Return one JSON object only; do NOT include markdown or code fences.'
].concat(
  HITL_ENABLED
    ? [
        'If required brief data is missing (no objective, meaningless/placeholder objective, unknown audience), call the `hitl_request` tool. DO NOT continue planning without human clarification.',
        'When you invoke `hitl_request`, set the `question` field to a single sentence summarising the human decision.',
        'If `payload.humanGuidance` or `payload.hitlResponses` contains operator answers, treat the most recent response as the source of truth. Resolve conflicts in favour of that guidance and do NOT raise the same HITL question again unless the operator explicitly requests a change.'
      ]
    : []
).join('\n')

// Chat instructions – respond in plain language, not JSON
export const STRATEGY_INSTRUCTIONS_CHAT = [
  'You are the Strategy Manager agent speaking directly with a user.',
  'Respond conversationally with plain‑text, actionable recommendations.',
  'If critical info is missing, ask at most one clarifying question before proposing a safe default.',
  'Reflect client language, tone/voice, and guardrails when known. Do NOT return JSON or code fences.',
  'Ask explicitly if there are special instructions that must be followed when none are provided.'
].concat(
  HITL_ENABLED
    ? [
        'Escalate with the `hitl_request` tool when a human decision is required (e.g., conflicting guardrails or missing approvals) instead of improvising.',
        'Always populate the `question` field when calling `hitl_request`; never leave it empty.',
        'When hitl responses are provided (payload.humanGuidance or payload.hitlResponses), regard them as the latest operator guidance and give them precedence over legacy brief data or prior assumptions.'
      ]
    : []
).join('\n')

export function createStrategyAgent(
  runtime: AgentRuntime,
  onEvent?: (
    e: {
      type: 'tool_call' | 'tool_result' | 'metrics'
      name?: string
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Agents SDK emits arbitrary tool arguments
      args?: any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tool outputs are passthrough from agents runtime
      result?: any
      tokens?: number
      durationMs?: number
    }
  ) => void,
  opts?: { policy?: 'auto' | 'required' | 'off'; requestAllowlist?: string[] },
  mode: 'chat' | 'app' = 'app'
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Agents SDK returns untyped tool map; casting for OpenAI agent constructor
  const tools = runtime.getAgentTools({ allowlist: [...STRATEGY_TOOLS], policy: opts?.policy, requestAllowlist: opts?.requestAllowlist }, onEvent) as any
  const instructions = mode === 'chat' ? STRATEGY_INSTRUCTIONS_CHAT : STRATEGY_INSTRUCTIONS_APP
  return new OAAgent({ name: 'Strategy Manager', instructions, tools })
}
