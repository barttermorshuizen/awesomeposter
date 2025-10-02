import { requireApiAuth } from '../../utils/api-auth'
import { getOrchestratorPersistence } from '../../../packages/agents-server/src/services/orchestrator-persistence'

export default defineEventHandler(async (event) => {
  try {
    requireApiAuth(event)
    const persistence = getOrchestratorPersistence()
    const runs = await persistence.listAwaitingHitl()
    return {
      ok: true,
      runs
    }
  } catch (err: unknown) {
    try {
      console.error('[api/hitl/pending] error:', err)
    } catch {}
    const msg = err instanceof Error ? err.message : String(err)
    if (
      msg.includes('DATABASE_URL') ||
      /ECONNREFUSED|ENOTFOUND|timeout|no pg_hba|refused/i.test(msg)
    ) {
      return { ok: true, runs: [] }
    }
    if (process.env.NODE_ENV !== 'production') {
      return { ok: true, runs: [] }
    }
    throw err
  }
})
