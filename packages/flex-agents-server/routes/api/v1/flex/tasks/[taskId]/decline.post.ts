import { z } from 'zod'
import {
  getMethod,
  getHeader,
  setHeader,
  readBody,
  createError
} from 'h3'
import type { TaskEnvelope } from '@awesomeposter/shared'
import { FlexRunPersistence } from '../../../../../../src/services/orchestrator-persistence'
import { getTelemetryService } from '../../../../../../src/services/telemetry-service'
import { genCorrelationId, getLogger } from '../../../../../../src/services/logger'
import { FlexRunCoordinator } from '../../../../../../src/services/flex-run-coordinator'

const DeclinePayloadSchema = z.object({
  reason: z.string().trim().min(1, 'Decline reason is required.'),
  note: z.string().trim().optional().nullable(),
  operator: z
    .object({
      id: z.string().trim().min(1).optional(),
      displayName: z.string().trim().min(1).optional(),
      email: z.string().trim().min(1).optional()
    })
    .optional()
})

type DeclinePayload = z.infer<typeof DeclinePayloadSchema>

const trimOrNull = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

const sanitizeOperator = (value?: DeclinePayload['operator']) => {
  if (!value || typeof value !== 'object') return null
  const candidate = {
    id: trimOrNull(value.id ?? null),
    displayName: trimOrNull(value.displayName ?? null),
    email: trimOrNull(value.email ?? null)
  }
  if (!candidate.id && !candidate.displayName && !candidate.email) {
    return null
  }
  return candidate
}

function buildResumeEnvelope(
  record: TaskEnvelope,
  runId: string,
  threadId: string | null,
  auditMetadata: Record<string, unknown>
) {
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

  const metadata: Record<string, unknown> = {
    ...(envelope.metadata ?? {}),
    runId,
    resume: true,
    ...auditMetadata
  }
  if (threadId) {
    metadata.threadId = metadata.threadId ?? threadId
  }
  envelope.metadata = metadata as TaskEnvelope['metadata']
  return envelope
}

export default defineEventHandler(async (event) => {
  const method = getMethod(event)
  if (method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
  }

  const origin = getHeader(event, 'origin')
  if (origin) {
    setHeader(event, 'Vary', 'Origin')
    setHeader(event, 'Access-Control-Allow-Origin', origin)
    setHeader(event, 'Access-Control-Allow-Credentials', 'true')
  }
  const requestedHeaders = getHeader(event, 'access-control-request-headers')
  setHeader(event, 'Access-Control-Allow-Methods', 'POST,OPTIONS')
  setHeader(
    event,
    'Access-Control-Allow-Headers',
    requestedHeaders || 'content-type,accept,authorization,x-correlation-id'
  )
  setHeader(event, 'Access-Control-Expose-Headers', 'content-type,x-correlation-id')
  setHeader(event, 'Cache-Control', 'no-store')

  const taskIdParam = event.context.params?.taskId
  if (typeof taskIdParam !== 'string' || !taskIdParam.length) {
    throw createError({ statusCode: 400, statusMessage: 'Task ID required', data: { code: 'task_id_required' } })
  }
  const taskId = decodeURIComponent(taskIdParam)

  const headerCorrelation = trimOrNull(getHeader(event, 'x-correlation-id') ?? null)
  const correlationId = headerCorrelation || genCorrelationId()
  setHeader(event, 'x-correlation-id', correlationId)

  const rawBody = (event as any).context?.body ?? (await readBody(event))
  const payload = DeclinePayloadSchema.parse(rawBody)
  const reason = payload.reason.trim()
  const note = trimOrNull(payload.note ?? null)
  const operator = sanitizeOperator(payload.operator)

  const persistence = new FlexRunPersistence()
  const tasks = await persistence.listPendingHumanTasks()
  const task = tasks.find((entry) => entry.taskId === taskId)
  if (!task) {
    throw createError({ statusCode: 404, statusMessage: 'Task not found', data: { code: 'task_not_found' } })
  }

  const record = await persistence.loadFlexRun(task.runId)
  if (!record) {
    throw createError({ statusCode: 404, statusMessage: 'Run not found', data: { code: 'run_not_found' } })
  }

  if (record.run.status !== 'awaiting_human') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Run is not awaiting human input',
      data: { code: 'invalid_run_state', status: record.run.status }
    })
  }

  const node = record.nodes.find((entry) => entry.nodeId === task.nodeId)
  if (!node) {
    throw createError({ statusCode: 404, statusMessage: 'Task node not found', data: { code: 'node_not_found' } })
  }

  if (node.status !== 'awaiting_human') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Task is not awaiting submission',
      data: { code: 'invalid_task_state', status: node.status }
    })
  }

  const nowIso = new Date().toISOString()
  await persistence.recordResumeAudit(record.run, {
    operator,
    note
  })

  const auditMetadata: Record<string, unknown> = {}
  if (operator) {
    auditMetadata.resumeOperator = operator
  }
  if (note) {
    auditMetadata.resumeNote = note
  }

  const envelope = buildResumeEnvelope(record.run.envelope, record.run.runId, record.run.threadId ?? null, auditMetadata)

  const telemetry = getTelemetryService()
  const coordinator = new FlexRunCoordinator(persistence)
  const emitEvent = telemetry.createRunEmitter(
    { runId: record.run.runId, correlationId },
    async () => Promise.resolve()
  )

  const result = await coordinator.run(envelope, {
    correlationId,
    onEvent: emitEvent,
    resumeSubmission: {
      nodeId: task.nodeId,
      decline: {
        reason,
        note
      },
      submittedAt: nowIso,
      note
    }
  })

  try {
    getLogger().info('flex_task_declined', {
      runId: task.runId,
      nodeId: task.nodeId,
      taskId,
      reason,
      correlationId,
      action: 'decline'
    })
  } catch {}

  return {
    ok: true,
    status: result.status,
    runId: result.runId,
    nodeId: task.nodeId
  }
})
