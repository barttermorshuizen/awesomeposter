import { getOpenAI } from '../llm'
import type { 
  AgentState, 
  Draft, 
  Knobs,
  KnobPayload
} from '@awesomeposter/shared'
import { platformRules } from '@awesomeposter/shared'

export class CopywriterAgent {
  private openai = getOpenAI()

  /**
   * Generate multiple post variants based on 4-knob strategy
   */
  async generateVariants(state: AgentState, count: number = 3): Promise<Draft[]> {
    try {
      const { strategy, knobs } = state
      if (!strategy || !knobs) {
        throw new Error('Strategy and knobs are required for variant generation')
      }

      // Ensure platforms are available
      if (!strategy.platforms || strategy.platforms.length === 0) {
        console.warn('⚠️ No platforms specified in strategy, defaulting to LinkedIn')
        strategy.platforms = ['linkedin']
      }

      console.log('🔄 Generating variants for platforms:', strategy.platforms)
      const variants: Draft[] = []
      
      // Generate variants for each platform
      for (const platform of strategy.platforms) {
        console.log(`🔄 Generating variants for ${platform}...`)
        const platformVariants = await this.generatePlatformVariants(
          state, 
          platform, 
          Math.ceil(count / strategy.platforms.length)
        )
        variants.push(...platformVariants)
        console.log(`✅ Generated ${platformVariants.length} variants for ${platform}`)
      }

      console.log(`✅ Total variants generated: ${variants.length}`)
      return variants
    } catch (error) {
      console.error('Error in generateVariants:', error)
      throw error
    }
  }

  /**
   * Revise drafts based on feedback from the digital marketeer
   */
  async reviseDrafts(
    state: AgentState, 
    drafts: Draft[], 
    revisionInstructions: Record<string, unknown>[]
  ): Promise<Draft[]> {
    try {
      const revisedDrafts: Draft[] = []

      for (const draft of drafts) {
        const instruction = revisionInstructions.find(
          inst => inst.variantId === draft.variantId || inst.variantId === draft.platform
        )
        
        if (instruction) {
          const revised = await this.reviseDraft(state, draft, instruction)
          revisedDrafts.push(revised)
        } else {
          revisedDrafts.push(draft) // Keep unchanged
        }
      }

      return revisedDrafts
    } catch (error) {
      console.error('Error in reviseDrafts:', error)
      throw error
    }
  }

