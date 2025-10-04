import { d as defineEventHandler } from '../../../nitro/nitro.mjs';
import discoverySseHandler from '../events/discovery.get.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';
import 'zod';
import '../../../_/api-auth.mjs';
import '../../../_/feature-flags.mjs';
import '@upstash/redis';
import '../../../_/index.mjs';
import 'drizzle-orm/node-postgres';
import 'pg';
import 'drizzle-orm/pg-core';
import 'drizzle-orm';
import '../../../_/discovery-events.mjs';
import '../../../_/discovery.mjs';

const events_stream = defineEventHandler(async (event) => {
  console.warn("[discovery] /api/discovery/events.stream is deprecated, use /api/events/discovery instead.");
  return discoverySseHandler(event);
});

export { events_stream as default };
//# sourceMappingURL=events.stream.mjs.map
