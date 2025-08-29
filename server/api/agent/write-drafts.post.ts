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
    const count = body.count || 3
    
    const orchestrator = new AgentOrchestrator()
    
    const drafts = await orchestrator.generateDrafts(state, count)
    
    return {
      success: true,
      drafts,
      count: drafts.length
    }
  } catch (error) {
    console.error('Error in write-drafts endpoint:', error)
    
    if (error.statusCode) {
      throw error
    }
    
    throw createError({ 
      statusCode: 500, 
      statusMessage: 'Internal server error during draft generation' 
    })
  }
})
