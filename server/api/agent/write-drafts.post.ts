import { defineEventHandler, readBody, createError } from 'h3'
import { AgentOrchestrator } from '../../utils/agents/orchestrator'
import type { AgentState } from '@awesomeposter/shared'
import { getDb } from '../../utils/db'
import { assets, briefs, eq } from '@awesomeposter/db'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    
    if (!body?.state) {
      throw createError({ 
        statusCode: 400, 
        statusMessage: 'Agent state is required' 
      })
    }

    let state: AgentState = body.state
    const count = Math.max(1, Number.parseInt(String(body.count ?? '3'), 10) || 3)

    // Enrich brief details from DB if an ID is provided (ensures description/title/objective are present)
    if (state.inputs?.brief?.id) {
      try {
        const db = getDb()
        const briefId = state.inputs.brief.id
        const [row] = await db.select().from(briefs).where(eq(briefs.id, briefId)).limit(1)
        if (row) {
          state.inputs.brief = {
            ...state.inputs.brief,
            title: state.inputs.brief.title || row.title || '',
            // Prefer existing non-empty description; otherwise use trimmed DB value
            description:
              (typeof state.inputs.brief.description === 'string' && state.inputs.brief.description.trim().length > 0)
                ? state.inputs.brief.description
                : (typeof row.description === 'string' && row.description.trim().length > 0 ? row.description : undefined),
            objective: state.inputs.brief.objective || row.objective || ''
          }
        }
      } catch (err) {
        console.warn('⚠️ Failed to enrich brief details; continuing with provided brief', err)
      }
    }
    
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
    
    // Auto-plan strategy if not provided to ensure knobs and strategy are available
    if (!state.knobs || !state.strategy) {
      const planning = await orchestrator.planStrategy(state)
      if (!planning.success) {
        throw createError({
          statusCode: 500,
          statusMessage: planning.error || 'Strategy planning failed prior to draft generation'
        })
      }
      state = { ...state, ...planning.state }
    }
    
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
