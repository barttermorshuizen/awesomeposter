import { z } from 'zod'

export const AgentModeEnum = z.enum(['app', 'chat'])
export type AgentMode = z.infer<typeof AgentModeEnum>

export const AgentRunOptionsSchema = z.object({
  toolPolicy: z.enum(['auto', 'required', 'off']).default('auto').optional(),
  schemaName: z.string().optional(),
  systemPromptOverride: z.string().max(8000).optional(),
  toolsAllowlist: z.array(z.string()).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTurns: z.number().int().positive().optional(),
  trace: z.boolean().optional()
}).optional()

export const AgentRunRequestSchema = z.object({
  mode: AgentModeEnum,
  objective: z.string().min(1),
  briefId: z.string().optional(),
  state: z.any().optional(),
  options: AgentRunOptionsSchema
})
export type AgentRunRequest = z.infer<typeof AgentRunRequestSchema>

// Generic event envelope for SSE
export const AgentEventSchema = z.object({
  type: z.enum([
    'start',
    'phase',
    'tool_call',
    'tool_result',
    'message',
    'delta',
    'metrics',
    'warning',
    'error',
    'complete'
  ]),
  phase: z.enum(['analysis', 'planning', 'generation', 'qa', 'finalization', 'idle']).optional(),
  message: z.string().optional(),
  data: z.any().optional(),
  tokens: z.number().optional(),
  durationMs: z.number().optional(),
  correlationId: z.string().optional()
})
export type AgentEvent = z.infer<typeof AgentEventSchema>

// Default structured output for app mode
// For OpenAI structured outputs, all fields must be required; use nullable for optional semantics.
export const AppResultSchema = z.object({
  result: z.any(),
  rationale: z.string().nullable()
})
export type AppResult = z.infer<typeof AppResultSchema>

