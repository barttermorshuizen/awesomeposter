globalThis.__timing__.logStart('Load chunks/routes/api/v1/agent/smoke.get');import { d as defineEventHandler, b as getQuery } from '../../../../nitro/nitro.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';

const smoke_get = defineEventHandler(async (event) => {
  const objective = getQuery(event).objective || "Increase brand awareness for a new product launch.";
  const req = {
    mode: "app",
    objective,
    // No briefId/state -> avoids DB dependency for quick sanity checks
    options: { trace: false }
  };
  const events = [];
  const { getOrchestrator } = await import('../../../../_/orchestrator-agent.mjs');
  const orch = getOrchestrator();
  const result = await orch.run(req, (e) => events.push(e));
  return {
    ok: true,
    objective,
    eventsCount: events.length,
    result
  };
});

export { smoke_get as default };;globalThis.__timing__.logEnd('Load chunks/routes/api/v1/agent/smoke.get');
//# sourceMappingURL=smoke.get.mjs.map
