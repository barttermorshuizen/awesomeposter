import { AgentRuntime } from '../services/agent-runtime'
import { Agent as OAAgent } from '@openai/agents'
import { HITL_TOOL_NAME } from '../tools/hitl'

const HITL_ENABLED = process.env.ENABLE_HITL === 'true'

export class ContentGeneratorAgent {
  constructor(private runtime: AgentRuntime) {}
}

// Agents SDK configuration for the Content specialist
export const CONTENT_TOOLS = [
  'apply_format_rendering',
  'optimize_for_platform',
  HITL_TOOL_NAME
] as const

// Default (app/workflow) instructions – used when the agent is called inside
// the orchestrated workflow where structured output is desired.
export const CONTENT_INSTRUCTIONS_APP = [
  'You are the Content Generator agent.',
  'Generate or revise a post based on the description of the brief and the guidelines provided in the writer brief.',
  'A post has the structure: first line is the hook, then a blank line, then the body, then the hashtags (if any).',
  'Payload contract:',
  '- "writerBrief" and optional "knobs" describe the target content.',
  '- If "contentRecommendations" (array of strings) is present, this is a revision task: apply the recommendations with minimal necessary edits.',
  '- If "previousDraft" is provided, use it as the base and only change what is required to follow the recommendations; otherwise, regenerate while deviating only where needed to satisfy them.',
  'Use tools to apply format‑specific rendering and platform optimization while respecting platform rules and client policy.',
  'Output only the final post as plain text (no JSON or code fences).'
].concat(
  HITL_ENABLED
    ? [
        'If brand, legal, or tone decisions cannot be resolved safely, pause and call the `hitl_request` tool with the question and any viable draft options instead of publishing uncertain copy.',
        'When you invoke `hitl_request`, ensure the `question` field clearly states the decision the operator must make and include any draft alternatives as options.',
        'Whenever `payload.humanGuidance` or `payload.hitlResponses` is present, treat those operator answers as the highest-priority guidance. Apply them before relying on legacy brief data, and do not escalate the same question again unless new clarification is required.'
      ]
    : []
).join('\n')

// Chat instructions – used when the user is conversing directly with this agent.
// In chat mode we want plain text, not JSON wrappers.
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
        'When you receive humanGuidance or hitlResponses in the payload, assume those operator directives outrank earlier instructions and incorporate them immediately.'
      ]
    : []
).join('\n')

export function createContentAgent(
  runtime: AgentRuntime,
  onEvent?: (e: { type: 'tool_call' | 'tool_result' | 'metrics'; name?: string; args?: any; result?: any; tokens?: number; durationMs?: number }) => void,
  opts?: { policy?: 'auto' | 'required' | 'off'; requestAllowlist?: string[] },
  mode: 'chat' | 'app' = 'app'
) {
  const tools = runtime.getAgentTools({ allowlist: [...CONTENT_TOOLS], policy: opts?.policy, requestAllowlist: opts?.requestAllowlist }, onEvent) as any
  const instructions = mode === 'chat' ? CONTENT_INSTRUCTIONS_CHAT : CONTENT_INSTRUCTIONS_APP
  return new OAAgent({ name: 'Content Generator', instructions, tools })
}
