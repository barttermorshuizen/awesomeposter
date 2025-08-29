import { AgentOrchestrator } from '../../utils/agents/orchestrator'
import type { AgentState } from '@awesomeposter/shared'
import { workflowStatuses } from './workflow-status.get'

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
    
    // Log the received state for debugging
    console.log('🔍 Received agent state:', {
      hasBrief: !!state.inputs?.brief,
      hasClientProfile: !!state.inputs?.clientProfile,
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
