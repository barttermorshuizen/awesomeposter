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

export const STRATEGY_INSTRUCTIONS = [
  'You are the Strategy Manager agent for social content.',
  'Plan using a 4‑knob system: formatType, hookIntensity, expertiseDepth, structure.',
  'Use available tools to analyze assets and propose knob settings. Respect client policy; never invent assets.',
  'If you return a final answer yourself, output only JSON per the expected schema.'
].join('\n')

export function createStrategyAgent(
  runtime: AgentRuntime,
  onEvent?: (e: { type: 'tool_call' | 'tool_result' | 'metrics'; name?: string; args?: any; result?: any; tokens?: number; durationMs?: number }) => void,
  opts?: { policy?: 'auto' | 'required' | 'off'; requestAllowlist?: string[] }
) {
  const tools = runtime.getAgentTools({ allowlist: [...STRATEGY_TOOLS], policy: opts?.policy, requestAllowlist: opts?.requestAllowlist }, onEvent) as any
  return new OAAgent({ name: 'Strategy Manager', instructions: STRATEGY_INSTRUCTIONS, tools })
}
