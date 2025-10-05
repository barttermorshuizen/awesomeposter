import { d as defineEventHandler, r as readBody, c as createError } from '../../../nitro/nitro.mjs';
import { A as AgentOrchestrator } from '../../../_/orchestrator.mjs';
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

const executeWorkflow_post = defineEventHandler(async (event) => {
  var _a, _b, _c;
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
        console.log(`\u{1F50D} Enriching state with assets for brief ${briefId}...`);
        const rows = await db.select().from(assets).where(eq(assets.briefId, briefId));
        const transformedAssets = rows.map((asset) => ({
          id: asset.id,
          filename: asset.filename || "",
          originalName: asset.originalName || "",
          url: asset.url,
          type: asset.type || "other",
          mimeType: asset.mimeType || "",
          fileSize: asset.fileSize || 0,
          metaJson: asset.metaJson || {}
        }));
        state.inputs.assets = transformedAssets;
        console.log(`\u2705 Enriched state with ${transformedAssets.length} assets`);
      } catch (err) {
        console.warn("\u26A0\uFE0F Failed to enrich assets for brief; continuing without assets", err);
        state.inputs.assets = [];
      }
    }
    const orchestrator = new AgentOrchestrator();
    console.log("\u{1F680} Starting agent workflow execution...");
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Workflow execution timed out after 120 seconds")), 12e4);
    });
    const workflowPromise = orchestrator.executeWorkflow(state);
    const result = await Promise.race([
      workflowPromise,
      timeoutPromise
    ]);
    if (!result.success) {
      throw createError({
        statusCode: 500,
        statusMessage: result.error || "Workflow execution failed"
      });
    }
    const metrics = orchestrator.getWorkflowMetrics(result.finalState);
    console.log("\u2705 Workflow execution completed successfully");
    console.log("\u{1F50D} Result structure:", {
      success: result.success,
      hasFinalState: !!result.finalState,
      finalStateKeys: result.finalState ? Object.keys(result.finalState) : [],
      hasMetrics: !!metrics,
      metricsKeys: metrics ? Object.keys(metrics) : []
    });
    const response = {
      success: true,
      finalState: result.finalState,
      metrics
    };
    console.log("\u{1F50D} Final response:", response);
    return response;
  } catch (error) {
    console.error("Error in execute-workflow endpoint:", error);
    if (error.statusCode) {
      throw error;
    }
    throw createError({
      statusCode: 500,
      statusMessage: error.message || "Internal server error during workflow execution"
    });
  }
});

export { executeWorkflow_post as default };
//# sourceMappingURL=execute-workflow.post.mjs.map
