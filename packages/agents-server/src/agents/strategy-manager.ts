import { AgentRuntime } from '../services/agent-runtime'
import { Agent as OAAgent } from '@openai/agents'

export class StrategyManagerAgent {
  constructor(private runtime: AgentRuntime) {}
}

// Agents SDK configuration for the Strategy specialist
export const STRATEGY_TOOLS = [
  'io_get_brief',
  'io_list_assets',
  'io_get_client_profile',
  'strategy_analyze_assets',
  'strategy_plan_knobs'
] as const

// Default (app/workflow) instructions – structured output preferred
export const STRATEGY_INSTRUCTIONS_APP = [
  'You are the Strategy Manager agent for social content.',
  'Plan using a 4‑knob system: formatType, hookIntensity, expertiseDepth, structure.',
  'Use available tools to analyze assets and propose knob settings. Respect client policy; never invent assets.',
  'When asked for a final result in workflow/app mode, produce structured JSON that the caller expects.'
].join('\n')

// Chat instructions – respond in plain language, not JSON
export const STRATEGY_INSTRUCTIONS_CHAT = [
  'You are the Strategy Manager agent speaking directly with a user.',
  'Respond conversationally with plain text summaries and recommendations.',
  'Do NOT return JSON or wrap the answer in code fences.'
].join('\n')

export function createStrategyAgent(
  runtime: AgentRuntime,
  onEvent?: (e: { type: 'tool_call' | 'tool_result' | 'metrics'; name?: string; args?: any; result?: any; tokens?: number; durationMs?: number }) => void,
  opts?: { policy?: 'auto' | 'required' | 'off'; requestAllowlist?: string[] },
  mode: 'chat' | 'app' = 'app'
) {
  const tools = runtime.getAgentTools({ allowlist: [...STRATEGY_TOOLS], policy: opts?.policy, requestAllowlist: opts?.requestAllowlist }, onEvent) as any
  const instructions = mode === 'chat' ? STRATEGY_INSTRUCTIONS_CHAT : STRATEGY_INSTRUCTIONS_APP
  return new OAAgent({ name: 'Strategy Manager', instructions, tools })
}
