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
  'Generate multi‑platform posts based on the 4‑knob configuration and client language.',
  'Use tools to apply format‑specific rendering and platform optimization while respecting platform rules and client policy.',
  // Keep structured bias for workflow mode only.
  'When asked for a final result in workflow/app mode, produce structured JSON that the caller expects.'
].join('\n')

// Chat instructions – used when the user is conversing directly with this agent.
// In chat mode we want plain text, not JSON wrappers.
export const CONTENT_INSTRUCTIONS_CHAT = [
  'You are the Content Generator agent speaking directly with a user.',
  'Respond conversationally with the content only.',
  'Do NOT return JSON, code fences, or wrap the answer in an object.',
  'When asked to produce a post, return only the post text.'
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
