import { TaskEnvelopeSchema, type JsonLogicExpression } from '@awesomeposter/shared'
import { createSse } from '../../../../src/utils/sse'
import { withSseConcurrency, sseSemaphore, isBacklogFull, backlogSnapshot } from '../../../../src/utils/concurrency'
import { getHeader, setHeader, getMethod, sendNoContent, createError, readBody } from 'h3'
import { FlexRunCoordinator } from '../../../../src/services/flex-run-coordinator'
import { genCorrelationId, getLogger } from '../../../../src/services/logger'
import { validateConditionInput } from '../../../../src/utils/condition-dsl'

export default defineEventHandler(async (event) => {
  const method = getMethod(event)

  if (method === 'OPTIONS') {
    const origin = getHeader(event, 'origin')
    if (origin) {
      setHeader(event, 'Vary', 'Origin')
      setHeader(event, 'Access-Control-Allow-Origin', origin)
    }
    setHeader(event, 'Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    setHeader(event, 'Access-Control-Allow-Headers', getHeader(event, 'access-control-request-headers') || 'content-type,accept,authorization,x-correlation-id')
    setHeader(event, 'Access-Control-Max-Age', 600)
    return sendNoContent(event, 204)
  }

  const origin = getHeader(event, 'origin')
  if (origin) {
    setHeader(event, 'Vary', 'Origin')
    setHeader(event, 'Access-Control-Allow-Origin', origin)
    setHeader(event, 'Access-Control-Allow-Credentials', 'true')
  }
  setHeader(event, 'Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  setHeader(event, 'Access-Control-Allow-Headers', 'content-type,accept,authorization,x-correlation-id')
  setHeader(event, 'Access-Control-Expose-Headers', 'content-type,x-correlation-id')

  if (isBacklogFull()) {
    const snap = backlogSnapshot()
    try {
      getLogger().warn('flex_run_backlog_reject', snap)
    } catch {}
    setHeader(event, 'Retry-After', 2)
    setHeader(event, 'Cache-Control', 'no-store')
    setHeader(event, 'X-Backlog-Pending', String(snap.pending))
    setHeader(event, 'X-Backlog-Limit', String(snap.limit))
    throw createError({ statusCode: 503, statusMessage: 'Server busy. Please retry.' })
  }

  const body = (event as any).context?.body ?? (await readBody(event))
  const envelope = TaskEnvelopeSchema.parse(body)

  if (envelope.policies?.runtime) {
    for (const policy of envelope.policies.runtime) {
      const trigger = policy.trigger
      if (!trigger) continue
      if (trigger.kind !== 'onNodeComplete' && trigger.kind !== 'onValidationFail') continue

      const rawCondition = (trigger as any).condition
      if (rawCondition === undefined || rawCondition === null) continue

      const hasDsl = typeof rawCondition === 'object' && rawCondition !== null && typeof rawCondition.dsl === 'string'
      const trimmedDsl = hasDsl ? String(rawCondition.dsl).trim() : undefined
      const jsonLogicCandidate: JsonLogicExpression | undefined = hasDsl
        ? (rawCondition.jsonLogic as JsonLogicExpression | undefined)
        : (rawCondition as JsonLogicExpression)

      const validation = validateConditionInput({
        dsl: trimmedDsl,
        jsonLogic: jsonLogicCandidate,
      })

      const canonicalCondition: Record<string, unknown> = {
        jsonLogic: validation.jsonLogic,
      }

      if (trimmedDsl) {
        canonicalCondition.dsl = trimmedDsl
        canonicalCondition.canonicalDsl = validation.canonicalDsl ?? trimmedDsl
      } else if (validation.canonicalDsl) {
        canonicalCondition.canonicalDsl = validation.canonicalDsl
      }

      if (validation.warnings.length > 0) {
        canonicalCondition.warnings = validation.warnings
      }
      if (validation.variables.length > 0) {
        canonicalCondition.variables = validation.variables
      }

      ;(policy as any).trigger = {
        ...policy.trigger,
        condition: canonicalCondition,
      }
    }
  }

  const correlationId = getHeader(event, 'x-correlation-id') || genCorrelationId()
  setHeader(event, 'x-correlation-id', correlationId)

  try {
    getLogger().info('flex_run_start', {
      correlationId,
      objective: envelope.objective?.slice(0, 120) ?? null
    })
  } catch {}

  const sse = createSse(event, { correlationId })

  try {
    if (sseSemaphore.pending > 0 || sseSemaphore.used > 0) {
      try {
        getLogger().info('flex_sse_queue', { used: sseSemaphore.used, pending: sseSemaphore.pending, correlationId })
      } catch {}
    }

    await withSseConcurrency(async () => {
      const coordinator = new FlexRunCoordinator()
      await coordinator.run(envelope, {
        correlationId,
        onEvent: async (frame) => {
          await sse.send(frame)
        }
      })
    })
  } catch (error: any) {
    const message = error?.statusMessage || error?.message || 'Unknown error'
    await sse.send({ type: 'log', message })
  } finally {
    sse.close()
  }
})
