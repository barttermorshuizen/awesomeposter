import { getOpenAI } from '../llm'
import type { 
  AgentState, 
  Knobs, 
  Draft, 
  Scores, 
  RevisionInstruction,
  AgentResponse,
  AssetAnalysis,
  Asset,
  FormatType
} from '@awesomeposter/shared'
import { agentThresholds, scoringWeights } from '@awesomeposter/shared'

export class DigitalMarketeerAgent {
  private openai = getOpenAI()

  /**
   * Analyze available assets and determine achievable formats
   */
  async analyzeAssets(assets: Asset[]): Promise<AssetAnalysis> {
    try {
      // Group assets by type
      const images = assets.filter(a => a.type === 'image')
      const documents = assets.filter(a => a.type === 'document')
      const videos = assets.filter(a => a.type === 'video')

      // Analyze asset quality and capabilities
      const assetQuality = {
        images: {
          count: images.length,
          quality: this.assessImageQuality(images)
        },
        documents: {
          count: documents.length,
          hasSlides: documents.some(d => d.mimeType?.includes('pdf') || d.mimeType?.includes('presentation'))
        },
        videos: {
          count: videos.length,
          duration: undefined // Could be extracted from video metadata in future
        }
      }

      // Determine achievable formats
      const formatFeasibility = this.assessFormatFeasibility(assetQuality)
      const achievableFormats = Object.entries(formatFeasibility)
        .filter(([, assessment]) => assessment.feasible)
        .map(([format]) => format as FormatType)

      // Recommend best format
      const recommendedFormat = this.recommendBestFormat(assetQuality, achievableFormats)

      // Generate recommendations
      const recommendations = this.generateAssetRecommendations(assetQuality)

      return {
        availableAssets: assets,
        achievableFormats,
        recommendedFormat,
        assetQuality,
        formatFeasibility,
        recommendations
      }
    } catch (error) {
      console.error('Error in asset analysis:', error)
      // Return fallback analysis
      return {
        availableAssets: assets,
        achievableFormats: ['text'],
        recommendedFormat: 'text',
        assetQuality: {
          images: { count: 0, quality: 'low' },
          documents: { count: 0, hasSlides: false },
          videos: { count: 0, duration: undefined }
        },
        formatFeasibility: {
          text: { feasible: true, reason: 'Always available', assetRequirements: [] },
          single_image: { feasible: false, reason: 'No images available', assetRequirements: ['At least 1 image'] },
          multi_image: { feasible: false, reason: 'Insufficient images', assetRequirements: ['At least 3 images'] },
          document_pdf: { feasible: false, reason: 'No documents available', assetRequirements: ['PDF or presentation document'] },
          video: { feasible: false, reason: 'No video available', assetRequirements: ['Video file'] }
        },
        recommendations: ['Consider adding visual assets to enhance engagement']
      }
    }
  }

  /**
   * Assess image quality based on count and metadata
   */
  private assessImageQuality(images: Asset[]): 'high' | 'medium' | 'low' {
    if (images.length === 0) return 'low'
    if (images.length >= 3) return 'high'
    if (images.length >= 1) return 'medium'
    return 'low'
  }

  /**
   * Assess format feasibility based on available assets
   */
  private assessFormatFeasibility(assetQuality: {
    images: { count: number; quality: string };
    documents: { count: number; hasSlides: boolean };
    videos: { count: number; duration?: number };
  }) {
    return {
      text: {
        feasible: true,
        reason: 'Text format always available',
        assetRequirements: []
      },
      single_image: {
        feasible: assetQuality.images.count >= 1,
        reason: assetQuality.images.count >= 1 ? 'Sufficient images available' : 'At least 1 image required',
        assetRequirements: assetQuality.images.count >= 1 ? [] : ['At least 1 image']
      },
      multi_image: {
        feasible: assetQuality.images.count >= 3,
        reason: assetQuality.images.count >= 3 ? 'Sufficient images for multi-image format' : 'At least 3 images required',
        assetRequirements: assetQuality.images.count >= 3 ? [] : ['At least 3 images']
      },
      document_pdf: {
        feasible: assetQuality.documents.count >= 1 && assetQuality.documents.hasSlides,
        reason: assetQuality.documents.count >= 1 && assetQuality.documents.hasSlides 
          ? 'Document with slides available' 
          : 'PDF or presentation document required',
        assetRequirements: assetQuality.documents.count >= 1 && assetQuality.documents.hasSlides 
          ? [] 
          : ['PDF or presentation document']
      },
      video: {
        feasible: assetQuality.videos.count >= 1,
        reason: assetQuality.videos.count >= 1 ? 'Video available' : 'Video file required',
        assetRequirements: assetQuality.videos.count >= 1 ? [] : ['Video file']
      }
    }
  }

