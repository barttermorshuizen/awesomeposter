import { d as defineEventHandler, r as readBody, c as createError } from '../../../nitro/nitro.mjs';
import { A as AgentOrchestrator } from '../../../_/orchestrator.mjs';
import { workflowStatuses } from './workflow-status.get.mjs';
import { g as getDb } from '../../../_/db.mjs';
import { b as briefs, a as assets } from '../../../_/client.mjs';
import { eq } from 'drizzle-orm';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';
import 'openai';
import '../../../_/env.mjs';
import 'zod';
import 'node:module';
import 'drizzle-orm/node-postgres';
import 'pg';
import 'drizzle-orm/pg-core';

const toAssetType = (rawType, mime) => {
  const v = (rawType || "").toLowerCase();
  if (v === "image" || v === "document" || v === "video" || v === "audio" || v === "other") {
    return v;
  }
  if (mime == null ? void 0 : mime.startsWith("image/")) return "image";
  if (mime == null ? void 0 : mime.startsWith("video/")) return "video";
  if (mime == null ? void 0 : mime.startsWith("audio/")) return "audio";
  if ((mime == null ? void 0 : mime.includes("pdf")) || (mime == null ? void 0 : mime.includes("presentation")) || (mime == null ? void 0 : mime.startsWith("application/"))) return "document";
  return "other";
};
const executeWorkflowProgress_post = defineEventHandler(async (event) => {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q;
  try {
    const body = await readBody(event);
    if (!(body == null ? void 0 : body.state)) {
      throw createError({
        statusCode: 400,
        statusMessage: "Agent state is required"
      });
    }
    const state = body.state;
    if ((_b = (_a = state.inputs) == null ? void 0 : _a.brief) == null ? void 0 : _b.id) {
      try {
        const db = getDb();
        const briefId = state.inputs.brief.id;
        const [row] = await db.select().from(briefs).where(eq(briefs.id, briefId)).limit(1);
        if (row) {
          state.inputs.brief = {
            ...state.inputs.brief,
            title: state.inputs.brief.title || row.title || "",
            // Prefer existing non-empty description; otherwise use trimmed DB value
            description: typeof state.inputs.brief.description === "string" && state.inputs.brief.description.trim().length > 0 ? state.inputs.brief.description : typeof row.description === "string" && row.description.trim().length > 0 ? row.description : void 0,
            objective: state.inputs.brief.objective || row.objective || ""
          };
        }
      } catch (err) {
        console.warn("\u26A0\uFE0F Failed to enrich brief details; continuing with provided brief", err);
      }
    }
    if ((!state.inputs.assets || state.inputs.assets.length === 0) && ((_c = state.inputs.brief) == null ? void 0 : _c.id)) {
      try {
        const db = getDb();
        const briefId = state.inputs.brief.id;
        console.log(`\u{1F50D} Enriching state with assets for brief ${briefId} (progressive workflow)...`);
        const rowsBrief = await db.select().from(assets).where(eq(assets.briefId, briefId));
        let rowsClient = [];
        try {
          const [briefRow] = await db.select().from(briefs).where(eq(briefs.id, briefId)).limit(1);
          const clientId = briefRow == null ? void 0 : briefRow.clientId;
          if (clientId) {
            const allClientAssets = await db.select().from(assets).where(eq(assets.clientId, clientId));
            rowsClient = allClientAssets.filter((a) => a.briefId === null || a.briefId === void 0);
          }
        } catch (innerErr) {
          console.warn("\u26A0\uFE0F Could not fetch client brand assets for enrichment", innerErr);
        }
        const seen = /* @__PURE__ */ new Set();
        const combined = [...rowsBrief, ...rowsClient].filter((a) => {
          if (!(a == null ? void 0 : a.id)) return false;
          if (seen.has(a.id)) return false;
          seen.add(a.id);
          return true;
        });
        const transformedAssets = combined.map((asset) => ({
          id: asset.id,
          filename: asset.filename || "",
          originalName: asset.originalName || "",
          url: asset.url,
          type: toAssetType(asset.type, asset.mimeType),
          mimeType: asset.mimeType || "",
          fileSize: asset.fileSize || 0,
          metaJson: asset.metaJson || {}
        }));
        state.inputs.assets = transformedAssets;
        console.log(`\u2705 Enriched state with ${transformedAssets.length} assets (brief + brand)`);
        console.log("\u{1F50D} Asset details:", transformedAssets.map((a) => ({ id: a.id, filename: a.filename, type: a.type, mimeType: a.mimeType })));
      } catch (err) {
        console.warn("\u26A0\uFE0F Failed to enrich assets for brief; continuing without assets", err);
        state.inputs.assets = [];
      }
    }
    const orchestrator = new AgentOrchestrator();
    console.log("\u{1F50D} Received agent state:", {
      hasBrief: !!((_d = state.inputs) == null ? void 0 : _d.brief),
      hasClientProfile: !!((_e = state.inputs) == null ? void 0 : _e.clientProfile),
      hasAssets: !!((_f = state.inputs) == null ? void 0 : _f.assets) && state.inputs.assets.length > 0,
      assetsCount: ((_h = (_g = state.inputs) == null ? void 0 : _g.assets) == null ? void 0 : _h.length) || 0,
      clientProfileKeys: ((_i = state.inputs) == null ? void 0 : _i.clientProfile) ? Object.keys(state.inputs.clientProfile) : "none",
      objectivesKeys: ((_k = (_j = state.inputs) == null ? void 0 : _j.clientProfile) == null ? void 0 : _k.objectivesJson) ? Object.keys(state.inputs.clientProfile.objectivesJson) : "none",
      audiencesKeys: ((_m = (_l = state.inputs) == null ? void 0 : _l.clientProfile) == null ? void 0 : _m.audiencesJson) ? Object.keys(state.inputs.clientProfile.audiencesJson) : "none",
      toneKeys: ((_o = (_n = state.inputs) == null ? void 0 : _n.clientProfile) == null ? void 0 : _o.toneJson) ? Object.keys(state.inputs.clientProfile.toneJson) : "none",
      specialInstructionsKeys: ((_q = (_p = state.inputs) == null ? void 0 : _p.clientProfile) == null ? void 0 : _q.specialInstructionsJson) ? Object.keys(state.inputs.clientProfile.specialInstructionsJson) : "none"
    });
    const workflowId = `workflow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    workflowStatuses.set(workflowId, {
      status: "pending",
      progress: {
        currentStep: "Initializing...",
        stepNumber: 0,
        totalSteps: 4,
        percentage: 0,
        details: "Preparing to execute workflow",
        timestamp: Date.now()
      },
      startedAt: Date.now(),
      updatedAt: Date.now()
    });
    console.log("\u{1F680} Starting progressive agent workflow execution...", { workflowId });
    orchestrator.executeWorkflowWithProgress(state, (progress) => {
      const status2 = workflowStatuses.get(workflowId);
      if (status2) {
        status2.progress = progress;
        status2.updatedAt = Date.now();
        console.log("\u{1F4CA} Progress update:", { workflowId, progress });
      }
    }).then((result) => {
      const status2 = workflowStatuses.get(workflowId);
      if (status2) {
        status2.status = result.success ? "completed" : "failed";
        status2.progress = result.progress;
        status2.result = result.success ? result.finalState : void 0;
        status2.error = result.error;
        status2.updatedAt = Date.now();
      }
      console.log("\u2705 Progressive workflow execution completed:", { workflowId, success: result.success });
    }).catch((error) => {
      const status2 = workflowStatuses.get(workflowId);
      if (status2) {
        status2.status = "failed";
        status2.error = error instanceof Error ? error.message : "Unknown error";
        status2.updatedAt = Date.now();
      }
      console.error("\u274C Progressive workflow execution failed:", { workflowId, error });
    });
    const status = workflowStatuses.get(workflowId);
    if (status) {
      status.status = "running";
      status.progress = {
        currentStep: "Starting workflow...",
        stepNumber: 1,
        totalSteps: 4,
        percentage: 25,
        details: "Initializing AI agents and preparing strategy",
        timestamp: Date.now()
      };
      status.updatedAt = Date.now();
    }
    return {
      success: true,
      workflowId,
      message: "Workflow started successfully. Use the workflow ID to poll for status updates.",
      status: "running"
    };
  } catch (error) {
    console.error("Error in execute-workflow-progress endpoint:", error);
    if (error && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    throw createError({
      statusCode: 500,
      statusMessage: error instanceof Error ? error.message : "Internal server error during workflow execution"
    });
  }
});

export { executeWorkflowProgress_post as default };
//# sourceMappingURL=execute-workflow-progress.post.mjs.map
