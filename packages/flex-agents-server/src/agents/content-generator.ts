import { AgentRuntime } from '../services/agent-runtime'
import { Agent as OAAgent } from '@openai/agents'
import { HITL_TOOL_NAME } from '../tools/hitl'
import type { CapabilityRegistration } from '@awesomeposter/shared'
import { DEFAULT_MODEL_FALLBACK } from '../utils/model'

export class ContentGeneratorAgent {
  constructor(private runtime: AgentRuntime) {}
}

export const CONTENT_CAPABILITY_ID = `${ContentGeneratorAgent.name}.linkedinVariants` as const

export const CONTENT_CAPABILITY: CapabilityRegistration = {
  capabilityId: CONTENT_CAPABILITY_ID,
  version: '1.0.0',
  displayName: 'Copywriter – LinkedIn Variants',
  summary: 'Generates polished LinkedIn post variants using supplied brief, tone, and policy guidance.',
  inputTraits: {
    languages: ['en', 'nl'],
    formats: ['linkedin_post'],
    strengths: ['variant_generation', 'platform_optimization'],
    limitations: ['Best for short-form LinkedIn posts with 1–5 variants.']
  },
  inputContract: {
    mode: 'json_schema',
    schema: {
      type: 'object',
      properties: {
        variantCount: { type: 'integer', minimum: 1, maximum: 5 },
        tone: { type: 'string' },
        audience: { type: 'string' },
        contextBundles: { type: 'array' }
      },
      additionalProperties: true
    }
  },
  outputContract: {
    mode: 'json_schema',
    schema: {
      type: 'object',
      required: ['variants'],
      properties: {
        variants: {
          type: 'array',
          minItems: 1,
          maxItems: 5,
          items: {
            type: 'object',
            required: ['headline', 'body', 'callToAction'],
            properties: {
              headline: { type: 'string', minLength: 5 },
              body: { type: 'string', minLength: 20 },
              callToAction: { type: 'string', minLength: 2 }
            },
            additionalProperties: true
          }
        }
      },
      additionalProperties: false
    }
  },
  cost: {
    tier: 'standard',
    estimatedTokens: 1200,
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
      'packages/flex-agents-server/src/agents/content-generator.ts',
      'packages/flex-agents-server/src/services/flex-execution-engine.ts'
    ],
    runMode: 'orchestrated_llm',
    scenarios: ['linkedin_post_variants']
  }
}

export const CONTENT_TOOLS = [
  'apply_format_rendering',
  'optimize_for_platform',
  HITL_TOOL_NAME
] as const

const HITL_ENABLED = process.env.ENABLE_HITL === 'true'

export const CONTENT_INSTRUCTIONS_APP = [
  'You are the Content Generator agent.',
  'Generate or revise a post based on the description of the brief and the guidelines provided in the writer brief.',
  'A post has the structure: first line is the hook, then a blank line, then the body, then the CTA (if any), and then the hashtags (if any).',
  'The writer brief contains a description. This is the source information from the client brief - make certain the created content reflects this.',
  'The writerBrief contains hooks and CTAs - choose one of each and adapt it to fit the tone of voice, audience, objective, and the body of the post.',
  'The writerBrief may contain special instructions that must be followed exactly, so always check for those.',
  'The writerBrief contains a language - the post must be written in that language, including the CTA and hook',
  'If a special instruction in the writerBrief conflicts with other information in the writerBrief, the special instruction takes precedence.',
  'Payload contract:',
  '- "writerBrief" and optional "knobs" describe the target content.',
  '- If "contentRecommendations" (array of strings) is present, this is a revision task: apply the recommendations with minimal necessary edits.',
  '- If "previousDraft" is provided, use it as the base and only change what is required to follow the recommendations; otherwise, regenerate while deviating only where needed to satisfy them.',
  'Use tools to apply format‑specific rendering and platform optimization while respecting platform rules and client policy.',
  'Output only the final post as plain text (no JSON or code fences).'
].concat(
  HITL_ENABLED
    ? [
        'If brand, legal, or tone decisions cannot be resolved safely, pause and call the `hitl_request` tool with the question. Only attach draft options when you can present ready-to-send alternatives the operator might approve; otherwise expect a freeform response.',
        'When you invoke `hitl_request`, ensure the `question` field clearly states the decision the operator must make. Options are for concrete draft alternatives; otherwise leave them empty.',
        'Whenever `payload.humanGuidance` or `payload.hitlResponses` is present, treat those operator answers as the highest-priority guidance. Apply them before relying on legacy brief data, and do not escalate the same question again unless new clarification is required.'
      ]
    : []
).join('\n')

export const CONTENT_INSTRUCTIONS_CHAT = [
  'You are the Content Generator agent speaking directly with a user.',
  'Return plain text only (no JSON/code fences).',
  'Default to one post unless asked for multiple. If multiple, number variants 1–N separated by blank lines.',
  'Structure each post: first line hook, blank line, then body.',
  'If the user provides "contentRecommendations" and/or a previous draft, treat it as a revision: keep the copy intact except changes required to follow the recommendations.',
  'Use tools to apply format‑specific rendering and platform optimization while respecting platform rules and client policy.'
].concat(
  HITL_ENABLED
    ? [
        'If the user requests content that conflicts with policy or needs human approval, invoke the `hitl_request` tool to escalate rather than guessing.',
        'Always populate the `question` field when calling `hitl_request`; describe the decision in one concise sentence.',
        'Only include options when you can offer concrete drafts or answer choices; otherwise rely on the operator\'s freeform reply.',
        'When you receive humanGuidance or hitlResponses in the payload, assume those operator directives outrank earlier instructions and incorporate them immediately.'
      ]
    : []
).join('\n')

export function createContentAgent(
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
  const tools = runtime.getAgentTools({ allowlist: [...CONTENT_TOOLS], policy: opts?.policy, requestAllowlist: opts?.requestAllowlist }, onEvent) as any
  const instructions = mode === 'chat' ? CONTENT_INSTRUCTIONS_CHAT : CONTENT_INSTRUCTIONS_APP
  return new OAAgent({ name: 'Content Generator', instructions, tools })
}