  /**
   * Recommend best format based on assets and objectives
   */
  private recommendBestFormat(
    assetQuality: {
      images: { count: number; quality: string };
      documents: { count: number; hasSlides: boolean };
      videos: { count: number; duration?: number };
    }, 
    achievableFormats: FormatType[]
  ): FormatType {
    // Priority order for format selection
    const formatPriority: FormatType[] = ['document_pdf', 'multi_image', 'single_image', 'video', 'text']
    
    // Find the highest priority achievable format
    for (const format of formatPriority) {
      if (achievableFormats.includes(format)) {
        return format
      }
    }
    
    return 'text' // Fallback
  }

  /**
   * Generate asset recommendations for improvement
   */
  private generateAssetRecommendations(
    assetQuality: {
      images: { count: number; quality: string };
      documents: { count: number; hasSlides: boolean };
      videos: { count: number; duration?: number };
    }
  ): string[] {
    const recommendations: string[] = []
    
    if (assetQuality.images.count === 0) {
      recommendations.push('Add at least 1-2 high-quality images to enable visual content formats')
    } else if (assetQuality.images.count < 3) {
      recommendations.push('Add more images (3+) to enable multi-image carousel formats')
    }
    
    if (assetQuality.documents.count === 0) {
      recommendations.push('Consider adding a PDF or presentation document for deep content formats')
    }
    
    if (assetQuality.videos.count === 0) {
      recommendations.push('Video content can significantly increase engagement - consider adding video assets')
    }
    
    if (recommendations.length === 0) {
      recommendations.push('Excellent asset variety - you can create any content format')
    }
    
    return recommendations
  }

