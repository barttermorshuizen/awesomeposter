globalThis.__timing__.logStart('Load chunks/routes/api/v1/agent/agents.get');import { d as defineEventHandler, g as getHeader, a as setHeader } from '../../../../nitro/nitro.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';

const agents_get = defineEventHandler((event) => {
  const origin = getHeader(event, "origin") || "*";
  setHeader(event, "Vary", "Origin");
  setHeader(event, "Access-Control-Allow-Origin", origin);
  return {
    agents: [
      { id: "orchestrator", label: "Orchestrator", supports: ["app", "chat"] },
      { id: "strategy", label: "Strategy Manager", supports: ["chat"] },
      { id: "generator", label: "Content Generator", supports: ["chat"] },
      { id: "qa", label: "Quality Assurance", supports: ["chat"] }
    ]
  };
});

export { agents_get as default };;globalThis.__timing__.logEnd('Load chunks/routes/api/v1/agent/agents.get');
//# sourceMappingURL=agents.get.mjs.map
