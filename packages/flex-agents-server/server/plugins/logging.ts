import { getLogger, genCorrelationId } from '../../src/services/logger'

export default defineNitroPlugin((nitro) => {
  const log = getLogger()

  nitro.hooks.hook('request', (event: any) => {
    const method = event.node.req.method || 'GET'
    const path = event.path || event.node.req.url || ''
    const incomingCid = getHeader(event, 'x-correlation-id') || getHeader(event, 'x-request-id')
    const cid = incomingCid || genCorrelationId()
    // attach for downstream usage
    try { (event.context as any).correlationId = cid } catch {}
    setHeader(event, 'x-correlation-id', cid)

    const start = Date.now()
    const ip = (getHeader(event, 'x-forwarded-for') || '').split(',')[0] || event.node.req.socket?.remoteAddress
    log.info('request_received', { cid, method, path, ip })

    event.node.res.on('finish', () => {
      const durationMs = Date.now() - start
      const statusCode = event.node.res.statusCode
      log.info('request_completed', { cid, method, path, statusCode, durationMs })
    })
  })
})

