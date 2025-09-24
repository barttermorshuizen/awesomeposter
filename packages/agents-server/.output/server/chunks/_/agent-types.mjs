import { z } from 'zod';

const WorkflowRequestSchema = z.object({
  briefId: z.string(),
  state: z.object({
    objective: z.string(),
    inputs: z.object({
      brief: z.object({
        id: z.string().optional(),
        title: z.string(),
        description: z.string().optional(),
        objective: z.string().optional()
      }),
      clientProfile: z.any().optional(),
      assets: z.array(z.any()).optional()
    })
  }),
  options: z.object({
    enableProgressTracking: z.boolean().optional(),
    maxRevisionCycles: z.number().optional()
  }).optional()
});

export { WorkflowRequestSchema as W };
//# sourceMappingURL=agent-types.mjs.map
