import { AgentRuntime } from '../services/agent-runtime'
import { Agent as OAAgent } from '@openai/agents'
import { HITL_TOOL_NAME } from '../tools/hitl'
import { getFacetCatalog, type CapabilityRegistration } from '@awesomeposter/shared'
import { DEFAULT_MODEL_FALLBACK } from '../utils/model'

export class QualityAssuranceAgent {
  constructor(private runtime: AgentRuntime) {}
}

export const QA_CAPABILITY_ID = `${QualityAssuranceAgent.name}.contentReview` as const

const qaFacetCatalog = getFacetCatalog()
const QA_INPUT_FACETS = ['copyVariants', 'writerBrief', 'qaRubric'] as const
const QA_OUTPUT_FACETS = ['qaFindings', 'recommendationSet'] as const
qaFacetCatalog.resolveMany([...QA_INPUT_FACETS], 'input')
qaFacetCatalog.resolveMany([...QA_OUTPUT_FACETS], 'output')

export const QA_CAPABILITY = {
  capabilityId: QA_CAPABILITY_ID,
  agentType: 'ai',
  version: '1.0.0',
  displayName: 'Quality Assurance',
  summary: 'Scores generated drafts for readability, clarity, objective fit, and policy risk, returning structured QA signals.',
  inputTraits: {
    languages: ['en'],
    strengths: ['qa_scoring', 'policy_compliance'],
    limitations: ['Requires prior content draft to review.']
  },
  inputContract: {
    mode: 'facets',
    facets: [...QA_INPUT_FACETS]
  },
  outputContract: {
    mode: 'facets',
    facets: [...QA_OUTPUT_FACETS]
  },
  cost: {
    tier: 'standard',
    estimatedTokens: 900,
    currency: 'USD',
    pricePer1kTokens: 0.012
  },
  preferredModels: [DEFAULT_MODEL_FALLBACK],
  heartbeat: {
    intervalSeconds: 600,
    timeoutSeconds: 1800
  },
  metadata: {
    sourceFiles: [
      'packages/flex-agents-server/src/agents/quality-assurance.ts',
      'packages/flex-agents-server/src/tools/qa.ts'
    ],
    runMode: 'agent',
    scenarios: ['qa_review']
  }
} as CapabilityRegistration

export const QA_TOOLS = [
  'qa_evaluate_content',
  HITL_TOOL_NAME
] as const

const HITL_ENABLED = process.env.ENABLE_HITL === 'true'

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
        'If you cannot pass/fail without a human decision (policy conflict, missing approval, unclear legal risk), call the `hitl_request` tool with the specific question. Only include options when you can list realistic operator choices; otherwise rely on freeform.',
        'When invoking `hitl_request`, explicitly set the `question` field to the human decision you need and add contextual notes. Options are reserved for concrete answer choices.',
        'When `payload.humanGuidance` or `payload.hitlResponses` exists, treat those operator answers as authoritative overrides—apply them to your evaluation and avoid re-escalating the same issue unless new contradictions appear.'
      ]
    : []
).join('\n')

export function createQaAgent(
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
  opts?: { policy?: 'auto' | 'required' | 'off'; requestAllowlist?: string[] }
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Agents SDK returns untyped tool map; casting for OpenAI agent constructor
  const tools = runtime.getAgentTools({ allowlist: [...QA_TOOLS], policy: opts?.policy, requestAllowlist: opts?.requestAllowlist }, onEvent) as any
  return new OAAgent({ name: 'Quality Assurance', instructions: QA_INSTRUCTIONS, tools })
}
