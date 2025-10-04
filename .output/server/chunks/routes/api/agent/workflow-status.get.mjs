import { d as defineEventHandler, g as getQuery, c as createError } from '../../../nitro/nitro.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';

const workflowStatuses = /* @__PURE__ */ new Map();
const workflowStatus_get = defineEventHandler(async (event) => {
  try {
    const query = getQuery(event);
    const workflowId = query.id;
    if (!workflowId) {
      throw createError({
        statusCode: 400,
        statusMessage: "Workflow ID is required"
      });
    }
    const status = workflowStatuses.get(workflowId);
    if (!status) {
      throw createError({
        statusCode: 404,
        statusMessage: "Workflow not found"
      });
    }
    return {
      success: true,
      workflowId,
      ...status
    };
  } catch (error) {
    console.error("Error in workflow-status endpoint:", error);
    if (error.statusCode) {
      throw error;
    }
    throw createError({
      statusCode: 500,
      statusMessage: "Internal server error while fetching workflow status"
    });
  }
});

export { workflowStatus_get as default, workflowStatuses };
//# sourceMappingURL=workflow-status.get.mjs.map