  /**
   * Generate variants for a specific platform with 4-knob optimization
   */
  private async generatePlatformVariants(
    state: AgentState, 
    platform: string, 
    count: number
  ): Promise<Draft[]> {
    const prompt = this.buildGenerationPrompt(state, platform, count)
    console.log('\n===== Copywriter Generation Prompt =====')
    console.log(`Platform: ${platform} | Variants: ${count}`)
    console.log(prompt)
    console.log('===== End Copywriter Generation Prompt =====\n')
    
          const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are a Copywriter agent specializing in social media content creation with 4-knob optimization. 
            Generate engaging, platform-optimized posts based on the provided strategy and knob settings.
            Always respond with valid JSON that can be parsed directly.
            
            CRITICAL LANGUAGE REQUIREMENT: You MUST write all content in ${state.inputs.clientProfile?.primaryCommunicationLanguage || 'US English (default)'}. This is the client's primary communication language and all content must be culturally and linguistically appropriate for this language.
            
            The 4-knob system guides your content creation:
            1. formatType: Determines content structure and asset usage
            2. hookIntensity: Controls opening line strength and attention-grabbing
            3. expertiseDepth: Sets technical level and practitioner specificity
            4. structure: Defines length and scan-friendliness`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 1500
    })

    const content = response.choices[0]?.message?.content
    if (!content) {
      throw new Error('No response content from OpenAI')
    }

    const variantsData = JSON.parse(content)
    const variants: Draft[] = variantsData.variants || []

    // Add platform-specific metadata and apply knob constraints
    return variants.map((variant: Record<string, unknown>, index: number) => {
      if (!state.knobs) {
        throw new Error('Knobs are required for variant generation')
      }
      
      const enhancedVariant = this.applyKnobConstraints(variant, state.knobs, state.knobPayload)
      return {
        ...enhancedVariant,
        platform,
        variantId: `${platform}-${index + 1}`,
        post: enhancedVariant.post as string,
        charCount: (enhancedVariant.post as string).length,
        altText: (enhancedVariant.altText as string) || this.generateAltText(enhancedVariant.post as string, platform),
        formatType: state.knobs.formatType,
        usedAssets: (enhancedVariant.usedAssets as string[]) || [],
        sectionsCount: (enhancedVariant.sectionsCount as number) || 1,
        hookLine: (enhancedVariant.hookLine as string) || (enhancedVariant.post as string).split('\n')[0]
      } as Draft
    })
  }

  /**
   * Apply knob constraints and format-specific rendering rules
   */
  private applyKnobConstraints(variant: Record<string, unknown>, knobs: Knobs, knobPayload?: KnobPayload): Record<string, unknown> {
    let enhancedVariant = { ...variant }
    const clientPolicy = knobPayload?.clientPolicy || {}
    
    // Apply format type rendering rules
    enhancedVariant = this.applyFormatTypeRules(enhancedVariant, knobs.formatType)
    
    // Apply hook intensity constraints
    enhancedVariant = this.applyHookIntensityRules(enhancedVariant, knobs.hookIntensity, clientPolicy)
    
    // Apply expertise depth constraints
    enhancedVariant = this.applyExpertiseDepthRules(enhancedVariant, knobs.expertiseDepth)
    
    // Apply structure constraints
    enhancedVariant = this.applyStructureRules(enhancedVariant, knobs.structure)
    
    // Apply client policy constraints
    enhancedVariant = this.applyClientPolicyRules(enhancedVariant, clientPolicy)
    
    return enhancedVariant
  }

  /**
   * Apply format type specific rendering rules
   */
  private applyFormatTypeRules(variant: Record<string, unknown>, formatType: string): Record<string, unknown> {
    switch (formatType) {
      case 'document_pdf':
        // Deep content with clear sections and structure
        return {
          ...variant,
          post: this.structureAsDocument(variant.post as string),
          sectionsCount: this.countSections(variant.post as string),
          usedAssets: ['document_pdf']
        }
      
      case 'multi_image':
        // Step-by-step content with clear visual breaks
        return {
          ...variant,
          post: this.structureAsMultiImage(variant.post as string),
          sectionsCount: this.countSections(variant.post as string),
          usedAssets: ['image1', 'image2', 'image3']
        }
      
      case 'single_image':
        // Single insight with supporting image
        return {
          ...variant,
          post: this.structureAsSingleImage(variant.post as string),
          sectionsCount: 2,
          usedAssets: ['image1']
        }
      
      case 'video':
        // Dynamic content with clear hook and CTA
        return {
          ...variant,
          post: this.structureAsVideo(variant.post as string),
          sectionsCount: 3,
          usedAssets: ['video1']
        }
      
      case 'text':
      default:
        // Pure text content optimized for scanning
        return {
          ...variant,
          post: this.structureAsText(variant.post as string),
          sectionsCount: this.countSections(variant.post as string),
          usedAssets: []
        }
    }
  }

  /**
   * Apply hook intensity rules
   */
  private applyHookIntensityRules(variant: Record<string, unknown>, hookIntensity: number, clientPolicy: Record<string, unknown>): Record<string, unknown> {
    let post = variant.post as string
    const maxHookIntensity = (clientPolicy.maxHookIntensity as number) || 1.0
    const actualHookIntensity = Math.min(hookIntensity, maxHookIntensity)
    
    if (actualHookIntensity > 0.7) {
      // High hook intensity: bold, attention-grabbing opening
      post = this.createBoldHook(post)
    } else if (actualHookIntensity > 0.4) {
      // Medium hook intensity: balanced, professional opening
      post = this.createBalancedHook(post)
    } else {
      // Low hook intensity: subtle, educational opening
      post = this.createSubtleHook(post)
    }
    
    return {
      ...variant,
      post,
      hookLine: post.split('\n')[0]
    }
  }

  /**
   * Apply expertise depth rules
   */
  private applyExpertiseDepthRules(variant: Record<string, unknown>, expertiseDepth: number): Record<string, unknown> {
    let post = variant.post as string
    
    if (expertiseDepth > 0.8) {
      // High expertise: technical terms, practitioner-level insights
      post = this.enhanceTechnicalDepth(post)
    } else if (expertiseDepth > 0.4) {
      // Medium expertise: business professional level
      post = this.enhanceBusinessDepth(post)
    } else {
      // Low expertise: general audience, introductory
      post = this.enhanceGeneralAccessibility(post)
    }
    
    return { ...variant, post }
  }

  /**
   * Apply structure rules for length and scan density
   */
  private applyStructureRules(variant: Record<string, unknown>, structure: { lengthLevel: number; scanDensity: number }): Record<string, unknown> {
    let post = variant.post as string
    const { lengthLevel, scanDensity } = structure
    
    // Apply length constraints
    if (lengthLevel < 0.4) {
      post = this.shortenContent(post, 600) // Short: ~600 chars
    } else if (lengthLevel > 0.7) {
      post = this.lengthenContent(post, 1200) // Long: ~1200 chars
    }
    
    // Apply scan density constraints
    if (scanDensity > 0.7) {
      post = this.optimizeForScanning(post) // High scan density
    } else {
      post = this.optimizeForNarrative(post) // Low scan density
    }
    
    return { ...variant, post }
  }

  /**
   * Apply client policy constraints
   */
  private applyClientPolicyRules(variant: Record<string, unknown>, clientPolicy: Record<string, unknown>): Record<string, unknown> {
    let post = variant.post as string
    
    // Emoji constraint
    if (clientPolicy.emojiAllowed === false) {
      post = this.removeEmojis(post)
    }
    
    // Voice constraint
    if (clientPolicy.voice === 'formal') {
      post = this.makeFormal(post)
    } else if (clientPolicy.voice === 'casual') {
      post = this.makeCasual(post)
    }
    
    // Banned claims constraint
    if (clientPolicy.bannedClaims && Array.isArray(clientPolicy.bannedClaims)) {
      post = this.removeBannedClaims(post, clientPolicy.bannedClaims as string[])
    }
    
    return { ...variant, post }
  }

  /**
   * Structure content as document format
   */
  private structureAsDocument(content: string): string {
    const lines = content.split('\n')
    const sections = ['📋 Overview', '🔍 Key Points', '💡 Insights', '🚀 Action Items']
    
    let structured = ''
    sections.forEach((section, index) => {
      if (lines[index]) {
        structured += `${section}\n${lines[index]}\n\n`
      }
    })
    
    return structured.trim()
  }

  /**
   * Structure content as multi-image format
   */
  private structureAsMultiImage(content: string): string {
    const lines = content.split('\n')
    const sections = ['🎯 Step 1', '🎯 Step 2', '🎯 Step 3', '✅ Result']
    
    let structured = ''
    sections.forEach((section, index) => {
      if (lines[index]) {
        structured += `${section}\n${lines[index]}\n\n`
      }
    })
    
    return structured.trim()
  }

  /**
   * Structure content as single image format
   */
  private structureAsSingleImage(content: string): string {
    const lines = content.split('\n')
    return `🖼️ ${lines[0]}\n\n${lines.slice(1).join('\n')}`
  }

  /**
   * Structure content as video format
   */
  private structureAsVideo(content: string): string {
    const lines = content.split('\n')
    return `🎥 ${lines[0]}\n\n${lines.slice(1).join('\n')}\n\n▶️ Watch the full video for more insights!`
  }

  /**
   * Structure content as text format
   */
  private structureAsText(content: string): string {
    return content // Keep as-is for text format
  }

  /**
   * Count sections in content
   */
  private countSections(content: string): number {
    const sectionMarkers = content.match(/[🎯📋🔍💡🚀✅]/gu)
    return sectionMarkers ? sectionMarkers.length : 1
  }

  /**
   * Create bold hook for high intensity
   */
  private createBoldHook(content: string): string {
    const lines = content.split('\n')
    const firstLine = lines[0]
    
    if (firstLine.includes('?')) {
      return `🚨 ${firstLine.toUpperCase()}\n\n${lines.slice(1).join('\n')}`
    } else {
      return `💥 ${firstLine}\n\n${lines.slice(1).join('\n')}`
    }
  }

  /**
   * Create balanced hook for medium intensity
   */
  private createBalancedHook(content: string): string {
    const lines = content.split('\n')
    const firstLine = lines[0]
    
    if (firstLine.includes('?')) {
      return `🤔 ${firstLine}\n\n${lines.slice(1).join('\n')}`
    } else {
      return `💡 ${firstLine}\n\n${lines.slice(1).join('\n')}`
    }
  }

  /**
   * Create subtle hook for low intensity
   */
  private createSubtleHook(content: string): string {
    const lines = content.split('\n')
    const firstLine = lines[0]
    
    return `📚 ${firstLine}\n\n${lines.slice(1).join('\n')}`
  }

  /**
   * Enhance technical depth
   */
  private enhanceTechnicalDepth(content: string): string {
    // Add technical terms and practitioner insights
    return content.replace(
      /(strategy|approach|methodology)/gi,
      'strategic methodology'
    )
  }

  /**
   * Enhance business depth
   */
  private enhanceBusinessDepth(content: string): string {
    // Add business context and professional insights
    return content.replace(
      /(result|outcome)/gi,
      'business outcome'
    )
  }

  /**
   * Enhance general accessibility
   */
  private enhanceGeneralAccessibility(content: string): string {
    // Simplify language for general audience
    return content.replace(
      /(strategic methodology|business outcome)/gi,
      'approach'
    )
  }

  /**
   * Shorten content to target length
   */
  private shortenContent(content: string, targetLength: number): string {
    if (content.length <= targetLength) return content
    
    const sentences = content.split('. ')
    let shortened = ''
    
    for (const sentence of sentences) {
      if ((shortened + sentence).length <= targetLength) {
        shortened += sentence + '. '
      } else {
        break
      }
    }
    
    return shortened.trim()
  }

  /**
   * Lengthen content to target length
   */
  private lengthenContent(content: string, targetLength: number): string {
    if (content.length >= targetLength) return content
    
    const additions = [
      'This approach has been proven effective across multiple industries.',
      'Consider how this strategy aligns with your specific business goals.',
      'The key is to implement these insights consistently over time.'
    ]
    
    let lengthened = content
    for (const addition of additions) {
      if (lengthened.length < targetLength) {
        lengthened += '\n\n' + addition
      }
    }
    
    return lengthened
  }

  /**
   * Optimize content for scanning
   */
  private optimizeForScanning(content: string): string {
    const lines = content.split('\n')
    const optimized = lines.map(line => {
      if (line.length > 80) {
        return line.replace(/([.!?])\s+/g, '$1\n')
      }
      return line
    })
    
    return optimized.join('\n')
  }

  /**
   * Optimize content for narrative flow
   */
  private optimizeForNarrative(content: string): string {
    return content.replace(/\n{3,}/g, '\n\n')
  }

  /**
   * Remove emojis from content
   */
  private removeEmojis(content: string): string {
    // Use individual emoji characters to avoid surrogate pair issues
    return content
      .replace(/🎯/gu, '')
      .replace(/📋/gu, '')
      .replace(/🔍/gu, '')
      .replace(/💡/gu, '')
      .replace(/🚀/gu, '')
      .replace(/✅/gu, '')
      .replace(/🖼️/gu, '')
      .replace(/🎥/gu, '')
      .replace(/▶️/gu, '')
      .replace(/🚨/gu, '')
      .replace(/💥/gu, '')
      .replace(/🤔/gu, '')
      .replace(/📚/gu, '')
  }

  /**
   * Make content more formal
   */
  private makeFormal(content: string): string {
    return content
      .replace(/gonna/g, 'going to')
      .replace(/wanna/g, 'want to')
      .replace(/gotta/g, 'got to')
  }

  /**
   * Make content more casual
   */
  private makeCasual(content: string): string {
    return content
      .replace(/going to/g, 'gonna')
      .replace(/want to/g, 'wanna')
      .replace(/got to/g, 'gotta')
  }

  /**
   * Remove banned claims from content
   */
  private removeBannedClaims(content: string, bannedClaims: string[]): string {
    let cleaned = content
    bannedClaims.forEach(claim => {
      const regex = new RegExp(claim, 'gi')
      cleaned = cleaned.replace(regex, '[removed]')
    })
    return cleaned
  }

  /**
   * Revise a single draft based on feedback
   */
  private async reviseDraft(
    state: AgentState, 
    draft: Draft, 
    instruction: Record<string, unknown>
  ): Promise<Draft> {
    const prompt = this.buildRevisionPrompt(state, draft, instruction)
    console.log('\n===== Copywriter Revision Prompt =====')
    console.log(`Platform: ${draft.platform} | Variant: ${draft.variantId || 'unknown'}`)
    console.log(prompt)
    console.log('===== End Copywriter Revision Prompt =====\n')
    
    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are revising social media content based on specific feedback. 
          Improve the post while maintaining its core message and platform optimization.
          Consider the 4-knob settings when making revisions.
          
          CRITICAL LANGUAGE REQUIREMENT: You MUST write all content in ${state.inputs.clientProfile?.primaryCommunicationLanguage || 'US English (default)'}. This is the client's primary communication language and all content must be culturally and linguistically appropriate for this language.`
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
      throw new Error('No revision response from OpenAI')
    }