  /**
   * Plan strategy and set 4-knob values based on brief and client profile
   */
  async planStrategy(state: AgentState): Promise<AgentResponse> {
    try {
      // Debug: log asset presence before analysis
      console.log('🧩 planStrategy received assets:', {
        hasAssetsArray: !!state.inputs?.assets,
        assetsCount: state.inputs?.assets?.length || 0,
        sample: (state.inputs?.assets || []).slice(0, 2).map(a => ({
          id: a.id, filename: a.filename, type: a.type, mimeType: a.mimeType
        }))
      })

      // First, analyze available assets if they exist
      let assetAnalysis: AssetAnalysis | undefined
      if (state.inputs.assets && state.inputs.assets.length > 0) {
        console.log('🔍 Analyzing available assets for format feasibility...')
        assetAnalysis = await this.analyzeAssets(state.inputs.assets)
        console.log('✅ Asset analysis completed:', {
          achievableFormats: assetAnalysis.achievableFormats,
          recommendedFormat: assetAnalysis.recommendedFormat,
          assetQuality: assetAnalysis.assetQuality
        })
      } else {
        console.log('⚠️ No assets available for analysis, using text format as fallback')
        assetAnalysis = {
          availableAssets: [],
          achievableFormats: ['text'],
          recommendedFormat: 'text',
          assetQuality: {
            images: { count: 0, quality: 'low' },
            documents: { count: 0, hasSlides: false },
            videos: { count: 0, duration: undefined }
          },
          formatFeasibility: {
            text: { feasible: true, reason: 'Always available', assetRequirements: [] },
            single_image: { feasible: false, reason: 'No images available', assetRequirements: ['At least 1 image'] },
            multi_image: { feasible: false, reason: 'Insufficient images', assetRequirements: ['At least 3 images'] },
            document_pdf: { feasible: false, reason: 'No documents available', assetRequirements: ['PDF or presentation document'] },
            video: { feasible: false, reason: 'No video available', assetRequirements: ['Video file'] }
          },
          recommendations: ['Consider adding visual assets to enhance engagement']
        }
      }

      const prompt = this.buildStrategyPrompt(state, assetAnalysis)
      
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are a Digital Marketeer agent specializing in social media strategy with 4-knob optimization. 
            Your role is to analyze briefs, client profiles, and available assets to create strategic content plans.
            Always respond with valid JSON that can be parsed directly.
            
            The 4-knob system consists of:
            1. formatType: Choose from 'text', 'single_image', 'multi_image', 'document_pdf', 'video' - MUST be achievable with available assets
            2. hookIntensity: 0.0-1.0 scale for opening line strength
            3. expertiseDepth: 0.0-1.0 scale for practitioner-level specificity
            4. structure: Object with lengthLevel (0.0-1.0) and scanDensity (0.0-1.0)
            
            CRITICAL CONSTRAINTS:
            - The formatType MUST be achievable with the available assets
            - NEVER choose a format that requires assets you don't have
            - If brief requests a format that's not achievable, choose the best achievable alternative
            - Consider client policy constraints and historical performance when setting knobs`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 500
      })

      console.log('🔍 OpenAI Response Object:', {
        hasChoices: !!response.choices,
        choicesLength: response.choices?.length || 0,
        firstChoice: response.choices?.[0] ? {
          hasMessage: !!response.choices[0].message,
          messageRole: response.choices[0].message?.role,
          hasContent: !!response.choices[0].message?.content,
          contentLength: response.choices[0].message?.content?.length || 0
        } : 'no first choice'
      })
      
      const content = response.choices[0]?.message?.content
      if (!content) {
        console.error('❌ Response structure issue:', {
          choices: response.choices,
          firstChoice: response.choices?.[0],
          message: response.choices?.[0]?.message,
          responseKeys: Object.keys(response)
        })
        throw new Error('No response content from OpenAI')
      }

      const strategyData = JSON.parse(content)
      
      console.log('🔍 AI Response Structure:', {
        hasKnobs: !!strategyData.knobs,
        hasStrategy: !!strategyData.strategy,
        responseKeys: Object.keys(strategyData),
        knobsKeys: strategyData.knobs ? Object.keys(strategyData.knobs) : 'none',
        strategyKeys: strategyData.strategy ? Object.keys(strategyData.strategy) : 'none'
      })
      
      console.log('🔍 Raw AI Response:', JSON.stringify(strategyData, null, 2))
      
      // Validate that the AI returned the expected structure
      if (!strategyData.knobs) {
        console.warn('⚠️ AI did not return knobs, creating default structure')
        strategyData.knobs = {
          formatType: assetAnalysis?.recommendedFormat || 'text',
          hookIntensity: 0.6,
          expertiseDepth: 0.7,
          structure: {
            lengthLevel: 0.6,
            scanDensity: 0.8
          }
        }
        console.log('✅ Created fallback knobs:', strategyData.knobs)
      } else {
        // STRICT VALIDATION: Ensure the chosen format type is achievable with available assets
        if (assetAnalysis && !assetAnalysis.achievableFormats.includes(strategyData.knobs.formatType)) {
          console.warn(`🚨 AI chose format type '${strategyData.knobs.formatType}' but it's NOT achievable with available assets!`)
          console.log('🔄 Available formats:', assetAnalysis.achievableFormats)
          console.log('🔄 Forcing fallback to recommended format:', assetAnalysis.recommendedFormat)
          
          // Override the AI's choice with an achievable format
          strategyData.knobs.formatType = assetAnalysis.recommendedFormat
          
          // Add a note about the override
          if (strategyData.rationale) {
            strategyData.rationale += ` [NOTE: Format changed from '${strategyData.knobs.formatType}' to '${assetAnalysis.recommendedFormat}' due to insufficient assets]`
          }
        }
      }
      
      // Ensure strategy has the expected format
      if (!strategyData.strategy) {
        console.warn('⚠️ AI did not return strategy, creating from response data')
        strategyData.strategy = {
          platforms: strategyData.platforms || ['linkedin'],
          structure: strategyData.structure || 'hook → insight → CTA',
          themes: strategyData.themes || ['professional'],
          hashtags: strategyData.hashtags || ['#business'],
          timing: strategyData.timing || 'optimal business hours'
        }
        console.log('✅ Created fallback strategy:', strategyData.strategy)
      }
      
