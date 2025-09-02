import type { WorkflowRequest, WorkflowResponse } from '@awesomeposter/shared'
import type { StrategyManagerAgent } from '../agents/strategy-manager'
import type { ContentGeneratorAgent } from '../agents/content-generator'
import type { QualityAssuranceAgent } from '../agents/quality-assurance'

export class WorkflowOrchestrator {
  constructor(
    private strategy: StrategyManagerAgent,
    private generator: ContentGeneratorAgent,
    private qa: QualityAssuranceAgent
  ) {}

  async executeWorkflow(request: WorkflowRequest): Promise<WorkflowResponse> {
    const start = Date.now()
    // Placeholder: in future, call strategy/generator/qa
    const finalState = {
      received: request.state,
      briefId: request.briefId
    }
    const duration = Date.now() - start
    return {
      success: true,
      workflowId: `wf_${Math.random().toString(36).slice(2)}`,
      finalState,
      metrics: {
        executionTime: duration,
        tokensUsed: 0,
        revisionCycles: 0,
        qualityScore: 0,
        knobEffectiveness: {
          formatType: 'n/a',
          hookIntensity: 'n/a',
          expertiseDepth: 'n/a',
          structure: 'n/a'
        }
      }
    }
  }

  async executeWorkflowWithProgress(
    request: WorkflowRequest,
    onProgress: (p: any) => void
  ): Promise<WorkflowResponse> {
    onProgress({ type: 'start', at: new Date().toISOString() })
    onProgress({ type: 'phase', name: 'strategy', status: 'pending' })
    // Placeholder phases
    onProgress({ type: 'phase', name: 'strategy', status: 'done' })
    onProgress({ type: 'phase', name: 'generation', status: 'done' })
    onProgress({ type: 'phase', name: 'qa', status: 'done' })
    const result = await this.executeWorkflow(request)
    onProgress({ type: 'finish', at: new Date().toISOString() })
    return result
  }
}

