import { defineEventHandler, readBody, createError } from 'h3'
import { AgentOrchestrator } from '../../utils/agents/orchestrator'
import type { AgentState, Asset as SharedAsset, AssetType } from '@awesomeposter/shared'
import { workflowStatuses } from './workflow-status.get'
import { getDb } from '../../utils/db'
import { assets, briefs, eq } from '@awesomeposter/db'

// Minimal row shape used for enrichment from DB
type AssetRow = {
  id: string
  filename?: string | null
  originalName?: string | null
  url: string
  type?: string | null
  mimeType?: string | null
  fileSize?: number | null
  metaJson?: Record<string, unknown> | null
  briefId?: string | null
  clientId?: string | null
}


const toAssetType = (rawType?: string | null, mime?: string | null): AssetType => {
  const v = (rawType || '').toLowerCase()
  if (v === 'image' || v === 'document' || v === 'video' || v === 'audio' || v === 'other') {
    return v as AssetType
  }
  if (mime?.startsWith('image/')) return 'image'
  if (mime?.startsWith('video/')) return 'video'
  if (mime?.startsWith('audio/')) return 'audio'
  if (mime?.includes('pdf') || mime?.includes('presentation') || mime?.startsWith('application/')) return 'document'
  return 'other'
}

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
        console.log(`🔍 Enriching state with assets for brief ${briefId} (progressive workflow)...`)
        
        // 1) Brief-scoped assets
        const rowsBrief = await db.select().from(assets).where(eq(assets.briefId, briefId))

        // 2) Also include client brand assets (briefId null) for this brief's client
        let rowsClient: AssetRow[] = []
        try {
          const [briefRow] = await db.select().from(briefs).where(eq(briefs.id, briefId)).limit(1)
          const clientId = (briefRow as { clientId?: string | null } | undefined)?.clientId
          if (clientId) {
            const allClientAssets = await db.select().from(assets).where(eq(assets.clientId, clientId)) as AssetRow[]
            rowsClient = allClientAssets.filter(a => a.briefId === null || a.briefId === undefined)
          }
        } catch (innerErr) {
          console.warn('⚠️ Could not fetch client brand assets for enrichment', innerErr)
        }

        // 3) Combine (brief assets + client brand assets), avoid duplicates by id
        const seen = new Set<string>()
        const combined = [...rowsBrief, ...rowsClient].filter(a => {
          if (!a?.id) return false
          if (seen.has(a.id)) return false
          seen.add(a.id)
          return true
        })

        const transformedAssets: SharedAsset[] = (combined as AssetRow[]).map((asset) => ({
          id: asset.id,
          filename: asset.filename || '',
          originalName: asset.originalName || '',
          url: asset.url,
          type: toAssetType(asset.type, asset.mimeType),
          mimeType: asset.mimeType || '',
          fileSize: asset.fileSize || 0,
          metaJson: asset.metaJson || {}
        }))
        
        state.inputs.assets = transformedAssets
        console.log(`✅ Enriched state with ${transformedAssets.length} assets (brief + brand)`)
        console.log('🔍 Asset details:', transformedAssets.map(a => ({ id: a.id, filename: a.filename, type: a.type, mimeType: a.mimeType })))
      } catch (err) {
        console.warn('⚠️ Failed to enrich assets for brief; continuing without assets', err)
        state.inputs.assets = []
      }
    }

    const orchestrator = new AgentOrchestrator()
    
    // Log the received state for debugging
    console.log('🔍 Received agent state:', {
      hasBrief: !!state.inputs?.brief,
      hasClientProfile: !!state.inputs?.clientProfile,
      hasAssets: !!state.inputs?.assets && state.inputs.assets.length > 0,
      assetsCount: state.inputs?.assets?.length || 0,
      clientProfileKeys: state.inputs?.clientProfile ? Object.keys(state.inputs.clientProfile) : 'none',
      objectivesKeys: state.inputs?.clientProfile?.objectivesJson ? Object.keys(state.inputs.clientProfile.objectivesJson) : 'none',
      audiencesKeys: state.inputs?.clientProfile?.audiencesJson ? Object.keys(state.inputs.clientProfile.audiencesJson) : 'none',
      toneKeys: state.inputs?.clientProfile?.toneJson ? Object.keys(state.inputs.clientProfile.toneJson) : 'none',
      specialInstructionsKeys: state.inputs?.clientProfile?.specialInstructionsJson ? Object.keys(state.inputs.clientProfile.specialInstructionsJson) : 'none'
    })
    
    // Generate unique workflow ID
    const workflowId = `workflow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    // Initialize workflow status
    workflowStatuses.set(workflowId, {
      status: 'pending',
      progress: {
        currentStep: 'Initializing...',
        stepNumber: 0,
        totalSteps: 4,
        percentage: 0,
        details: 'Preparing to execute workflow',
        timestamp: Date.now()
      },
      startedAt: Date.now(),
      updatedAt: Date.now()
    })
    
    console.log('🚀 Starting progressive agent workflow execution...', { workflowId })
    
    // Execute workflow asynchronously
    orchestrator.executeWorkflowWithProgress(state, (progress) => {
      // Update workflow status with real-time progress
      const status = workflowStatuses.get(workflowId)
      if (status) {
        status.progress = progress
        status.updatedAt = Date.now()
        console.log('📊 Progress update:', { workflowId, progress })
      }
    })
      .then(result => {
        const status = workflowStatuses.get(workflowId)
        if (status) {
          status.status = result.success ? 'completed' : 'failed'
          status.progress = result.progress
          status.result = result.success ? result.finalState : undefined
          status.error = result.error
          status.updatedAt = Date.now()
        }
        console.log('✅ Progressive workflow execution completed:', { workflowId, success: result.success })
      })
      .catch((error: unknown) => {
        const status = workflowStatuses.get(workflowId)
        if (status) {
          status.status = 'failed'
          status.error = error instanceof Error ? error.message : 'Unknown error'
          status.updatedAt = Date.now()
        }
        console.error('❌ Progressive workflow execution failed:', { workflowId, error })
      })
    
    // Update status to running
    const status = workflowStatuses.get(workflowId)
    if (status) {
      status.status = 'running'
      status.progress = {
        currentStep: 'Starting workflow...',
        stepNumber: 1,
        totalSteps: 4,
        percentage: 25,
        details: 'Initializing AI agents and preparing strategy',
        timestamp: Date.now()
      }
      status.updatedAt = Date.now()
    }
    
    // Return workflow ID immediately for client to poll
    return {
      success: true,
      workflowId,
      message: 'Workflow started successfully. Use the workflow ID to poll for status updates.',
      status: 'running'
    }
  } catch (error: unknown) {
    console.error('Error in execute-workflow-progress endpoint:', error)
    
    if (error && typeof error === 'object' && 'statusCode' in error) {
      throw error
    }
    
    throw createError({ 
      statusCode: 500, 
      statusMessage: error instanceof Error ? error.message : 'Internal server error during workflow execution' 
    })
  }
})
