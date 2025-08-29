import { DigitalMarketeerAgent } from './digital-marketeer'
import { CopywriterAgent } from './copywriter'
import type { 
  AgentState, 
  Draft, 
  Knobs,
  Asset
} from '@awesomeposter/shared'
import { agentThresholds } from '@awesomeposter/shared'

export class AgentOrchestrator {
  private marketeer: DigitalMarketeerAgent
  private copywriter: CopywriterAgent

  constructor() {
    this.marketeer = new DigitalMarketeerAgent()
    this.copywriter = new CopywriterAgent()
  }

  /**
   * Fetch assets for a specific brief
   */
  private async fetchBriefAssets(briefId: string): Promise<Asset[]> {
    try {
      console.log(`🔍 Fetching assets for brief ${briefId}...`)
      
      // Make API call to fetch assets
      const response = await $fetch(`/api/briefs/${briefId}/assets`)
      if (response.ok && response.assets) {
        console.log(`✅ Fetched ${response.assets.length} assets for brief ${briefId}`)
        return response.assets
      }
      
      console.log('⚠️ No assets found for brief')
      return []
    } catch (error) {
      console.error('Error fetching brief assets:', error)
      return []
    }
  }

  /**
   * Execute the complete agent workflow with 4-knob optimization
   */
  async executeWorkflow(initialState: AgentState): Promise<{
    success: boolean
    finalState: AgentState
    error?: string
  }> {
    try {
      let state = { ...initialState }
      let revisionCycle = 0

      // Step 0: Fetch assets if not provided and briefId exists
      if (!state.inputs.assets && state.inputs.brief?.id) {
        console.log('🔍 Fetching assets for brief...')
        try {
          const assets = await this.fetchBriefAssets(state.inputs.brief.id)
          state.inputs.assets = assets
          console.log(`✅ Fetched ${assets.length} assets for brief`)
        } catch (error) {
          console.warn('⚠️ Failed to fetch assets, proceeding without assets:', error)
          state.inputs.assets = []
        }
      }

      // Step 1: Plan Strategy with 4-knob optimization
      console.log('🔄 Planning strategy with 4-knob optimization...')
      const strategyResult = await this.marketeer.planStrategy(state)
      if (!strategyResult.success) {
        throw new Error(`Strategy planning failed: ${strategyResult.error}`)
      }
      
      state = { ...state, ...strategyResult.state }
      console.log('✅ Strategy planned with knobs:', state.knobs)
      console.log('🔍 State after strategy planning:', {
        hasKnobs: !!state.knobs,
        knobsKeys: state.knobs ? Object.keys(state.knobs) : 'none',
        hasStrategy: !!state.strategy,
        strategyKeys: state.strategy ? Object.keys(state.strategy) : 'none',
        hasAssetAnalysis: !!state.assetAnalysis,
        stateKeys: Object.keys(state)
      })
      
      // Ensure strategy has required fields with defaults
      if (!state.strategy) {
        state.strategy = {
          platforms: ['linkedin'],
          structure: 'hook → insight → CTA',
          themes: ['professional', 'educational'],
          hashtags: ['#business', '#strategy'],
          objective: state.objective || 'Increase brand awareness'
        }
      }
      
      // Ensure platforms are set
      if (!state.strategy.platforms || state.strategy.platforms.length === 0) {
        state.strategy.platforms = ['linkedin']
      }
      
      console.log('✅ Strategy configured with platforms:', state.strategy.platforms)

      // Validate knob compliance
      if (state.knobs && state.inputs.clientProfile) {
        const knobValidation = this.validateKnobCompliance(state.knobs, state.inputs.clientProfile)
        if (!knobValidation.isValid) {
          console.warn('⚠️ Knob validation warnings:', knobValidation.warnings)
        }
      }

      // Step 2: Generate Initial Drafts with knob payload
      console.log('🔄 Generating initial drafts with 4-knob settings...')
      const initialDrafts = await this.copywriter.generateVariants(
        state, 
        agentThresholds.minVariantsToGenerate
      )
      state.drafts = initialDrafts
      console.log(`✅ Generated ${initialDrafts.length} initial drafts with knob optimization`)

      // Step 3: Evaluate and Revise (up to max cycles) with knob effectiveness
      while (revisionCycle < agentThresholds.maxRevisionCycles) {
        console.log(`🔄 Evaluation cycle ${revisionCycle + 1} with knob effectiveness...`)
        
        const evaluationResult = await this.marketeer.evaluateDrafts(state, state.drafts!)
        if (!evaluationResult.success) {
          throw new Error(`Draft evaluation failed: ${evaluationResult.error}`)
        }

        state = { ...state, ...evaluationResult.state }
        
        // Check if revisions are needed
        if (!evaluationResult.instructions || evaluationResult.instructions.length === 0) {
          console.log('✅ All drafts meet quality standards with knob optimization')
          break
        }

        // Check if we should stop revising
        const allDraftsMeetThreshold = state.drafts!.every(draft => {
          const score = state.scores![draft.variantId || draft.platform]
          return score && 
                 score.composite! >= agentThresholds.minCompositeScore &&
                 score.brandRisk <= agentThresholds.maxBrandRisk &&
                 score.compliance
        })

        if (allDraftsMeetThreshold) {
          console.log('✅ All drafts meet quality thresholds with knob optimization')
          break
        }

        // Revise drafts
        console.log(`🔄 Revising ${evaluationResult.instructions.length} drafts with knob constraints...`)
        const revisedDrafts = await this.copywriter.reviseDrafts(
          state, 
          state.drafts!, 
          evaluationResult.instructions
        )
        state.drafts = revisedDrafts
        revisionCycle++
        
        console.log(`✅ Revision cycle ${revisionCycle} completed with knob optimization`)
      }

      // Step 4: Finalize Strategy with knob performance insights
      console.log('🔄 Finalizing strategy with knob optimization insights...')
      const finalizationResult = await this.marketeer.finalizeStrategy(state)
      if (!finalizationResult.success) {
        throw new Error(`Strategy finalization failed: ${finalizationResult.error}`)
      }
      
      state = { ...state, ...finalizationResult.state }
      console.log('✅ Strategy finalized with knob optimization')

      return {
        success: true,
        finalState: state
      }

    } catch (error) {
      console.error('❌ Workflow execution failed:', error)
      return {
        success: false,
        finalState: initialState,
        error: error instanceof Error ? error.message : 'Unknown workflow error'
      }
    }
  }

