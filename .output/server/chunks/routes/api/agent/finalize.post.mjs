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

const finalize_post = defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    if (!(body == null ? void 0 : body.state)) {
      throw createError({
        statusCode: 400,
        statusMessage: "Agent state is required"
      });
    }
    const state = body.state;
    const orchestrator = new AgentOrchestrator();
    const result = await orchestrator.finalizeStrategy(state);
    if (!result.success) {
      throw createError({
        statusCode: 500,
        statusMessage: result.error || "Strategy finalization failed"
      });
    }
    return {
      success: true,
      state: result.state
    };
  } catch (error) {
    console.error("Error in finalize endpoint:", error);
    if (error.statusCode) {
      throw error;
    }
    throw createError({
      statusCode: 500,
      statusMessage: "Internal server error during strategy finalization"
    });
  }
});

export { finalize_post as default };
//# sourceMappingURL=finalize.post.mjs.map
