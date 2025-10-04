import { d as defineEventHandler } from '../../nitro/nitro.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';

const health_get = defineEventHandler(() => ({ ok: true, ts: Date.now() }));

export { health_get as default };
//# sourceMappingURL=health.get.mjs.map