  /**
   * Execute the complete agent workflow with 4-knob optimization and progress tracking
   */
  async executeWorkflowWithProgress(initialState: AgentState, onProgress?: (progress: {
    currentStep: string
    stepNumber: number
    totalSteps: number
    percentage: number
    details: string
    timestamp: number
  }) => void): Promise<{
    success: boolean
    finalState: AgentState
    error?: string
    progress: {
      currentStep: string
      stepNumber: number
      totalSteps: number
      percentage: number
      details: string
      timestamp: number
    }
  }> {
    try {
      let state = { ...initialState }
      let revisionCycle = 0
      
      // Progress tracking
      const updateProgress = (step: string, stepNumber: number, totalSteps: number, details: string) => {
        const progress = {
          currentStep: step,
          stepNumber,
          totalSteps,
          percentage: Math.round((stepNumber / totalSteps) * 100),
          details,
          timestamp: Date.now()
        }
        
        // Call progress callback if provided
        if (onProgress) {
          onProgress(progress)
        }
        
        return progress
      }

      // Step 1: Plan Strategy with 4-knob optimization
      console.log('🔄 Planning strategy with 4-knob optimization...')
      updateProgress('Planning Strategy', 1, 4, 'Analyzing brief and determining content strategy with 4-knob optimization')
      
      const strategyResult = await this.marketeer.planStrategy(state)
      if (!strategyResult.success) {
        throw new Error(`Strategy planning failed: ${strategyResult.error}`)
      }
      
      state = { ...state, ...strategyResult.state }
      console.log('✅ Strategy planned with knobs:', state.knobs)
      
      // Ensure strategy has required fields with defaults
      if (!state.strategy) {
        state.strategy = {
          platforms: ['linkedin'],
          structure: 'hook → insight → CTA',
          themes: ['professional', 'educational'],
          hashtags: ['#business', '#strategy'],
          objective: state.objective || 'Increase brand awareness'
        }
      }
      
      // Ensure platforms are set
      if (!state.strategy.platforms || state.strategy.platforms.length === 0) {
        state.strategy.platforms = ['linkedin']
      }
      
      console.log('✅ Strategy configured with platforms:', state.strategy.platforms)

      // Validate knob compliance
      if (state.knobs && state.inputs.clientProfile) {
        const knobValidation = this.validateKnobCompliance(state.knobs, state.inputs.clientProfile)
        if (!knobValidation.isValid) {
          console.warn('⚠️ Knob validation warnings:', knobValidation.warnings)
        }
      }

      // Step 2: Generate Initial Drafts with knob payload
      console.log('🔄 Generating initial drafts with 4-knob settings...')
      updateProgress('Generating Content', 2, 4, 'Creating content variants optimized with 4-knob settings')
      
      const initialDrafts = await this.copywriter.generateVariants(
        state, 
        agentThresholds.minVariantsToGenerate
      )
      state.drafts = initialDrafts
      console.log(`✅ Generated ${initialDrafts.length} initial drafts with knob optimization`)

      // Step 3: Evaluate and Revise (up to max cycles) with knob effectiveness
      updateProgress('Evaluating & Revising', 3, 4, 'Assessing content quality and optimizing with AI feedback')
      
      while (revisionCycle < agentThresholds.maxRevisionCycles) {
        console.log(`🔄 Evaluation cycle ${revisionCycle + 1} with knob effectiveness...`)
        
        const evaluationResult = await this.marketeer.evaluateDrafts(state, state.drafts!)
        if (!evaluationResult.success) {
          throw new Error(`Draft evaluation failed: ${evaluationResult.error}`)
        }

        state = { ...state, ...evaluationResult.state }
        
        // Check if revisions are needed
        if (!evaluationResult.instructions || evaluationResult.instructions.length === 0) {
          console.log('✅ All drafts meet quality standards with knob optimization')
          break
        }

        // Check if we should stop revising
        const allDraftsMeetThreshold = state.drafts!.every(draft => {
          const score = state.scores![draft.variantId || draft.platform]
          return score && 
                 score.composite! >= agentThresholds.minCompositeScore &&
                 score.brandRisk <= agentThresholds.maxBrandRisk &&
                 score.compliance
        })

        if (allDraftsMeetThreshold) {
          console.log('✅ All drafts meet quality thresholds with knob optimization')
          break
        }

        // Revise drafts
        console.log(`🔄 Revising ${evaluationResult.instructions.length} drafts with knob constraints...`)
        const revisedDrafts = await this.copywriter.reviseDrafts(
          state, 
          state.drafts!, 
          evaluationResult.instructions
        )
        state.drafts = revisedDrafts
        revisionCycle++
        
        console.log(`✅ Revision cycle ${revisionCycle} completed with knob optimization`)
      }

      // Step 4: Finalize Strategy with knob performance insights
      console.log('🔄 Finalizing strategy with knob optimization insights...')
      updateProgress('Finalizing Strategy', 4, 4, 'Optimizing final strategy and preparing content for publishing')
      
      const finalizationResult = await this.marketeer.finalizeStrategy(state)
      if (!finalizationResult.success) {
        throw new Error(`Strategy finalization failed: ${finalizationResult.error}`)
      }
      
      state = { ...state, ...finalizationResult.state }
      console.log('✅ Strategy finalized with knob optimization')
      console.log('📅 Schedule data received:', {
        hasSchedule: !!state.schedule,
        scheduleKeys: state.schedule ? Object.keys(state.schedule) : 'none',
        hasWindows: state.schedule?.windows ? 'yes' : 'no',
        windowsKeys: state.schedule?.windows ? Object.keys(state.schedule.windows) : 'none'
      })

      const finalProgress = updateProgress(
        'Workflow Complete',
        4,
        4,
        `Generated ${state.drafts?.length || 0} content variants with 4-knob optimization`
      )

      return {
        success: true,
        finalState: state,
        progress: finalProgress
      }

    } catch (error) {
      console.error('❌ Progressive workflow execution failed:', error)
      return {
        success: false,
        finalState: initialState,
        error: error instanceof Error ? error.message : 'Unknown workflow error',
        progress: {
          currentStep: 'Error',
          stepNumber: 0,
          totalSteps: 4,
          percentage: 0,
          details: error instanceof Error ? error.message : 'Unknown error',
          timestamp: Date.now()
        }
      }
    }
  }

