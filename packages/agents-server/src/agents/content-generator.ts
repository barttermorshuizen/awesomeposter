import { AgentRuntime } from '../services/agent-runtime'
import { Agent as OAAgent } from '@openai/agents'

export class ContentGeneratorAgent {
  constructor(private runtime: AgentRuntime) {}
}

// Agents SDK configuration for the Content specialist
export const CONTENT_TOOLS = [
  'apply_format_rendering',
  'optimize_for_platform'
] as const

// Default (app/workflow) instructions – used when the agent is called inside
// the orchestrated workflow where structured output is desired.
export const CONTENT_INSTRUCTIONS_APP = [
  'You are the Content Generator agent.',
  'Generate multi‑platform posts from the writer brief and 4‑knob configuration.',
  'Default to 3 variants unless the objective specifies otherwise. Each draft structure: first line is the hook, then a blank line, then the body.',
  'Use tools to apply format‑specific rendering and platform optimization while respecting platform rules and client policy (language, tone/voice, emoji, bannedClaims).',
  // Keep structured bias for workflow mode only.
  'When asked for a final result in workflow/app mode, produce strict JSON that the caller expects (no code fences). Prefer { drafts: [ { platform, variantId, post, altText } ] }.'
].join('\n')

// Chat instructions – used when the user is conversing directly with this agent.
// In chat mode we want plain text, not JSON wrappers.
export const CONTENT_INSTRUCTIONS_CHAT = [
  'You are the Content Generator agent speaking directly with a user.',
  'Return plain text only (no JSON/code fences).',
  'Default to one post unless asked for multiple. If multiple, number variants 1–N separated by blank lines.',
  'Structure each post: first line hook, blank line, then body. Use client language and tone when known.'
].join('\n')

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
