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

export const CONTENT_INSTRUCTIONS = [
  'You are the Content Generator agent.',
  'Generate multi‑platform posts based on the 4‑knob configuration and client language.',
  'Use tools to apply format‑specific rendering and platform optimization while respecting platform rules and client policy.',
  'If you return a final answer yourself, output only JSON per the expected schema.'
].join('\n')

export function createContentAgent(
  runtime: AgentRuntime,
  onEvent?: (e: { type: 'tool_call' | 'tool_result' | 'metrics'; name?: string; args?: any; result?: any; tokens?: number; durationMs?: number }) => void
) {
  const tools = runtime.getAgentTools([...CONTENT_TOOLS], onEvent) as any
  return new OAAgent({ name: 'Content Generator', instructions: CONTENT_INSTRUCTIONS, tools })
}