  /**
   * Execute just the strategy planning phase with 4-knob optimization
   */
  async planStrategy(state: AgentState) {
    return await this.marketeer.planStrategy(state)
  }

  /**
   * Execute just the draft generation phase with knob payload
   */
  async generateDrafts(state: AgentState, count: number = 3) {
    return await this.copywriter.generateVariants(state, count)
  }

  /**
   * Execute just the draft evaluation phase with knob effectiveness
   */
  async evaluateDrafts(state: AgentState, drafts: Draft[]) {
    return await this.marketeer.evaluateDrafts(state, drafts)
  }

  /**
   * Execute just the strategy finalization phase with knob insights
   */
  async finalizeStrategy(state: AgentState) {
    return await this.marketeer.finalizeStrategy(state)
  }

  /**
   * Validate knob compliance with client policy and constraints
   */
  private validateKnobCompliance(knobs: Knobs, clientProfile: Record<string, unknown>): {
    isValid: boolean
    warnings: string[]
  } {
    const warnings: string[] = []
    const clientPolicy = clientProfile?.clientPolicy as Record<string, unknown> || {}
    
    // Check format type constraints
    if (!knobs.formatType || !['text', 'single_image', 'multi_image', 'document_pdf', 'video'].includes(knobs.formatType)) {
      warnings.push('Invalid format type specified')
    }
    
    // Check hook intensity constraints
    if (knobs.hookIntensity < 0 || knobs.hookIntensity > 1) {
      warnings.push('Hook intensity must be between 0.0 and 1.0')
    }
    
    if (clientPolicy.maxHookIntensity !== undefined && knobs.hookIntensity > (clientPolicy.maxHookIntensity as number)) {
      warnings.push(`Hook intensity ${knobs.hookIntensity} exceeds client maximum ${clientPolicy.maxHookIntensity}`)
    }
    
    // Check expertise depth constraints
    if (knobs.expertiseDepth < 0 || knobs.expertiseDepth > 1) {
      warnings.push('Expertise depth must be between 0.0 and 1.0')
    }
    
    // Check structure constraints
    if (!knobs.structure || typeof knobs.structure !== 'object') {
      warnings.push('Structure must be an object with lengthLevel and scanDensity')
    } else {
      if (knobs.structure.lengthLevel < 0 || knobs.structure.lengthLevel > 1) {
        warnings.push('Structure lengthLevel must be between 0.0 and 1.0')
      }
      if (knobs.structure.scanDensity < 0 || knobs.structure.scanDensity > 1) {
        warnings.push('Structure scanDensity must be between 0.0 and 1.0')
      }
    }
    
    // Check asset availability constraints
    if (knobs.formatType === 'multi_image' && (!clientProfile?.assets || (clientProfile.assets as unknown[]).length < 3)) {
      warnings.push('Multi-image format requires at least 3 assets')
    }
    
    if (knobs.formatType === 'document_pdf' && (!clientProfile?.assets || !(clientProfile.assets as unknown[]).some((a: unknown) => (a as Record<string, unknown>).type === 'document'))) {
      warnings.push('Document PDF format requires document assets')
    }
    
    if (knobs.formatType === 'video' && (!clientProfile?.assets || !(clientProfile.assets as unknown[]).some((a: unknown) => (a as Record<string, unknown>).type === 'video'))) {
      warnings.push('Video format requires video assets')
    }
    
    return {
      isValid: warnings.length === 0,
      warnings
    }
  }

