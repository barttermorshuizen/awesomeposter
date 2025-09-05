import { AgentRuntime } from '../services/agent-runtime'
import { Agent as OAAgent } from '@openai/agents'

export class QualityAssuranceAgent {
  constructor(private runtime: AgentRuntime) {}
}

// Agents SDK configuration for the QA specialist
export const QA_TOOLS = [
  'qa_evaluate_content'
] as const

export const QA_INSTRUCTIONS = [
  'You are the Quality Assurance agent.',
  'Evaluate drafts for readability, clarity, objective fit, brand risk, and compliance.',
  'Return structured scores and prioritized suggestions as JSON only.',
].join('\n')

export function createQaAgent(
  runtime: AgentRuntime,
  onEvent?: (e: { type: 'tool_call' | 'tool_result' | 'metrics'; name?: string; args?: any; result?: any; tokens?: number; durationMs?: number }) => void,
  opts?: { policy?: 'auto' | 'required' | 'off'; requestAllowlist?: string[] }
) {
  const tools = runtime.getAgentTools({ allowlist: [...QA_TOOLS], policy: opts?.policy, requestAllowlist: opts?.requestAllowlist }, onEvent) as any
  return new OAAgent({ name: 'Quality Assurance', instructions: QA_INSTRUCTIONS, tools })
}
