import { d as defineEventHandler, g as getHeader, a as setHeader } from '../../../../nitro/nitro.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';

const run_stream_options = defineEventHandler((event) => {
  const origin = getHeader(event, "origin") || "*";
  setHeader(event, "Vary", "Origin");
  setHeader(event, "Access-Control-Allow-Origin", origin);
  setHeader(event, "Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  setHeader(event, "Access-Control-Allow-Headers", "content-type,authorization,x-correlation-id");
  event.node.res.statusCode = 204;
  try {
    event.node.res.end();
  } catch {
  }
});

export { run_stream_options as default };
//# sourceMappingURL=run.stream.options.mjs.map