  /**
   * Get workflow status and metrics with knob effectiveness
   */
  getWorkflowMetrics(state: AgentState) {
    const metrics = {
      totalDrafts: state.drafts?.length || 0,
      averageScore: 0,
      revisionCycles: 0,
      qualityStatus: 'unknown',
      knobEffectiveness: {
        formatType: 'unknown',
        hookIntensity: 'unknown',
        expertiseDepth: 'unknown',
        structure: 'unknown'
      },
      complianceStatus: 'unknown'
    }

    if (state.scores && Object.keys(state.scores).length > 0) {
      const scores = Object.values(state.scores)
      metrics.averageScore = scores.reduce((sum, score) => sum + (score.composite || 0), 0) / scores.length
      
      // Determine quality status
      const allHighQuality = scores.every(score => 
        score.composite! >= agentThresholds.minCompositeScore &&
        score.brandRisk <= agentThresholds.maxBrandRisk &&
        score.compliance
      )
      
      metrics.qualityStatus = allHighQuality ? 'high' : 'needs_improvement'
      
      // Analyze knob effectiveness
      if (state.knobs) {
        metrics.knobEffectiveness = this.analyzeKnobEffectiveness(state.knobs, scores)
      }
      
      // Check compliance status
      const complianceScores = scores.map(score => score.compliance)
      const complianceRate = complianceScores.filter(Boolean).length / complianceScores.length
      metrics.complianceStatus = complianceRate > 0.8 ? 'excellent' : 
                                 complianceRate > 0.6 ? 'good' : 
                                 complianceRate > 0.4 ? 'fair' : 'poor'
    }

    return metrics
  }

