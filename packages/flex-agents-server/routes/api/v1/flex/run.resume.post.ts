import { z } from 'zod'
import type { TaskEnvelope } from '@awesomeposter/shared'
import { getMethod, getHeader, setHeader, readBody, createError } from 'h3'
import { createSse } from '../../../../src/utils/sse'
import {
  withSseConcurrency,
  sseSemaphore,
  isBacklogFull,
  backlogSnapshot
} from '../../../../src/utils/concurrency'
import { FlexRunCoordinator } from '../../../../src/services/flex-run-coordinator'
import { FlexRunPersistence } from '../../../../src/services/orchestrator-persistence'
import { genCorrelationId, getLogger } from '../../../../src/services/logger'

const ResumeSubmissionSchema = z
  .object({
    nodeId: z.string().min(1),
    output: z.record(z.string(), z.unknown()).optional(),
    decline: z
      .object({
        reason: z.string().min(1),
        note: z.string().optional().nullable()
      })
      .optional(),
    submittedAt: z.string().optional(),
    note: z.string().optional()
  })
  .refine((value) => {
    const outputPresent = Boolean(value.output)
    const declinePresent = Boolean(value.decline)
    return outputPresent !== declinePresent || (outputPresent && !declinePresent)
  }, 'Provide either an output payload or a decline reason.')

const ResumeRequestSchema = z.object({
  runId: z.string().min(1),
  expectedPlanVersion: z.number().int().nonnegative().optional(),
  operator: z
    .object({
      id: z.string().optional(),
      displayName: z.string().optional(),
      email: z.string().optional()
    })
    .optional(),
  note: z.string().optional(),
  correlationId: z.string().optional(),
  payload: ResumeSubmissionSchema.optional()
})

function buildResumeEnvelope(record: TaskEnvelope, runId: string, threadId: string | null, auditMetadata: Record<string, unknown>) {
  const envelope: TaskEnvelope = JSON.parse(JSON.stringify(record))
  const constraints = {
    ...(envelope.constraints ?? {}),
    resumeRunId: runId
  } as Record<string, unknown>
  if (threadId) {
    constraints.threadId = threadId
    constraints.resumeThreadId = threadId
  }
  envelope.constraints = constraints

  const metadata = {
    ...(envelope.metadata ?? {}),
    runId,
    resume: true,
    ...auditMetadata
  }
  if (threadId) {
    metadata.threadId = metadata.threadId ?? threadId
  }
  envelope.metadata = metadata
  return envelope
}

export default defineEventHandler(async (event) => {
  const method = getMethod(event)

  if (method === 'OPTIONS') {
    // Handled by run.resume.options.ts
    return
  }

  const origin = getHeader(event, 'origin')
  if (origin) {
    setHeader(event, 'Vary', 'Origin')
    setHeader(event, 'Access-Control-Allow-Origin', origin)
    setHeader(event, 'Access-Control-Allow-Credentials', 'true')
  }
  const requested = getHeader(event, 'access-control-request-headers')
  setHeader(event, 'Access-Control-Allow-Methods', 'POST,OPTIONS')
  setHeader(event, 'Access-Control-Allow-Headers', requested || 'content-type,accept,authorization,x-correlation-id')
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
    throw createError({
      statusCode: 503,
      statusMessage: 'Server busy. Please retry.',
      data: { code: 'server_busy', pending: snap.pending, limit: snap.limit }
    })
  }

  const raw = (event as any).context?.body ?? (await readBody(event))
  const payload = ResumeRequestSchema.parse(raw)

  const persistence = new FlexRunPersistence()
  const record = await persistence.loadFlexRun(payload.runId)
  if (!record) {
    throw createError({ statusCode: 404, statusMessage: 'Run not found', data: { code: 'run_not_found' } })
  }

  if (record.run.status !== 'awaiting_hitl' && record.run.status !== 'awaiting_human') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Run is not awaiting operator input',
      data: { code: 'invalid_run_state', status: record.run.status }
    })
  }

  if (record.run.status === 'awaiting_human' && !payload.payload) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Human submission payload is required',
      data: { code: 'human_payload_required' }
    })
  }

  if (
    typeof payload.expectedPlanVersion === 'number' &&
    (record.run.planVersion ?? 0) !== payload.expectedPlanVersion
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Stale plan version provided',
      data: {
        code: 'stale_plan_version',
        expected: record.run.planVersion ?? 0,
        received: payload.expectedPlanVersion
      }
    })
  }

  const latestSnapshot = await persistence.loadPlanSnapshot(record.run.runId, record.run.planVersion)
  if (!latestSnapshot) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Latest plan snapshot missing',
      data: { code: 'missing_snapshot', planVersion: record.run.planVersion ?? 0 }
    })
  }

  await persistence.recordResumeAudit(record.run, {
    operator: payload.operator ?? null,
    note: payload.note ?? null
  })

  const auditMetadata: Record<string, unknown> = {}
  if (payload.operator) {
    auditMetadata.resumeOperator = payload.operator
  }
  if (payload.note) {
    auditMetadata.resumeNote = payload.note
  }

  const envelope = buildResumeEnvelope(record.run.envelope, record.run.runId, record.run.threadId ?? null, auditMetadata)

  const correlationId =
    payload.correlationId || getHeader(event, 'x-correlation-id') || genCorrelationId()
  setHeader(event, 'x-correlation-id', correlationId)

  try {
    getLogger().info('flex_run_resume_start', {
      runId: record.run.runId,
      planVersion: record.run.planVersion ?? 0,
      correlationId
    })
  } catch {}

  const sse = createSse(event, { correlationId })

  try {
    if (sseSemaphore.pending > 0 || sseSemaphore.used > 0) {
      try {
        getLogger().info('flex_sse_queue', {
          used: sseSemaphore.used,
          pending: sseSemaphore.pending,
          correlationId
        })
      } catch {}
    }

    await withSseConcurrency(async () => {
      const coordinator = new FlexRunCoordinator(persistence)
      await coordinator.run(envelope, {
        correlationId,
        onEvent: async (frame) => {
          await sse.send(frame)
        },
        resumeSubmission: payload.payload
          ? {
              nodeId: payload.payload.nodeId,
              output: payload.payload.output
                ? (payload.payload.output as Record<string, unknown>)
                : undefined,
              decline: payload.payload.decline
                ? {
                    reason: payload.payload.decline.reason,
                    note: payload.payload.decline.note ?? null
                  }
                : undefined,
              submittedAt: payload.payload.submittedAt,
              note: payload.payload.note ?? null
            }
          : undefined
      })
    })
  } catch (error: any) {
    const message = error?.statusMessage || error?.message || 'Unknown error'
    await sse.send({ type: 'log', message })
  } finally {
    sse.close()
  }
})
