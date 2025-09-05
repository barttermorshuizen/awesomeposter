import { AgentRunRequestSchema } from '@awesomeposter/shared'
import { createSse } from '../../../../src/utils/sse'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const req = AgentRunRequestSchema.parse(body)

  if (req.mode === 'chat') {
    const enabled = process.env.ENABLE_CHAT_SANDBOX === 'true' || process.env.NODE_ENV !== 'production'
    if (!enabled) {
      throw createError({ statusCode: 403, statusMessage: 'Chat sandbox disabled' })
    }
  }

  const cid = getHeader(event, 'x-correlation-id') || (event as any).context?.correlationId || undefined
  const sse = createSse(event, { correlationId: cid, heartbeatMs: 15000 })

  try {
    const { getOrchestrator } = await import('../../../../src/services/orchestrator-agent')
    const orch = getOrchestrator()
    await orch.run(req, (e) => sse.send(e), cid)
    // Orchestrator emits 'complete'; do not duplicate here
  } catch (error: any) {
    const message = error?.statusMessage || error?.message || 'Unknown error'
    await sse.send({ type: 'error', message })
  } finally {
    sse.close()
  }
})
