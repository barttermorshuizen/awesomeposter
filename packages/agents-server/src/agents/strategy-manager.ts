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
  'Plan using the 4‑knob system: formatType, hookIntensity, expertiseDepth, structure.',
  'Tool‑first: call io_get_brief, io_get_client_profile, io_list_assets, strategy_analyze_assets. Never invent assets or client data.',
  'Choose an achievable formatType based on available assets; if the brief requests an unachievable format, select the best achievable alternative and explain the tradeoff.',
  'Produce a concise writer brief: goal, audience insight, selected angle, 2–3 hook options, CTA, and final 4‑knob settings.',
  'Do NOT generate post drafts. Your deliverable is the writer brief and knob settings only.',
  'Align language, tone/voice, hashtags, and cultural context with the client profile and guardrails.',
  'When asked for a final result in workflow/app mode, produce strict JSON the caller expects (no code fences).'
].join('\n')

// Chat instructions – respond in plain language, not JSON
export const STRATEGY_INSTRUCTIONS_CHAT = [
  'You are the Strategy Manager agent speaking directly with a user.',
  'Respond conversationally with plain‑text, actionable recommendations.',
  'If critical info is missing, ask at most one clarifying question before proposing a safe default.',
  'Reflect client language, tone/voice, and guardrails when known. Do NOT return JSON or code fences.'
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