    const revisedData = JSON.parse(content)
    
    return {
      ...draft,
      post: revisedData.post,
      altText: revisedData.altText || draft.altText,
      charCount: revisedData.post.length
    }
  }

  /**
   * Generate alt text for assets
   */
  private generateAltText(post: string, platform: string): string {
    // Simple alt text generation - in production, this could use a more sophisticated approach
    const words = post.split(' ').slice(0, 10).join(' ')
    return `${platform} post: ${words}...`
  }

  /**
   * Build prompt for variant generation with 4-knob system
   */
  private buildGenerationPrompt(state: AgentState, platform: string, count: number): string {
    const { brief, clientProfile } = state.inputs
    const { strategy, knobs } = state
    const rules = platformRules[platform as keyof typeof platformRules] || platformRules.linkedin // fallback to LinkedIn rules
    
    const languageInstruction = clientProfile?.primaryCommunicationLanguage 
      ? `\n\n🚨 CRITICAL LANGUAGE REQUIREMENT: Write ALL content in ${clientProfile.primaryCommunicationLanguage}. This is the client's primary communication language and all content must be culturally and linguistically appropriate for this language.`
      : '\n\n🚨 CRITICAL LANGUAGE REQUIREMENT: Write ALL content in US English (default).'
    
    return `Generate ${count} social media post variants for ${platform.toUpperCase()} using the 4-knob optimization system.${languageInstruction}

Brief: ${brief.title}
Objective: ${brief.objective || 'Not specified'}
Description: ${brief.description || 'Not provided'}

Strategy:
- Structure: ${strategy?.structure || 'hook → insight → CTA'}
- Themes: ${strategy?.themes?.join(', ') || 'Not specified'}
- Hashtags: ${strategy?.hashtags?.join(', ') || 'Not specified'}

4-Knob Settings:
- Format Type: ${knobs?.formatType || 'Not set'} (affects content structure and asset usage)
- Hook Intensity: ${knobs?.hookIntensity || 'Not set'} (0.0-1.0 scale for opening line strength)
- Expertise Depth: ${knobs?.expertiseDepth || 'Not set'} (0.0-1.0 scale for technical level)
- Structure: ${knobs?.structure ? `Length: ${knobs.structure.lengthLevel}, Scan: ${knobs.structure.scanDensity}` : 'Not set'}

Platform Rules:
- Max Characters: ${rules.maxChars}
- Max Hashtags: ${rules.maxHashtags}
- Recommended Length: ${rules.recommendedLength}

${clientProfile ? `Client Profile:
- Primary Language: ${clientProfile.primaryCommunicationLanguage || 'US English (default)'}
- Objectives: ${clientProfile.objectivesJson?.primary || 'Increase brand awareness'}, ${clientProfile.objectivesJson?.secondary || 'Drive engagement'}
- Target Audience: ${clientProfile.audiencesJson?.target || 'General professional audience'}
- Demographics: ${clientProfile.audiencesJson?.demographics || 'Professionals and decision makers'}
- Interests: ${Array.isArray(clientProfile.audiencesJson?.interests) && clientProfile.audiencesJson.interests.length > 0 ? clientProfile.audiencesJson.interests.join(', ') : 'Professional development, industry trends'}
- Pain Points: ${Array.isArray(clientProfile.audiencesJson?.painPoints) && clientProfile.audiencesJson.painPoints.length > 0 ? clientProfile.audiencesJson.painPoints.join(', ') : 'Information overload, time constraints'}
- Tone: ${clientProfile.toneJson?.preset || 'Professional & Formal'}
- Voice: ${clientProfile.toneJson?.voice || 'Balanced'}
${clientProfile.specialInstructionsJson?.instructions ? `- Special Instructions: ${clientProfile.specialInstructionsJson.instructions}` : ''}
${clientProfile.platformPrefsJson?.primary || clientProfile.platformPrefsJson?.secondary ? `- Platform Preferences: ${[clientProfile.platformPrefsJson?.primary, clientProfile.platformPrefsJson?.secondary].filter(Boolean).join(', ')}` : ''}
${clientProfile.platformPrefsJson?.focus ? `- Focus: ${clientProfile.platformPrefsJson.focus}` : ''}
${(() => { const banned = Array.isArray(clientProfile.guardrailsJson?.banned) && clientProfile.guardrailsJson.banned.length > 0 ? `Banned topics (${clientProfile.guardrailsJson.banned.join(', ')})` : ''; const sensitive = Array.isArray(clientProfile.guardrailsJson?.sensitive) && clientProfile.guardrailsJson.sensitive.length > 0 ? `Sensitive topics (${clientProfile.guardrailsJson.sensitive.join(', ')})` : ''; const required = Array.isArray(clientProfile.guardrailsJson?.required) && clientProfile.guardrailsJson.required.length > 0 ? `Required elements (${clientProfile.guardrailsJson.required.join(', ')})` : ''; const parts = [banned, sensitive, required].filter(Boolean); return parts.length ? `- Guardrails: ${parts.join(', ')}` : ''; })()}` : 'Client Profile: Not provided'}

Make the first line the headline (this is also the hook). After the headline, insert a single blank line, then the body. Do not include separate headline options. Provide a JSON response with:
{
  "variants": [
    {
      "post": "Headline (first line) followed by a blank line, then the body",
      "altText": "description for image/video"
    }
  ]
}

Focus on creating engaging, platform-optimized content that aligns with the 4-knob settings:
- Format type should guide content structure and asset usage
- Hook intensity should match opening line strength
- Expertise depth should match technical level
- Structure should optimize for length and scan-friendliness

🚨 REMEMBER: ALL content MUST be written in ${clientProfile?.primaryCommunicationLanguage || 'US English (default)'} - this is the client's primary communication language!`
  }

  /**
   * Build prompt for draft revision with knob consideration
   */
  private buildRevisionPrompt(
    state: AgentState, 
    draft: Draft, 
    instruction: Record<string, unknown>
  ): string {
    const { brief, clientProfile } = state.inputs
    const { knobs } = state
    
    const languageInstruction = clientProfile?.primaryCommunicationLanguage 
      ? `\n\n🚨 CRITICAL LANGUAGE REQUIREMENT: Write ALL content in ${clientProfile.primaryCommunicationLanguage}. This is the client's primary communication language and all content must be culturally and linguistically appropriate for this language.`
      : '\n\n🚨 CRITICAL LANGUAGE REQUIREMENT: Write ALL content in US English (default).'
    
    return `Revise this social media post based on the feedback while maintaining 4-knob optimization and client profile alignment:${languageInstruction}

Original Post: ${draft.post}
Platform: ${draft.platform}
Brief Objective: ${brief.objective || 'Not specified'}

Current Knob Settings:
- Format Type: ${knobs?.formatType || 'Not set'}
- Hook Intensity: ${knobs?.hookIntensity || 'Not set'}
- Expertise Depth: ${knobs?.expertiseDepth || 'Not set'}
- Structure: ${knobs?.structure ? `Length: ${knobs.structure.lengthLevel}, Scan: ${knobs.structure.scanDensity}` : 'Not set'}

${clientProfile ? `Client Profile Context:
- Primary Language: ${clientProfile.primaryCommunicationLanguage || 'US English (default)'}
- Objectives: ${clientProfile.objectivesJson?.primary || 'Increase brand awareness'}, ${clientProfile.objectivesJson?.secondary || 'Drive engagement'}
- Target Audience: ${clientProfile.audiencesJson?.target || 'General professional audience'}
- Tone: ${clientProfile.toneJson?.preset || 'Professional & Formal'}
- Voice: ${clientProfile.toneJson?.voice || 'Balanced'}
${clientProfile.specialInstructionsJson?.instructions ? `- Special Instructions: ${clientProfile.specialInstructionsJson.instructions}` : ''}
${(() => { const banned = Array.isArray(clientProfile.guardrailsJson?.banned) && clientProfile.guardrailsJson.banned.length > 0 ? `Banned topics (${clientProfile.guardrailsJson.banned.join(', ')})` : ''; const sensitive = Array.isArray(clientProfile.guardrailsJson?.sensitive) && clientProfile.guardrailsJson.sensitive.length > 0 ? `Sensitive topics (${clientProfile.guardrailsJson.sensitive.join(', ')})` : ''; const parts = [banned, sensitive].filter(Boolean); return parts.length ? `- Guardrails: ${parts.join(', ')}` : ''; })()}` : 'Client Profile: Not provided'}

Feedback: ${instruction.feedback}
Suggested Changes: ${Array.isArray(instruction.suggestedChanges) ? instruction.suggestedChanges.join(', ') : 'Not specified'}

Ensure the first line is the headline (the hook), followed by a single blank line, then the body. Provide a JSON response with:
{
  "post": "revised post text with a strong first-line headline and a blank line before the body",
  "altText": "revised alt text"
}

Maintain the core message while addressing the feedback. Ensure the post remains optimized for the platform, aligns with the 4-knob settings, and respects the client's tone, voice, and guardrails.

🚨 REMEMBER: ALL content MUST be written in ${clientProfile?.primaryCommunicationLanguage || 'US English (default)'} - this is the client's primary communication language!`
  }
}
