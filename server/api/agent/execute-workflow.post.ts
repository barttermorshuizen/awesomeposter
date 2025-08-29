import { AgentOrchestrator } from '../../utils/agents/orchestrator'
import type { AgentState } from '@awesomeposter/shared'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    
    if (!body?.state) {
      throw createError({ 
        statusCode: 400, 
        statusMessage: 'Agent state is required' 
      })
    }

    const state: AgentState = body.state
    const orchestrator = new AgentOrchestrator()
    
    console.log('🚀 Starting agent workflow execution...')
    
    // Add timeout to prevent hanging
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Workflow execution timed out after 120 seconds')), 120000)
    })
    
    const workflowPromise = orchestrator.executeWorkflow(state)
    
    const result = await Promise.race([workflowPromise, timeoutPromise])
    
    if (!result.success) {
      throw createError({ 
        statusCode: 500, 
        statusMessage: result.error || 'Workflow execution failed' 
      })
    }

    // Get workflow metrics
    const metrics = orchestrator.getWorkflowMetrics(result.finalState)
    
    console.log('✅ Workflow execution completed successfully')
    console.log('🔍 Result structure:', {
      success: result.success,
      hasFinalState: !!result.finalState,
      finalStateKeys: result.finalState ? Object.keys(result.finalState) : [],
      hasMetrics: !!metrics,
      metricsKeys: metrics ? Object.keys(metrics) : []
    })
    
    const response = {
      success: true,
      finalState: result.finalState,
      metrics
    }
    
    console.log('🔍 Final response:', response)
    return response
  } catch (error) {
    console.error('Error in execute-workflow endpoint:', error)
    
    if (error.statusCode) {
      throw error
    }
    
    throw createError({ 
      statusCode: 500, 
      statusMessage: error.message || 'Internal server error during workflow execution' 
    })
  }
})
