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
    
    const result = await orchestrator.planStrategy(state)
    
    if (!result.success) {
      throw createError({ 
        statusCode: 500, 
        statusMessage: result.error || 'Strategy planning failed' 
      })
    }

    return {
      success: true,
      state: result.state
    }
  } catch (error) {
    console.error('Error in plan-strategy endpoint:', error)
    
    if (error.statusCode) {
      throw error
    }
    
    throw createError({ 
      statusCode: 500, 
      statusMessage: 'Internal server error during strategy planning' 
    })
  }
})
