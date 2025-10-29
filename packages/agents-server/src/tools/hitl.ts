import { z } from 'zod'
import { AgentRuntime } from '../services/agent-runtime'
import { HitlRequestKindEnum, HitlUrgencyEnum } from '@awesomeposter/shared'
import { getHitlService } from '../services/hitl-service'
import { getLogger } from '../services/logger'

export const DEFAULT_FALLBACK_QUESTION = 'Human assistance required to continue this orchestration step.'

type MutableRecord = Record<string, unknown>

function coerceString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  return undefined
}

function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true
    if (['false', '0', 'no', 'n'].includes(normalized)) return false
  }
  return undefined
}

function normalizeHitlPayload(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const input = { ...(raw as MutableRecord) }
  let fallbackReason: string | undefined

  // Accept alternate property names originating from LLM tool calls.
  if (input.prompt && !input.question) input.question = input.prompt
  if (input.message && !input.question) input.question = input.message
  if (input.query && !input.question) input.question = input.query
  if (!input.additionalContext && input.context) input.additionalContext = input.context

  input.kind = coerceString(input.kind)?.toLowerCase() === 'approval' ? 'approval' : 'clarify'

  const coercedAllowFreeForm = coerceBoolean(input.allowFreeForm)
  if (coercedAllowFreeForm !== undefined) {
    input.allowFreeForm = coercedAllowFreeForm
  }

  // Determine question fallback if still missing.
  let question = coerceString(input.question)
  if (!question) {
    question = coerceString(input.additionalContext)
  }
  if (!question) {
    question = DEFAULT_FALLBACK_QUESTION
    fallbackReason = 'fallback_question'
  } else if (!coerceString((raw as MutableRecord).question)) {
    fallbackReason = 'normalized_question'
  }
  input.question = question

  if (fallbackReason) {
    try {
      getLogger().warn('hitl_request_autofix', {
        reason: fallbackReason,
        providedKeys: Object.keys(raw as Record<string, unknown>),
        hasOptions: false
      })
    } catch {}
  }

  if (input.kind === 'clarify') {
    input.allowFreeForm = true
  } else if (typeof input.allowFreeForm !== 'boolean') {
    input.allowFreeForm = false
  }

  return input
}

export const HITL_TOOL_NAME = 'hitl_request'

const HitlToolInputSchema = z.object({
  question: z.string().min(1, 'question is required'),
  kind: HitlRequestKindEnum.default('clarify'),
  allowFreeForm: z.boolean().default(false),
  urgency: HitlUrgencyEnum.default('normal'),
  additionalContext: z.string().nullable().optional()
})

export function registerHitlTools(runtime: AgentRuntime) {
  const service = getHitlService()
  runtime.registerTool({
    name: HITL_TOOL_NAME,
    description: 'Request human-in-the-loop approval or clarification.',
    parameters: HitlToolInputSchema,
    handler: async (raw: unknown) => {
      const normalized = HitlToolInputSchema.parse(normalizeHitlPayload(raw))
      const question = normalized.question.trim()
      if (!question || question === DEFAULT_FALLBACK_QUESTION) {
        throw new Error('hitl_request requires a non-empty `question` describing what the operator must decide.')
      }
      const allowFreeForm =
        normalized.kind === 'clarify' ? true : normalized.allowFreeForm === true
      const payloadForService = {
        ...normalized,
        allowFreeForm,
        additionalContext: normalized.additionalContext ?? undefined
      }
      const result = await service.raiseRequest(payloadForService)
      if (result.status === 'denied') {
        return {
          status: 'denied',
          reason: result.reason,
          requestId: result.request.id
        }
      }
      return {
        status: 'pending',
        requestId: result.request.id,
        originAgent: result.request.originAgent,
        urgency: result.request.payload.urgency,
        kind: result.request.payload.kind
      }
    }
  })
}
