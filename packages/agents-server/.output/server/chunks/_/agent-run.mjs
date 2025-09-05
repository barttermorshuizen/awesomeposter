globalThis.__timing__.logStart('Load chunks/_/agent-run');import { z } from 'zod';

const AgentModeEnum = z.enum(["app", "chat"]);
const AgentRunOptionsSchema = z.object({
  toolPolicy: z.enum(["auto", "required", "off"]).default("auto").optional(),
  schemaName: z.string().optional(),
  systemPromptOverride: z.string().max(8e3).optional(),
  toolsAllowlist: z.array(z.string()).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTurns: z.number().int().positive().optional(),
  trace: z.boolean().optional()
}).optional();
const AgentRunRequestSchema = z.object({
  mode: AgentModeEnum,
  objective: z.string().min(1),
  briefId: z.string().optional(),
  state: z.any().optional(),
  options: AgentRunOptionsSchema
});
z.object({
  type: z.enum([
    "start",
    "phase",
    "tool_call",
    "tool_result",
    "message",
    "delta",
    "handoff",
    "metrics",
    "warning",
    "error",
    "complete"
  ]),
  phase: z.enum(["analysis", "planning", "generation", "qa", "finalization", "idle"]).optional(),
  message: z.string().optional(),
  data: z.any().optional(),
  tokens: z.number().optional(),
  durationMs: z.number().optional(),
  correlationId: z.string().optional()
});
const AppResultSchema = z.object({
  result: z.any(),
  rationale: z.string().nullable()
});

export { AgentRunRequestSchema as A, AppResultSchema as a };;globalThis.__timing__.logEnd('Load chunks/_/agent-run');
//# sourceMappingURL=agent-run.mjs.map
