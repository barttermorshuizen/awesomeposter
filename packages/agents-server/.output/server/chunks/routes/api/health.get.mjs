import { d as defineEventHandler, s as sendRedirect } from '../../nitro/nitro.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';

const health_get = defineEventHandler((event) => {
  return sendRedirect(event, "/api/v1/health", 307);
});

export { health_get as default };
//# sourceMappingURL=health.get.mjs.map
