import { z } from 'zod'
import { AgentRuntime } from '../services/agent-runtime'
import { HitlRequestKindEnum, HitlOptionSchema, HitlUrgencyEnum } from '@awesomeposter/shared'
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

function normalizeOptions(raw: unknown): Array<{ id: string; label: string; description?: string }> | undefined {
  if (!Array.isArray(raw)) return undefined
  const items: Array<{ id: string; label: string; description?: string }> = []
  raw.forEach((entry, idx) => {
    if (typeof entry === 'string') {
      const label = entry.trim()
      if (!label) return
      items.push({ id: `opt_${idx + 1}`, label })
      return
    }
    if (entry && typeof entry === 'object') {
      const obj = entry as MutableRecord
      const label = coerceString(obj.label) || coerceString(obj.title) || coerceString(obj.value)
      if (!label) return
      const id = coerceString(obj.id) || `opt_${idx + 1}`
      const description = coerceString(obj.description) || coerceString(obj.detail)
      items.push({ id, label, description })
    }
  })
  return items.length ? items : undefined
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

  const normalizedOptions = normalizeOptions(input.options ?? input.choices)
  if (normalizedOptions) {
    input.options = normalizedOptions
  }

  // Determine question fallback if still missing.
  let question = coerceString(input.question)
  if (!question) {
    question = coerceString(input.additionalContext)
  }
  if (!question && normalizedOptions && normalizedOptions.length) {
    question = 'Please select the best option to proceed.'
  }
  if (!question) {
    question = DEFAULT_FALLBACK_QUESTION
    fallbackReason = 'fallback_question'
  } else if (!coerceString((raw as MutableRecord).question)) {
    fallbackReason = 'normalized_question'
  }
  input.question = question

  // Infer kind when options provided but kind missing.
  if (!input.kind && normalizedOptions && normalizedOptions.length) {
    input.kind = 'choice'
  }

  if (fallbackReason) {
    try {
      getLogger().warn('hitl_request_autofix', {
        reason: fallbackReason,
        providedKeys: Object.keys(raw as Record<string, unknown>),
        hasOptions: Boolean(normalizedOptions && normalizedOptions.length)
      })
    } catch {}
  }

  return input
}

export const HITL_TOOL_NAME = 'hitl_request'

const HitlOptionForTool = HitlOptionSchema.extend({
  description: z.string().nullable().default(null)
})

const HitlToolInputSchema = z.object({
  question: z.string().min(1, 'question is required'),
  kind: HitlRequestKindEnum.default('question'),
  options: z.array(HitlOptionForTool).default([]),
  allowFreeForm: z.boolean().default(true),
  urgency: HitlUrgencyEnum.default('normal'),
  additionalContext: z.string().nullable().optional()
})

export function registerHitlTools(runtime: AgentRuntime) {
  const service = getHitlService()
  runtime.registerTool({
    name: HITL_TOOL_NAME,
    description: 'Request human-in-the-loop input (question, approval, or choice).',
    parameters: HitlToolInputSchema,
    handler: async (raw: unknown) => {
      const normalized = HitlToolInputSchema.parse(normalizeHitlPayload(raw))
      const question = normalized.question.trim()
      if (!question || question === DEFAULT_FALLBACK_QUESTION) {
        throw new Error('hitl_request requires a non-empty `question` describing what the operator must decide.')
      }
      const payloadForService = {
        ...normalized,
        options: normalized.options.map((opt) => ({
          ...opt,
          description: opt.description ?? undefined
        }))
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
