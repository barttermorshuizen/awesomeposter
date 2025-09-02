export default defineEventHandler(async () => {
  const now = new Date().toISOString()
  const uptime = process.uptime()

  // DB health (non-fatal)
  let dbOk = false
  try {
    const { AgentsDatabaseService } = await import('../../../src/services/database')
    dbOk = await new AgentsDatabaseService().healthCheck()
  } catch {
    dbOk = false
  }

  // OpenAI configured?
  const openaiConfigured = Boolean(process.env.OPENAI_API_KEY)

  const status = dbOk ? 'healthy' : 'degraded'

  try {
    const { getLogger } = await import('../../../src/services/logger')
    const log = getLogger()
    log.info('health_probe', { status, dbOk, openaiConfigured })
  } catch {}

  return {
    status,
    timestamp: now,
    uptimeSeconds: Math.round(uptime),
    services: {
      database: { ok: dbOk },
      openai: { configured: openaiConfigured }
    },
    env: {
      nodeEnv: process.env.NODE_ENV || 'development'
    }
  }
})
