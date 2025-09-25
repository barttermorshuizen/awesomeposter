import { requireApiAuth } from '../../utils/api-auth'
import { getOrchestratorPersistence } from '../../../packages/agents-server/src/services/orchestrator-persistence'

export default defineEventHandler(async (event) => {
  requireApiAuth(event)
  const persistence = getOrchestratorPersistence()
  const runs = await persistence.listAwaitingHitl()
  return {
    ok: true,
    runs
  }
})
