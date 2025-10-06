import { d as defineEventHandler, r as readBody, c as createError } from '../../../nitro/nitro.mjs';
import { z } from 'zod';
import { r as requireApiAuth } from '../../../_/api-auth.mjs';
import { g as getOrchestratorPersistence } from '../../../_/orchestrator-persistence.mjs';
import { g as getHitlService, a as getLogger } from '../../../_/hitl-service.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';
import 'drizzle-orm';
import 'drizzle-orm/pg-core';
import 'drizzle-orm/node-postgres';
import 'pg';
import 'node:async_hooks';
import 'winston';

const RemoveRequestSchema = z.object({
  runId: z.string().optional(),
  threadId: z.string().optional(),
  requestId: z.string().optional(),
  reason: z.string().min(1),
  operator: z.object({
    id: z.string().optional(),
    displayName: z.string().optional(),
    email: z.string().optional()
  }).optional(),
  note: z.string().optional()
}).refine((data) => data.runId || data.threadId, {
  message: "runId or threadId is required",
  path: ["runId"]
});
const remove_post = defineEventHandler(async (event) => {
  var _a, _b, _c, _d, _e, _f, _g;
  requireApiAuth(event);
  const body = await readBody(event);
  const payload = RemoveRequestSchema.parse(body);
  const persistence = getOrchestratorPersistence();
  let resolvedRunId = (_a = payload.runId) != null ? _a : null;
  let snapshot = resolvedRunId ? await persistence.load(resolvedRunId) : null;
  if (!resolvedRunId && payload.threadId) {
    const found = await persistence.findByThreadId(payload.threadId);
    if (!found) {
      throw createError({ statusCode: 404, statusMessage: "Thread not found" });
    }
    resolvedRunId = found.runId;
    snapshot = found.snapshot;
  }
  if (!resolvedRunId || !snapshot) {
    throw createError({ statusCode: 404, statusMessage: "Run not found" });
  }
  const targetRequestId = (_c = (_b = payload.requestId) != null ? _b : snapshot.pendingRequestId) != null ? _c : null;
  if (!targetRequestId) {
    throw createError({ statusCode: 409, statusMessage: "Run has no pending requests to remove" });
  }
  const requestRecord = snapshot.hitlState.requests.find((req) => req.id === targetRequestId);
  if (!requestRecord) {
    throw createError({ statusCode: 404, statusMessage: "Request not found for run" });
  }
  if (requestRecord.status !== "pending") {
    throw createError({ statusCode: 409, statusMessage: "Request already resolved" });
  }
  const hitlService = getHitlService();
  await hitlService.registerDenied(targetRequestId, payload.reason);
  const updatedState = await hitlService.loadRunState(resolvedRunId);
  const refreshed = await persistence.load(resolvedRunId);
  const metadata = refreshed.runnerMetadata || {};
  const auditLog = Array.isArray(metadata.auditLog) ? [...metadata.auditLog] : [];
  auditLog.push({
    action: "cancel",
    requestId: targetRequestId,
    reason: payload.reason,
    operator: (_d = payload.operator) != null ? _d : null,
    note: (_e = payload.note) != null ? _e : null,
    at: (/* @__PURE__ */ new Date()).toISOString()
  });
  const runnerMetadata = {
    ...metadata,
    auditLog,
    lastCancelAt: (/* @__PURE__ */ new Date()).toISOString(),
    lastOperator: (_g = (_f = payload.operator) != null ? _f : metadata.lastOperator) != null ? _g : null
  };
  await persistence.save(resolvedRunId, {
    pendingRequestId: null,
    status: "cancelled",
    runnerMetadata
  });
  try {
    getLogger().info("hitl_cancel_api", {
      runId: resolvedRunId,
      requestId: targetRequestId,
      reason: payload.reason
    });
  } catch {
  }
  return {
    ok: true,
    runId: resolvedRunId,
    status: "cancelled",
    pendingRequestId: null,
    requests: updatedState.requests,
    responses: updatedState.responses
  };
});

export { remove_post as default };
//# sourceMappingURL=remove.post.mjs.map
