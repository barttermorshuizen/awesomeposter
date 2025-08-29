import { AgentOrchestrator } from '../../utils/agents/orchestrator'

// In-memory storage for workflow status (in production, this would be in a database)
const workflowStatuses = new Map<string, {
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: {
    currentStep: string
    stepNumber: number
    totalSteps: number
    percentage: number
    details: string
    timestamp: number
  }
  result?: any
  error?: string
  startedAt: number
  updatedAt: number
}>()

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    const workflowId = query.id as string
    
    if (!workflowId) {
      throw createError({ 
        statusCode: 400, 
        statusMessage: 'Workflow ID is required' 
      })
    }

    const status = workflowStatuses.get(workflowId)
    
    if (!status) {
      throw createError({ 
        statusCode: 404, 
        statusMessage: 'Workflow not found' 
      })
    }

    return {
      success: true,
      workflowId,
      ...status
    }
  } catch (error) {
    console.error('Error in workflow-status endpoint:', error)
    
    if (error.statusCode) {
      throw error
    }
    
    throw createError({ 
      statusCode: 500, 
      statusMessage: 'Internal server error while fetching workflow status' 
    })
  }
})

// Export for use in other endpoints
export { workflowStatuses }
