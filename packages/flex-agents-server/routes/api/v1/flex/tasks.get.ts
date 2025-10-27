import { getMethod, getHeader, setHeader, createError, getQuery } from 'h3'
import { FlexRunPersistence } from '../../../../src/services/orchestrator-persistence'

export default defineEventHandler(async (event) => {
  const method = getMethod(event)

  if (method !== 'GET') {
    throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
  }

  const origin = getHeader(event, 'origin')
  if (origin) {
    setHeader(event, 'Vary', 'Origin')
    setHeader(event, 'Access-Control-Allow-Origin', origin)
    setHeader(event, 'Access-Control-Allow-Credentials', 'true')
  }
  const requestedHeaders = getHeader(event, 'access-control-request-headers')
  setHeader(event, 'Access-Control-Allow-Methods', 'GET,OPTIONS')
  setHeader(
    event,
    'Access-Control-Allow-Headers',
    requestedHeaders || 'content-type,accept,authorization,x-correlation-id'
  )
  setHeader(event, 'Access-Control-Expose-Headers', 'content-type,x-correlation-id')
  setHeader(event, 'Cache-Control', 'no-store')

  const query = getQuery(event) as Record<string, unknown>
  const assignedTo = typeof query.assignedTo === 'string' && query.assignedTo.trim().length ? query.assignedTo.trim() : undefined
  const role = typeof query.role === 'string' && query.role.trim().length ? query.role.trim() : undefined
  const status = typeof query.status === 'string' && query.status.trim().length ? query.status.trim() : undefined

  const persistence = new FlexRunPersistence()
  const tasks = await persistence.listPendingHumanTasks({ assignedTo, role, status })

  return {
    ok: true,
    count: tasks.length,
    tasks
  }
})
