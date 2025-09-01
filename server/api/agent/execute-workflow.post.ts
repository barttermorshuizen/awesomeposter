import { defineEventHandler, readBody, createError } from 'h3'
import { AgentOrchestrator } from '../../utils/agents/orchestrator'
import type { AgentState } from '@awesomeposter/shared'
import { getDb } from '../../utils/db'
import { assets, eq } from '@awesomeposter/db'

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

    // Enrich assets in state if missing and a brief id is provided
    if ((!state.inputs.assets || state.inputs.assets.length === 0) && state.inputs.brief?.id) {
      try {
        const db = getDb()
        const briefId = state.inputs.brief.id
        console.log(`🔍 Enriching state with assets for brief ${briefId}...`)
        const rows = await db.select().from(assets).where(eq(assets.briefId, briefId))
        const transformedAssets = rows.map(asset => ({
          id: asset.id,
          filename: asset.filename || '',
          originalName: asset.originalName || '',
          url: asset.url,
          type: asset.type || 'other',
          mimeType: asset.mimeType || '',
          fileSize: asset.fileSize || 0,
          metaJson: asset.metaJson || {}
        }))
        state.inputs.assets = transformedAssets
        console.log(`✅ Enriched state with ${transformedAssets.length} assets`)
      } catch (err) {
        console.warn('⚠️ Failed to enrich assets for brief; continuing without assets', err)
        state.inputs.assets = []
      }
    }

    const orchestrator = new AgentOrchestrator()
    
    console.log('🚀 Starting agent workflow execution...')
    
    // Add timeout to prevent hanging
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Workflow execution timed out after 120 seconds')), 120000)
    })
    
    const workflowPromise = orchestrator.executeWorkflow(state)
    
    const result = await Promise.race([
      workflowPromise,
      timeoutPromise
    ]) as { success: boolean; finalState: AgentState; error?: string }
    
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
