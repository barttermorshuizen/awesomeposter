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
    
    const result = await orchestrator.finalizeStrategy(state)
    
    if (!result.success) {
      throw createError({ 
        statusCode: 500, 
        statusMessage: result.error || 'Strategy finalization failed' 
      })
    }

    return {
      success: true,
      state: result.state
    }
  } catch (error) {
    console.error('Error in finalize endpoint:', error)
    
    if (error.statusCode) {
      throw error
    }
    
    throw createError({ 
      statusCode: 500, 
      statusMessage: 'Internal server error during strategy finalization' 
    })
  }
})
