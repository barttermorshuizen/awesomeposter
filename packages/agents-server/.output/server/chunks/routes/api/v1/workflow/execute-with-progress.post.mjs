globalThis.__timing__.logStart('Load chunks/routes/api/v1/workflow/execute-with-progress.post');import { d as defineEventHandler, r as readBody, g as getHeader, a as setHeader, c as createError } from '../../../../nitro/nitro.mjs';
import { i as isBacklogFull, b as backlogSnapshot, c as createSse, s as sseSemaphore, w as withSseConcurrency } from '../../../../_/concurrency.mjs';
import { W as WorkflowRequestSchema } from '../../../../_/agent-types.mjs';
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

const executeWithProgress_post = defineEventHandler(async (event) => {
  var _a, _b, _c;
  const body = (_b = (_a = event.context) == null ? void 0 : _a.body) != null ? _b : await readBody(event);
  const request = WorkflowRequestSchema.parse(body);
  const cid = getHeader(event, "x-correlation-id") || ((_c = event.context) == null ? void 0 : _c.correlationId) || void 0;
  if (isBacklogFull()) {
    const snap = backlogSnapshot();
    try {
      const { getLogger } = await import('../../../../_/logger.mjs');
      getLogger().warn("sse_backlog_reject", { ...snap, correlationId: cid });
    } catch {
    }
    setHeader(event, "Retry-After", "2");
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
      const { getAgents } = await import('../../../../_/agents-container.mjs').then(function (n) { return n.e; });
      const { strategy, generator, qa } = getAgents();
      const orchestrator = new (await import('../../../../_/workflow-orchestrator.mjs')).WorkflowOrchestrator(
        strategy,
        generator,
        qa
      );
      const result = await orchestrator.executeWorkflowWithProgress(
        request,
        (progress) => sse.send({ type: "progress", data: progress })
      );
      await sse.send({ type: "complete", data: result });
    });
  } catch (error) {
    const message = (error == null ? void 0 : error.statusMessage) || (error == null ? void 0 : error.message) || "Unknown error";
    await sse.send({ type: "error", message });
  } finally {
    sse.close();
  }
});

export { executeWithProgress_post as default };;globalThis.__timing__.logEnd('Load chunks/routes/api/v1/workflow/execute-with-progress.post');
//# sourceMappingURL=execute-with-progress.post.mjs.map
