import { z } from 'zod'

export const WorkflowRequestSchema = z.object({
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
})

export type WorkflowRequest = z.infer<typeof WorkflowRequestSchema>

export interface AgentMetrics {
  executionTime: number
  tokensUsed: number
  revisionCycles: number
  qualityScore: number
  knobEffectiveness: {
    formatType: string
    hookIntensity: string
    expertiseDepth: string
    structure: string
  }
}

export type WorkflowResponse = {
  success: boolean
  workflowId: string
  finalState: Record<string, unknown>
  metrics: AgentMetrics
}