      // Validate and constrain knob values
      if (state.inputs.clientProfile) {
        const validatedKnobs = this.validateKnobCompliance(strategyData.knobs, state.inputs.clientProfile)
        
        // Prepare assets for knob payload
        const assets = this.prepareAssetsForKnobPayload(state.inputs.assets || [])
        
        const response = {
          success: true,
          state: {
            knobs: validatedKnobs,
            strategy: strategyData.strategy,
            rationale: strategyData.rationale,
            assetAnalysis,
            knobPayload: {
              formatType: validatedKnobs.formatType,
              hookIntensity: validatedKnobs.hookIntensity,
              expertiseDepth: validatedKnobs.expertiseDepth,
              structure: validatedKnobs.structure,
              assets,
              clientPolicy: {
                voice: "balanced" as const,
                emojiAllowed: true,
                maxHookIntensity: 0.85,
                bannedClaims: []
              }
            }
          }
        }
        
        console.log('🚀 Returning to orchestrator:', {
          hasKnobs: !!response.state.knobs,
          knobsKeys: response.state.knobs ? Object.keys(response.state.knobs) : 'none',
          hasStrategy: !!response.state.strategy,
          strategyKeys: response.state.strategy ? Object.keys(response.state.strategy) : 'none',
          hasAssetAnalysis: !!response.state.assetAnalysis
        })
        
        return response
      } else {
        const response = {
          success: true,
          state: {
            knobs: strategyData.knobs,
            strategy: strategyData.strategy,
            rationale: strategyData.rationale,
            assetAnalysis
          }
        }
        
        console.log('🚀 Returning to orchestrator (no client profile):', {
          hasKnobs: !!response.state.knobs,
          knobsKeys: response.state.knobs ? Object.keys(response.state.knobs) : 'none',
          hasStrategy: !!response.state.strategy,
          strategyKeys: response.state.strategy ? Object.keys(response.state.strategy) : 'none',
          hasAssetAnalysis: !!response.state.assetAnalysis
        })
        
        return response
      }
    } catch (error) {
      console.error('Error in planStrategy:', error)
      return {
        success: false,
        state: {},
        error: error instanceof Error ? error.message : 'Unknown error in strategy planning'
      }
    }
  }

  /**
   * Evaluate and score draft variants with knob effectiveness consideration
   */
  async evaluateDrafts(state: AgentState, drafts: Draft[]): Promise<AgentResponse> {
    try {
      const scores: Record<string, Scores> = {}
      const instructions: RevisionInstruction[] = []

      for (const draft of drafts) {
        const score = await this.scoreDraft(state, draft)
        scores[draft.variantId || draft.platform] = score

        // Check if revision is needed
        if (score.composite && score.composite < agentThresholds.minCompositeScore) {
          instructions.push(this.generateRevisionInstruction(draft, score))
        }
      }

      return {
        success: true,
        state: { scores },
        instructions: instructions.length > 0 ? instructions : undefined
      }
    } catch (error) {
      console.error('Error in evaluateDrafts:', error)
      return {
        success: false,
        state: {},
        error: error instanceof Error ? error.message : 'Unknown error in draft evaluation'
      }
    }
  }

  /**
   * Finalize strategy and prepare for publishing
   */
  async finalizeStrategy(state: AgentState): Promise<AgentResponse> {
    try {
      const prompt = this.buildFinalizationPrompt(state)
      
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are finalizing a social media strategy with 4-knob optimization. Provide publishing recommendations,
            UTM parameters, and a final rationale for the selected variants. Consider how the knob settings will impact performance.`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 800
      })

      const content = response.choices[0]?.message?.content
      if (!content) {
        throw new Error('No response content from OpenAI')
      }

      console.log('🔍 Raw AI response for finalization:', content)

      let finalizationData
      try {
        finalizationData = JSON.parse(content)
      } catch (parseError) {
        console.error('❌ Failed to parse AI response as JSON:', parseError)
        console.error('Raw content:', content)
        throw new Error('AI response is not valid JSON')
      }

      console.log('📅 Parsed finalization data:', {
        hasSchedule: !!finalizationData.schedule,
        scheduleKeys: finalizationData.schedule ? Object.keys(finalizationData.schedule) : 'none',
        hasWindows: finalizationData.schedule?.windows ? 'yes' : 'no',
        windowsKeys: finalizationData.schedule?.windows ? Object.keys(finalizationData.schedule.windows) : 'none'
      })

      // Ensure schedule data has the correct structure
      let schedule = finalizationData.schedule
      if (!schedule || !schedule.windows || Object.keys(schedule.windows).length === 0) {
        console.log('⚠️ AI did not provide proper schedule data, generating fallback...')
        schedule = this.generateFallbackSchedule(state)
      }
      
      return {
        success: true,
        state: {
          schedule,
          deliverables: finalizationData.deliverables
        }
      }
    } catch (error) {
      console.error('Error in finalizeStrategy:', error)
      return {
        success: false,
        state: {},
        error: error instanceof Error ? error.message : 'Unknown error in strategy finalization'
      }
    }
  }

  /**
   * Score a single draft variant with knob effectiveness
   */
  private async scoreDraft(state: AgentState, draft: Draft): Promise<Scores> {
    const prompt = this.buildScoringPrompt(state, draft)
    
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are evaluating social media content with 4-knob optimization. Score the given post on multiple dimensions
          and provide a composite score. Consider how well the content aligns with the knob settings.
          Always respond with valid JSON.`
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 500
    })

    const content = response.choices[0]?.message?.content
    if (!content) {
      throw new Error('No scoring response from OpenAI')
    }

    const scores: Scores = JSON.parse(content)
    
    // Calculate composite score with knob effectiveness adjustment
    scores.composite = this.calculateCompositeScore(scores, state.knobs)
    
    return scores
  }

  /**
   * Calculate composite score using weighted formula with knob effectiveness
   */
  private calculateCompositeScore(scores: Scores, knobs?: Knobs): number {
    const { readability, objectiveFit, clarity, brandRisk } = scores
    const weights = scoringWeights
    
    let baseScore = (
      weights.readability * readability +
      weights.objectiveFit * objectiveFit +
      weights.clarity * clarity +
      weights.brandRisk * brandRisk
    )
    
    // Apply knob effectiveness adjustments if knobs are available
    if (knobs) {
      const knobAdjustment = this.calculateKnobAdjustment(scores, knobs)
      baseScore = Math.min(1.0, Math.max(0.0, baseScore + knobAdjustment))
    }
    
    return baseScore
  }

  /**
   * Calculate knob effectiveness adjustment
   */
  private calculateKnobAdjustment(scores: Scores, knobs: Knobs): number {
    let adjustment = 0
    
    // Format type effectiveness
    if (knobs.formatType === 'document_pdf' && scores.objectiveFit > 0.8) {
      adjustment += 0.05 // Bonus for deep content when objective fits
    }
    
    // Hook intensity effectiveness
    if (knobs.hookIntensity > 0.7 && scores.readability > 0.8) {
      adjustment += 0.03 // Bonus for strong hooks with good readability
    }
    
    // Expertise depth effectiveness
    if (knobs.expertiseDepth > 0.8 && scores.objectiveFit > 0.8) {
      adjustment += 0.03 // Bonus for deep expertise when objective fits
    }
    
    // Structure effectiveness
    if (knobs.structure.scanDensity > 0.8 && scores.readability > 0.8) {
      adjustment += 0.02 // Bonus for scan-optimized content with good readability
    }
    
    return adjustment
  }

  /**
   * Validate knob compliance with client policy and constraints
   */
  private validateKnobCompliance(knobs: Knobs, clientProfile: Record<string, unknown>): Knobs {
    const clientPolicy = clientProfile?.clientPolicy as Record<string, unknown> || {}
    
    // Apply client policy constraints
    const validatedKnobs = { ...knobs }
    
    // Hook intensity constraint
    if (clientPolicy.maxHookIntensity !== undefined) {
      validatedKnobs.hookIntensity = Math.min(knobs.hookIntensity, clientPolicy.maxHookIntensity as number)
    }
    
    // Emoji constraint
    if (clientPolicy.emojiAllowed === false) {
      // This will be handled in the copywriter agent
    }
    
    // Apply global constraints
    validatedKnobs.hookIntensity = Math.max(0.0, Math.min(1.0, validatedKnobs.hookIntensity))
    validatedKnobs.expertiseDepth = Math.max(0.0, Math.min(1.0, validatedKnobs.expertiseDepth))
    validatedKnobs.structure.lengthLevel = Math.max(0.0, Math.min(1.0, validatedKnobs.structure.lengthLevel))
    validatedKnobs.structure.scanDensity = Math.max(0.0, Math.min(1.0, validatedKnobs.structure.scanDensity))
    
    return validatedKnobs
  }

  /**
   * Generate revision instructions for low-scoring variants
   */
  private generateRevisionInstruction(draft: Draft, scores: Scores): RevisionInstruction {
    const feedback = this.generateFeedback(scores)
    const priority = scores.composite && scores.composite < 0.6 ? 'high' : 'medium'
    
    return {
      variantId: draft.variantId || draft.platform,
      feedback,
      suggestedChanges: this.suggestChanges(scores),
      priority
    }
  }

  /**
   * Generate feedback based on scores
   */
  private generateFeedback(scores: Scores): string {
    const feedbacks: string[] = []
    
    if (scores.readability < 0.7) {
      feedbacks.push('Improve readability with shorter sentences and clearer language')
    }
    if (scores.clarity < 0.7) {
      feedbacks.push('Clarify the main message and reduce ambiguity')
    }
    if (scores.objectiveFit < 0.7) {
      feedbacks.push('Better align with the campaign objective')
    }
    if (scores.brandRisk > 0.3) {
      feedbacks.push('Address potential brand safety concerns')
    }
    
    return feedbacks.join('. ') || 'Content meets quality standards'
  }

  /**
   * Suggest specific changes based on scores
   */
  private suggestChanges(scores: Scores): string[] {
    const suggestions: string[] = []
    
    if (scores.readability < 0.7) {
      suggestions.push('Break long sentences into shorter ones')
      suggestions.push('Use simpler vocabulary')
    }
    if (scores.clarity < 0.7) {
      suggestions.push('Add a clear hook in the first line')
      suggestions.push('Simplify the call-to-action')
    }
    if (scores.objectiveFit < 0.7) {
      suggestions.push('Reference the campaign goal more explicitly')
      suggestions.push('Align tone with target audience')
    }
    
    return suggestions
  }

  /**
   * Build prompt for 4-knob strategy planning
   */
  private buildStrategyPrompt(state: AgentState, assetAnalysis: AssetAnalysis): string {
    const { brief, clientProfile } = state.inputs
    
    const languageContext = clientProfile?.primaryCommunicationLanguage 
      ? `\n\n🚨 CRITICAL LANGUAGE REQUIREMENT: The client's primary communication language is ${clientProfile.primaryCommunicationLanguage}. ALL content must be optimized for this language and cultural context.`
      : '\n\n🚨 CRITICAL LANGUAGE REQUIREMENT: The client\'s primary communication language is not specified, defaulting to US English.';
    
    const assetContext = `\n\n📁 ASSET ANALYSIS & FORMAT FEASIBILITY:
Available Assets: ${assetAnalysis.availableAssets.length} total
- Images: ${assetAnalysis.assetQuality.images.count} (${assetAnalysis.assetQuality.images.quality} quality)
- Documents: ${assetAnalysis.assetQuality.documents.count} (${assetAnalysis.assetQuality.documents.hasSlides ? 'includes slides' : 'no slides'})
- Videos: ${assetAnalysis.assetQuality.videos.count}

Achievable Formats: ${assetAnalysis.achievableFormats.join(', ')}
Recommended Format: ${assetAnalysis.recommendedFormat}

🚨 CRITICAL FORMAT SELECTION RULES:
- You MUST ONLY choose from the achievable formats listed above
- NEVER choose a format that requires assets you don't have
- If the brief requests a format that's not achievable, choose the best achievable alternative
- The formatType field MUST be one of: ${assetAnalysis.achievableFormats.join(', ')}`;
    
    const clientProfileText = clientProfile ? `Client Profile:
- Primary Language: ${clientProfile.primaryCommunicationLanguage || 'US English (default)'}
- Objectives: ${clientProfile.objectivesJson?.primary || 'Increase brand awareness'}, ${clientProfile.objectivesJson?.secondary || 'Drive engagement'}
- Target Audience: ${clientProfile.audiencesJson?.target || 'General professional audience'}
- Demographics: ${clientProfile.audiencesJson?.demographics || 'Professionals and decision makers'}
- Interests: ${Array.isArray(clientProfile.audiencesJson?.interests) && clientProfile.audiencesJson.interests.length > 0 ? clientProfile.audiencesJson.interests.join(', ') : 'Professional development, industry trends'}
- Pain Points: ${Array.isArray(clientProfile.audiencesJson?.painPoints) && clientProfile.audiencesJson.painPoints.length > 0 ? clientProfile.audiencesJson.painPoints.join(', ') : 'Information overload, time constraints'}
- Tone: ${clientProfile.toneJson?.style || 'Professional'}, ${clientProfile.toneJson?.personality || 'Friendly'}
- Voice: ${clientProfile.toneJson?.voice || 'Balanced'}
${clientProfile.specialInstructionsJson?.instructions ? `- Special Instructions: ${clientProfile.specialInstructionsJson.instructions}` : ''}
${clientProfile.platformPrefsJson?.primary || clientProfile.platformPrefsJson?.secondary ? `- Platform Preferences: ${[clientProfile.platformPrefsJson?.primary, clientProfile.platformPrefsJson?.secondary].filter(Boolean).join(', ')}` : ''}
${clientProfile.platformPrefsJson?.focus ? `- Focus: ${clientProfile.platformPrefsJson.focus}` : ''}
${(() => {
  const banned = Array.isArray(clientProfile.guardrailsJson?.banned) && clientProfile.guardrailsJson.banned.length > 0 ? `Banned topics (${clientProfile.guardrailsJson.banned.join(', ')})` : '';
  const sensitive = Array.isArray(clientProfile.guardrailsJson?.sensitive) && clientProfile.guardrailsJson.sensitive.length > 0 ? `Sensitive topics (${clientProfile.guardrailsJson.sensitive.join(', ')})` : '';
  const required = Array.isArray(clientProfile.guardrailsJson?.required) && clientProfile.guardrailsJson.required.length > 0 ? `Required elements (${clientProfile.guardrailsJson.required.join(', ')})` : '';
  const parts = [banned, sensitive, required].filter(Boolean);
  return parts.length ? `- Guardrails: ${parts.join(', ')}` : '';
})()}` : 'Client Profile: Not provided';

    return `You are a digital marketing strategist agent.  
Your task is to design a **tailored social media strategy** for the given client and brief.  
Do not copy the examples below; instead, generate new content that fits the context.${languageContext}${assetContext}

Brief: ${brief.title}  
Description: ${brief.description || 'Not provided'}  
${clientProfileText}

Your output must be **valid JSON** in the following structure:

{
  "knobs": {
    "formatType": "<choose: text | single_image | multi_image | document_pdf | video>",
    "hookIntensity": "<float 0–1, how strong the attention-grabbing opening should be>",
    "expertiseDepth": "<float 0–1, how deep and authoritative the content should sound>",
    "structure": {
      "lengthLevel": "<float 0–1, length of post>",
      "scanDensity": "<float 0–1, how easy to scan with bullets/line breaks>"
    }
  },
  "strategy": {
    "platforms": ["<choose 1-2 platforms based on client profile and brief, e.g. linkedin>"],
    "structure": "<describe the post flow, e.g. 'hook → story → insight → CTA'>",
    "themes": ["<themes relevant to the brand/brief>"],
    "hashtags": ["<hashtags relevant to the themes/platform>"],
    "timing": "<best posting time for target audience>"
  },
  "rationale": "<explain why this strategy and knob settings make sense for this client and brief>"
}

CRITICAL REQUIREMENTS:
- Do not copy placeholders.  
- Every field must be context-specific and justified by the brief and client profile.  
- "rationale" must explain the reasoning behind platform choice, tone, knob settings, and timing.
- Consider the client's language preference when planning hashtags, themes, and cultural context.
- **🚨 FORMAT SELECTION IS RESTRICTED: You MUST ONLY choose from the achievable formats: ${assetAnalysis.achievableFormats.join(', ')}**
- **🚨 NEVER choose a format that requires assets you don't have**
- **🚨 If the brief requests an unachievable format, choose the best achievable alternative and explain why in the rationale**`
  }

  /**
   * Build prompt for draft scoring with knob consideration
   */
  private buildScoringPrompt(state: AgentState, draft: Draft): string {
    const { brief, clientProfile } = state.inputs
    const { knobs } = state
    
    const languageContext = clientProfile?.primaryCommunicationLanguage 
      ? `\n\n🚨 CRITICAL LANGUAGE REQUIREMENT: The client's primary communication language is ${clientProfile.primaryCommunicationLanguage}. Consider language appropriateness and cultural context when scoring.`
      : `\n\n🚨 CRITICAL LANGUAGE REQUIREMENT: The client's primary communication language is not specified, defaulting to US English.`
    
    return `Score this social media post considering the 4-knob optimization settings:${languageContext}

Post: ${draft.post}
Platform: ${draft.platform}
Brief Objective: ${brief.objective || 'Not specified'}

Current Knob Settings:
- Format Type: ${knobs?.formatType || 'Not set'}
- Hook Intensity: ${knobs?.hookIntensity || 'Not set'}
- Expertise Depth: ${knobs?.expertiseDepth || 'Not set'}
- Structure: ${knobs?.structure ? `Length: ${knobs.structure.lengthLevel}, Scan: ${knobs.structure.scanDensity}` : 'Not set'}

Client Profile: ${JSON.stringify(clientProfile, null, 2)}

Score on a 0-1 scale:
- readability: how easy to read and understand
- clarity: how clear the message is
- objectiveFit: how well it meets the campaign goal
- brandRisk: potential brand safety issues (0 = safe, 1 = risky)
- compliance: true if meets platform rules and legal requirements

Consider how well the content aligns with the knob settings:
- Does the format type match the content structure?
- Does the hook intensity match the opening line strength?
- Does the expertise depth match the technical level?
- Does the structure match the readability and scan-friendliness?
- Does the content use appropriate language and cultural context for the client?

Provide only the JSON response with these scores.`
  }

  /**
   * Build prompt for strategy finalization with knob optimization
   */
  private buildFinalizationPrompt(state: AgentState): string {
    const { inputs, strategy, knobs } = state
    const { brief } = inputs
    const platforms = strategy?.platforms || ['linkedin']
    
    // Create platform-specific examples based on actual strategy
    const platformExamples = platforms.map(platform => {
      switch (platform.toLowerCase()) {
        case 'linkedin':
          return `"linkedin": "Tuesday 09:00 CET"`
        case 'twitter':
        case 'x':
          return `"${platform}": "Monday 10:00 CET"`
        case 'instagram':
          return `"instagram": "Tuesday 12:00 CET"`
        case 'facebook':
          return `"facebook": "Monday 09:00 CET"`
        default:
          return `"${platform}": "Tuesday 10:00 CET"`
      }
    }).join(',\n      ')
    
    return `Finalize the strategy for this brief with 4-knob optimization:

Brief: ${brief.title}
Strategy: ${JSON.stringify(strategy, null, 2)}
Knob Settings: ${JSON.stringify(knobs, null, 2)}

IMPORTANT: Only include platforms that are specified in the strategy: ${platforms.join(', ')}

Provide a JSON response with the EXACT structure:

{
  "schedule": {
    "windows": {
      ${platformExamples}
    }
  },
  "deliverables": {
    "utm": "utm_source=platform&utm_medium=organic&utm_campaign=brief_title",
    "finalPosts": [],
    "rationale": "Explanation of timing and strategy decisions"
  }
}

CRITICAL REQUIREMENTS:
1. The schedule.windows object MUST ONLY contain platforms specified in the strategy: ${platforms.join(', ')}
2. DO NOT include platforms that are not in the strategy
3. Each platform should have ONE optimal posting time in CET timezone (not multiple times)
4. Times should be realistic for the target audience (e.g., 09:00-18:00 CET for business platforms)
5. The deliverables.utm should include proper UTM parameters for tracking
6. The rationale should explain why this specific time was chosen for each platform

Consider how the knob settings will impact performance:
- Format type affects content depth and engagement
- Hook intensity affects initial attention and see-more clicks
- Expertise depth affects audience retention and sharing
- Structure affects readability and platform optimization

Focus on optimal timing and tracking setup for the campaign.`
  }

  /**
   * Generate fallback schedule when AI doesn't provide proper schedule data
   */
  private generateFallbackSchedule(state: AgentState): { windows: Record<string, string> } {
    const platforms = state.strategy?.platforms || ['linkedin']
    
    const schedule: { windows: Record<string, string> } = {
      windows: {}
    }
    
    // Generate ONE optimal posting time ONLY for platforms specified in the strategy
    platforms.forEach(platform => {
      switch (platform.toLowerCase()) {
        case 'linkedin':
          schedule.windows[platform] = 'Tuesday 09:00 CET'
          break
        case 'twitter':
        case 'x':
          schedule.windows[platform] = 'Monday 10:00 CET'
          break
        case 'instagram':
          schedule.windows[platform] = 'Tuesday 12:00 CET'
          break
        case 'facebook':
          schedule.windows[platform] = 'Monday 09:00 CET'
          break
        default:
          // For any other platform specified in strategy, use generic business hours
          schedule.windows[platform] = 'Tuesday 10:00 CET'
      }
    })
    
    console.log('📅 Generated fallback schedule for platforms:', platforms, 'Schedule:', schedule)
    return schedule
  }

  /**
   * Prepare assets for the knob payload
   */
  private prepareAssetsForKnobPayload(assets: Asset[]): {
    images: Asset[];
    pdfUrl: string | null;
    slidesMarkdown: string | null;
    videoUrl: string | null;
  } {
    const images: Asset[] = []
    let pdfUrl: string | null = null
    let slidesMarkdown: string | null = null
    let videoUrl: string | null = null

    for (const asset of assets) {
      if (asset.type === 'image') {
        images.push(asset)
      } else if (asset.type === 'document' && asset.mimeType?.includes('pdf')) {
        pdfUrl = asset.url
      } else if (asset.type === 'document' && asset.mimeType?.includes('presentation')) {
        slidesMarkdown = asset.url // Assuming slides are in markdown format
      } else if (asset.type === 'video') {
        videoUrl = asset.url
      }
    }

    return {
      images,
      pdfUrl,
      slidesMarkdown,
      videoUrl
    }
  }
}
