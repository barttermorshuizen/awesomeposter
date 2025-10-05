import { d as defineEventHandler, r as readBody, c as createError } from '../../../nitro/nitro.mjs';
import { z } from 'zod';
import { r as requireApiAuth } from '../../../_/api-auth.mjs';
import { g as getOrchestratorPersistence } from '../../../_/orchestrator-persistence.mjs';
import { g as getHitlService, a as getLogger, H as HitlResponseInputSchema } from '../../../_/hitl-service.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';
import 'drizzle-orm';
import '../../../_/client.mjs';
import 'drizzle-orm/node-postgres';
import 'pg';
import 'drizzle-orm/pg-core';
import 'node:async_hooks';
import 'winston';

const ResumeRequestSchema = z.object({
  runId: z.string().optional(),
  threadId: z.string().optional(),
  requestId: z.string().min(1),
  responses: z.array(HitlResponseInputSchema).min(1),
  operator: z.object({
    id: z.string().optional(),
    displayName: z.string().optional(),
    email: z.string().optional()
  }).optional(),
  note: z.string().optional()
}).refine((data) => data.runId || data.threadId, {
  message: "runId or threadId is required",
  path: ["runId"]
}).refine((data) => data.responses.every((res) => res.requestId === data.requestId), {
  message: "responses must reference requestId",
  path: ["responses"]
});
const resume_post = defineEventHandler(async (event) => {
  var _a, _b, _c, _d, _e, _f, _g;
  requireApiAuth(event);
  const body = await readBody(event);
  const payload = ResumeRequestSchema.parse(body);
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
  const pendingRequest = snapshot.hitlState.requests.find((req) => req.id === payload.requestId);
  if (!pendingRequest) {
    throw createError({ statusCode: 404, statusMessage: "Request not found for run" });
  }
  if (pendingRequest.status !== "pending") {
    throw createError({ statusCode: 409, statusMessage: "Request already resolved" });
  }
  if (snapshot.pendingRequestId && snapshot.pendingRequestId !== payload.requestId) {
    throw createError({ statusCode: 409, statusMessage: "Run waiting on a different request" });
  }
  const hitlService = getHitlService();
  const updatedState = await hitlService.applyResponses(resolvedRunId, payload.responses);
  const refreshed = await persistence.load(resolvedRunId);
  const metadata = refreshed.runnerMetadata || {};
  const auditLog = Array.isArray(metadata.auditLog) ? [...metadata.auditLog] : [];
  auditLog.push({
    action: "resume",
    requestId: payload.requestId,
    operator: (_b = payload.operator) != null ? _b : null,
    note: (_c = payload.note) != null ? _c : null,
    at: (/* @__PURE__ */ new Date()).toISOString()
  });
  const runnerMetadata = {
    ...metadata,
    auditLog,
    lastResumeAt: (/* @__PURE__ */ new Date()).toISOString(),
    lastOperator: (_e = (_d = payload.operator) != null ? _d : metadata.lastOperator) != null ? _e : null
  };
  await persistence.save(resolvedRunId, {
    pendingRequestId: (_f = updatedState.pendingRequestId) != null ? _f : null,
    status: "running",
    runnerMetadata
  });
  try {
    getLogger().info("hitl_resume_api", {
      runId: resolvedRunId,
      requestId: payload.requestId,
      responses: updatedState.responses.length
    });
  } catch {
  }
  return {
    ok: true,
    runId: resolvedRunId,
    status: "running",
    pendingRequestId: (_g = updatedState.pendingRequestId) != null ? _g : null,
    requests: updatedState.requests,
    responses: updatedState.responses
  };
});

export { resume_post as default };
//# sourceMappingURL=resume.post.mjs.map
