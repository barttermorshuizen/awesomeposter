import { AgentRuntime } from '../services/agent-runtime'
import { Agent as OAAgent } from '@openai/agents'
import { HITL_TOOL_NAME } from '../tools/hitl'

const HITL_ENABLED = process.env.ENABLE_HITL === 'true'

export class QualityAssuranceAgent {
  constructor(private runtime: AgentRuntime) {}
}

// Agents SDK configuration for the QA specialist
export const QA_TOOLS = [
  'qa_evaluate_content',
  HITL_TOOL_NAME
] as const

export const QA_INSTRUCTIONS = [
  'You are the Quality Assurance agent.',
  'Evaluate drafts for readability, clarity, objective fit, brand risk, and compliance.',
  'Return one JSON object only (no markdown/code fences).',
  'Schema (QAReport): { composite?: number(0..1), compliance?: boolean, readability?: number(0..1), clarity?: number(0..1), objectiveFit?: number(0..1), brandRisk?: number(0..1), contentRecommendations?: string[] }',
  'Normalization: If your analysis or tools produce fields named "suggestedChanges" or "Suggestions", map them to a unified field named "contentRecommendations" as an array of short strings.',
  'Mapping guidance: for object suggestions, extract the most helpful text (prefer a "suggestion" field; else use "text"). Keep each recommendation concise.',
].concat(
  HITL_ENABLED
    ? [
        'If you cannot pass/fail without a human decision (policy conflict, missing approval, unclear legal risk), call the `hitl_request` tool with the specific question and any relevant options so an operator can decide.',
        'When invoking `hitl_request`, explicitly set the `question` field to the human decision you need and supply any options or contextual notes.',
        'When `payload.humanGuidance` or `payload.hitlResponses` exists, treat those operator answers as authoritative overrides—apply them to your evaluation and avoid re-escalating the same issue unless new contradictions appear.'
      ]
    : []
).join('\n')
;

export function createQaAgent(
  runtime: AgentRuntime,
  onEvent?: (e: { type: 'tool_call' | 'tool_result' | 'metrics'; name?: string; args?: any; result?: any; tokens?: number; durationMs?: number }) => void,
  opts?: { policy?: 'auto' | 'required' | 'off'; requestAllowlist?: string[] }
) {
  const tools = runtime.getAgentTools({ allowlist: [...QA_TOOLS], policy: opts?.policy, requestAllowlist: opts?.requestAllowlist }, onEvent) as any
  return new OAAgent({ name: 'Quality Assurance', instructions: QA_INSTRUCTIONS, tools })
}
