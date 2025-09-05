globalThis.__timing__.logStart('Load chunks/routes/api/v1/agent/run.stream.post');import { d as defineEventHandler, r as readBody, g as getHeader, a as setHeader, c as createError } from '../../../../nitro/nitro.mjs';
import { i as isBacklogFull, b as backlogSnapshot, c as createSse, s as sseSemaphore, w as withSseConcurrency } from '../../../../_/concurrency.mjs';
import { A as AgentRunRequestSchema } from '../../../../_/agent-run.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';
import '../../../../_/logger.mjs';
import 'winston';
import 'zod';

const run_stream_post = defineEventHandler(async (event) => {
  var _a, _b, _c;
  const body = (_b = (_a = event.context) == null ? void 0 : _a.body) != null ? _b : await readBody(event);
  const req = AgentRunRequestSchema.parse(body);
  const rawOptions = typeof body === "object" && body && "options" in body ? body.options : void 0;
  const finalReq = { ...req, options: { ...rawOptions || {}, ...req.options || {} } };
  try {
    const origin = getHeader(event, "origin") || "*";
    setHeader(event, "Vary", "Origin");
    setHeader(event, "Access-Control-Allow-Origin", origin);
    setHeader(event, "Access-Control-Allow-Headers", "content-type,authorization,x-correlation-id");
    setHeader(event, "Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  } catch {
  }
  if (req.mode === "chat") {
    const enabled = process.env.ENABLE_CHAT_SANDBOX === "true" || false;
    if (!enabled) {
      throw createError({ statusCode: 403, statusMessage: "Chat sandbox disabled" });
    }
  }
  const cid = getHeader(event, "x-correlation-id") || ((_c = event.context) == null ? void 0 : _c.correlationId) || void 0;
  if (isBacklogFull()) {
    const snap = backlogSnapshot();
    try {
      const { getLogger } = await import('../../../../_/logger.mjs');
      getLogger().warn("sse_backlog_reject", { ...snap, correlationId: cid });
    } catch {
    }
    setHeader(event, "Retry-After", 2);
    setHeader(event, "Cache-Control", "no-store");
    setHeader(event, "X-Backlog-Pending", String(snap.pending));
    setHeader(event, "X-Backlog-Limit", String(snap.limit));
    throw createError({ statusCode: 503, statusMessage: "Server busy. Please retry." });
  }
  const sse = createSse(event, { correlationId: cid, heartbeatMs: 15e3 });
  try {
    if (sseSemaphore.pending > 0 || sseSemaphore.used > 0) {
      try {
        const { getLogger } = await import('../../../../_/logger.mjs');
        getLogger().info("sse_queue", { used: sseSemaphore.used, pending: sseSemaphore.pending, correlationId: cid });
      } catch {
      }
    }
    await withSseConcurrency(async () => {
      var _a2;
      const injected = (_a2 = event.context) == null ? void 0 : _a2.orch;
      const orch = injected || (await import('../../../../_/orchestrator-agent.mjs')).getOrchestrator();
      await orch.run(finalReq, (e) => sse.send(e), cid);
    });
  } catch (error) {
    const message = (error == null ? void 0 : error.statusMessage) || (error == null ? void 0 : error.message) || "Unknown error";
    await sse.send({ type: "error", message });
  } finally {
    sse.close();
  }
});

export { run_stream_post as default };;globalThis.__timing__.logEnd('Load chunks/routes/api/v1/agent/run.stream.post');
//# sourceMappingURL=run.stream.post.mjs.map
