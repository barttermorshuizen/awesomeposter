import { AgentOrchestrator } from '../../utils/agents/orchestrator'
import type { AgentState, Draft } from '@awesomeposter/shared'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    
    if (!body?.state || !body?.drafts) {
      throw createError({ 
        statusCode: 400, 
        statusMessage: 'Agent state and drafts are required' 
      })
    }

    const state: AgentState = body.state
    const drafts: Draft[] = body.drafts
    
    const orchestrator = new AgentOrchestrator()
    
    const result = await orchestrator.evaluateDrafts(state, drafts)
    
    if (!result.success) {
      throw createError({ 
        statusCode: 500, 
        statusMessage: result.error || 'Draft evaluation failed' 
      })
    }

    return {
      success: true,
      scores: result.state.scores,
      instructions: result.instructions || []
    }
  } catch (error) {
    console.error('Error in critique-revise endpoint:', error)
    
    if (error.statusCode) {
      throw error
    }
    
    throw createError({ 
      statusCode: 500, 
      statusMessage: 'Internal server error during draft evaluation' 
    })
  }
})
