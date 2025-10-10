export default defineEventHandler(async () => {
  try {
    const { AgentsDatabaseService } = await import('../../../../src/services/database')
    const ok = await new AgentsDatabaseService().healthCheck()
    return { ok, driver: 'pg', timestamp: new Date().toISOString() }
  } catch (err: any) {
    return { ok: false, driver: 'pg', error: err?.message || 'Unknown DB error', timestamp: new Date().toISOString() }
  }
})