  /**
   * Analyze knob effectiveness based on scores
   */
  private analyzeKnobEffectiveness(knobs: Knobs, scores: Record<string, unknown>[]): {
    formatType: string
    hookIntensity: string
    expertiseDepth: string
    structure: string
  } {
    return {
      formatType: this.assessFormatTypeEffectiveness(knobs.formatType, scores),
      hookIntensity: this.assessHookIntensityEffectiveness(knobs.hookIntensity, scores),
      expertiseDepth: this.assessExpertiseDepthEffectiveness(knobs.expertiseDepth, scores),
      structure: this.assessStructureEffectiveness(knobs.structure, scores)
    }
  }

  /**
   * Assess format type effectiveness
   */
  private assessFormatTypeEffectiveness(formatType: string, scores: Record<string, unknown>[]): string {
    const avgScore = scores.reduce((sum, score) => sum + ((score.composite as number) || 0), 0) / scores.length
    
    if (avgScore > 0.8) return 'excellent'
    if (avgScore > 0.6) return 'good'
    if (avgScore > 0.4) return 'fair'
    return 'poor'
  }

  /**
   * Assess hook intensity effectiveness
   */
  private assessHookIntensityEffectiveness(hookIntensity: number, scores: Record<string, unknown>[]): string {
    // Hook intensity should correlate with readability and clarity
    const readabilityScores = scores.map(score => (score.readability as number) || 0)
    const avgReadability = readabilityScores.reduce((sum, score) => sum + score, 0) / readabilityScores.length
    
    if (hookIntensity > 0.7 && avgReadability > 0.8) return 'excellent'
    if (hookIntensity > 0.4 && avgReadability > 0.6) return 'good'
    if (hookIntensity > 0.2 && avgReadability > 0.4) return 'fair'
    return 'poor'
  }

  /**
   * Assess expertise depth effectiveness
   */
  private assessExpertiseDepthEffectiveness(expertiseDepth: number, scores: Record<string, unknown>[]): string {
    // Expertise depth should correlate with objective fit
    const objectiveFitScores = scores.map(score => (score.objectiveFit as number) || 0)
    const avgObjectiveFit = objectiveFitScores.reduce((sum, score) => sum + score, 0) / objectiveFitScores.length
    
    if (expertiseDepth > 0.8 && avgObjectiveFit > 0.8) return 'excellent'
    if (expertiseDepth > 0.4 && avgObjectiveFit > 0.6) return 'good'
    if (expertiseDepth > 0.2 && avgObjectiveFit > 0.4) return 'fair'
    return 'poor'
  }

  /**
   * Assess structure effectiveness
   */
  private assessStructureEffectiveness(structure: { lengthLevel: number; scanDensity: number }, scores: Record<string, unknown>[]): string {
    // Structure should correlate with readability
    const readabilityScores = scores.map(score => (score.readability as number) || 0)
    const avgReadability = readabilityScores.reduce((sum, score) => sum + score, 0) / readabilityScores.length
    
    if (structure.scanDensity > 0.7 && avgReadability > 0.8) return 'excellent'
    if (structure.scanDensity > 0.4 && avgReadability > 0.6) return 'good'
    if (structure.scanDensity > 0.2 && avgReadability > 0.4) return 'fair'
    return 'poor'
  }

  /**
   * Get knob optimization recommendations
   */
  getKnobOptimizationRecommendations(state: AgentState): {
    recommendations: string[]
    priority: 'high' | 'medium' | 'low'
  } {
    const recommendations: string[] = []
    const metrics = this.getWorkflowMetrics(state)
    
    if (metrics.knobEffectiveness.hookIntensity === 'poor') {
      recommendations.push('Consider reducing hook intensity for better readability')
    }
    
    if (metrics.knobEffectiveness.expertiseDepth === 'poor') {
      recommendations.push('Adjust expertise depth to better match audience and objective')
    }
    
    if (metrics.knobEffectiveness.structure === 'poor') {
      recommendations.push('Optimize structure for better scan-friendliness')
    }
    
    if (metrics.complianceStatus === 'poor') {
      recommendations.push('Review content for compliance with platform rules and client policy')
    }
    
    const priority = recommendations.length > 2 ? 'high' : 
                    recommendations.length > 1 ? 'medium' : 'low'
    
    return { recommendations, priority }
  }
}
