import { d as defineEventHandler, r as readBody, c as createError } from '../../../nitro/nitro.mjs';
import { A as AgentOrchestrator } from '../../../_/orchestrator.mjs';
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

const critiqueRevise_post = defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    if (!(body == null ? void 0 : body.state) || !(body == null ? void 0 : body.drafts)) {
      throw createError({
        statusCode: 400,
        statusMessage: "Agent state and drafts are required"
      });
    }
    const state = body.state;
    const drafts = body.drafts;
    const orchestrator = new AgentOrchestrator();
    const result = await orchestrator.evaluateDrafts(state, drafts);
    if (!result.success) {
      throw createError({
        statusCode: 500,
        statusMessage: result.error || "Draft evaluation failed"
      });
    }
    return {
      success: true,
      scores: result.state.scores,
      instructions: result.instructions || []
    };
  } catch (error) {
    console.error("Error in critique-revise endpoint:", error);
    if (error.statusCode) {
      throw error;
    }
    throw createError({
      statusCode: 500,
      statusMessage: "Internal server error during draft evaluation"
    });
  }
});

export { critiqueRevise_post as default };
//# sourceMappingURL=critique-revise.post.mjs.map
