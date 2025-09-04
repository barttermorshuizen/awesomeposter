/**
 * Sample client profile data structure that matches what the agents expect
 */
export const sampleClientProfile = {
  primaryCommunicationLanguage: 'US English' as const,
  objectivesJson: {
    primary: 'Increase brand awareness and drive signups',
    secondary: 'Establish thought leadership in the industry',
    kpis: ['Website traffic', 'Social media engagement', 'Lead generation']
  },
  audiencesJson: {
    target: 'Tech-savvy professionals and decision makers',
    demographics: 'Ages 25-45, urban/suburban, college-educated',
    interests: ['Technology', 'Innovation', 'Professional development', 'Industry trends'],
    painPoints: ['Information overload', 'Time constraints', 'Need for practical insights']
  },
  toneJson: {
    preset: 'Professional & Formal',
    guidelines: 'Clear, concise, confident.'
  },
  specialInstructionsJson: {
    instructions: 'Focus on actionable insights and practical tips. Avoid jargon when possible.',
    brandGuidelines: 'Use company colors and maintain consistent messaging',
    contentPreferences: 'Prefer data-driven insights over generic advice'
  },
  guardrailsJson: {
    banned: ['Controversial political topics', 'Competitor bashing', 'Unverified claims'],
    sensitive: ['Personal financial information', 'Internal company matters'],
    required: ['Company branding', 'Call-to-action', 'Professional tone']
  },
  platformPrefsJson: {
    primary: 'LinkedIn',
    secondary: 'X (Twitter)',
    focus: 'Professional networking and thought leadership'
  }
}

/**
 * Generate a minimal client profile with default values
 */
export function generateMinimalClientProfile(language: 'US English' | 'UK English' | 'Nederlands' | 'Francais' = 'US English') {
  return {
    primaryCommunicationLanguage: language,
    objectivesJson: {
      primary: 'Increase brand awareness',
      secondary: 'Drive engagement'
    },
    audiencesJson: {
      target: 'Target audience not specified',
      demographics: 'Demographics not specified',
      interests: [],
      painPoints: []
    },
    toneJson: {
      preset: 'Professional & Formal'
    },
    specialInstructionsJson: {
      instructions: 'No special instructions provided'
    },
    guardrailsJson: {
      banned: [],
      sensitive: [],
      required: []
    },
    platformPrefsJson: {
      primary: 'LinkedIn',
      secondary: 'X (Twitter)',
      focus: 'General social media presence'
    }
  }
}

/**
 * Validate that a client profile has the expected structure
 */
export function validateClientProfileStructure(profile: Record<string, unknown>): { isValid: boolean; missingFields: string[] } {
  const requiredFields = [
    'primaryCommunicationLanguage',
    'objectivesJson',
    'audiencesJson', 
    'toneJson',
    'specialInstructionsJson',
    'guardrailsJson',
    'platformPrefsJson'
  ]
  
  const missingFields: string[] = []
  
  for (const field of requiredFields) {
    if (!profile[field]) {
      missingFields.push(field)
    }
  }
  
  return {
    isValid: missingFields.length === 0,
    missingFields
  }
}
