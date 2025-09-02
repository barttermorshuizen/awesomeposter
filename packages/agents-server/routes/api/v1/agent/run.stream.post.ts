import { AgentRunRequestSchema } from '@awesomeposter/shared'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const req = AgentRunRequestSchema.parse(body)

  if (req.mode === 'chat') {
    const enabled = process.env.ENABLE_CHAT_SANDBOX === 'true' || process.env.NODE_ENV !== 'production'
    if (!enabled) {
      throw createError({ statusCode: 403, statusMessage: 'Chat sandbox disabled' })
    }
  }

  setHeader(event, 'Content-Type', 'text/event-stream')
  setHeader(event, 'Cache-Control', 'no-cache')
  setHeader(event, 'Connection', 'keep-alive')
  const cid = getHeader(event, 'x-correlation-id') || (event as any).context?.correlationId || undefined

  const write = (data: any) => {
    // @ts-ignore
    event.node.res.write(`data: ${JSON.stringify({ correlationId: cid, ...data })}\n\n`)
  }

  try {
    const { getOrchestrator } = await import('../../../../src/services/orchestrator-agent')
    const orch = getOrchestrator()
    const result = await orch.run(req, (e) => write(e), cid)
    write({ type: 'complete', result })
  } catch (error: any) {
    write({ type: 'error', error: error?.message || 'Unknown error' })
  } finally {
    // @ts-ignore
    event.node.res.end()
  }
})
