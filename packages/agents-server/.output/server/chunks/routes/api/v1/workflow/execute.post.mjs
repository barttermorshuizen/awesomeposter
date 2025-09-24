import { d as defineEventHandler, r as readBody } from '../../../../nitro/nitro.mjs';
import { W as WorkflowRequestSchema } from '../../../../_/agent-types.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';
import 'zod';

const execute_post = defineEventHandler(async (event) => {
  const body = await readBody(event);
  const request = WorkflowRequestSchema.parse(body);
  const { getAgents } = await import('../../../../_/agents-container.mjs').then(function (n) { return n.d; });
  const { strategy, generator, qa } = getAgents();
  const orchestrator = new (await import('../../../../_/workflow-orchestrator.mjs')).WorkflowOrchestrator(
    strategy,
    generator,
    qa
  );
  const result = await orchestrator.executeWorkflow(request);
  return {
    success: true,
    workflowId: result.workflowId,
    finalState: result.finalState,
    metrics: result.metrics
  };
});

export { execute_post as default };
//# sourceMappingURL=execute.post.mjs.map
