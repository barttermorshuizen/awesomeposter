export default defineEventHandler(async (event) => {
  // Minimal smoke test to validate Agents SDK orchestration works end-to-end
  const objective = (getQuery(event).objective as string) ||
    'Increase brand awareness for a new product launch.'

  const req = {
    mode: 'app' as const,
    objective,
    // No briefId/state -> avoids DB dependency for quick sanity checks
    options: { trace: false }
  }

  const events: any[] = []
  const { getOrchestrator } = await import('../../../../src/services/orchestrator-agent')
  const orch = getOrchestrator()
  const result = await orch.run(req as any, (e) => events.push(e))

  return {
    ok: true,
    objective,
    eventsCount: events.length,
    result
  }
})

