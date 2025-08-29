import { getPool } from '@awesomeposter/db'
import { generateMinimalClientProfile, validateClientProfileStructure } from '../../../utils/sample-client-profile'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'id required' })
  }
  
  const pool = getPool()
  const { rows } = await pool.query(
    'SELECT * FROM client_profiles WHERE client_id = $1 LIMIT 1',
    [id]
  )
  const row = rows[0]
  
  // Return minimal profile structure if no profile exists
  if (!row) {
    const minimalProfile = generateMinimalClientProfile()
    return { 
      ok: true, 
      profile: {
        id: null,
        clientId: id,
        primaryLanguage: minimalProfile.primaryCommunicationLanguage,
        objectives: minimalProfile.objectivesJson,
        audiences: minimalProfile.audiencesJson,
        tone: minimalProfile.toneJson,
        specialInstructions: minimalProfile.specialInstructionsJson,
        guardrails: minimalProfile.guardrailsJson,
        platformPrefs: minimalProfile.platformPrefsJson,
        permissions: {},
        updatedAt: null
      }
    }
  }
  
  // Transform the database fields to match what the UI expects
  let transformedProfile = {
    id: row.id,
    clientId: row.client_id,
    primaryLanguage: row.primary_communication_language || 'US English',
    objectives: row.objectives_json || {},
    audiences: row.audiences_json || {},
    tone: row.tone_json || {},
    specialInstructions: row.special_instructions_json || {},
    guardrails: row.guardrails_json || {},
    platformPrefs: row.platform_prefs_json || {},
    permissions: row.permissions_json || {},
    updatedAt: row.updated_at
  }
  
  // Validate the profile structure and fill in missing fields with defaults
  const validation = validateClientProfileStructure({
    primaryCommunicationLanguage: transformedProfile.primaryLanguage,
    objectivesJson: transformedProfile.objectives,
    audiencesJson: transformedProfile.audiences,
    toneJson: transformedProfile.tone,
    specialInstructionsJson: transformedProfile.specialInstructions,
    guardrailsJson: transformedProfile.guardrails,
    platformPrefsJson: transformedProfile.platformPrefs
  })
  
  if (!validation.isValid) {
    console.log(`⚠️ Client profile ${id} has missing fields:`, validation.missingFields)
    
    // Fill in missing fields with minimal defaults
    const minimalDefaults = generateMinimalClientProfile(transformedProfile.primaryLanguage as 'US English' | 'UK English' | 'Nederlands' | 'Francais')
    
    // Create a new object with filled-in defaults
    transformedProfile = {
      ...transformedProfile,
      objectives: (!transformedProfile.objectives || Object.keys(transformedProfile.objectives).length === 0) 
        ? minimalDefaults.objectivesJson : transformedProfile.objectives,
      audiences: (!transformedProfile.audiences || Object.keys(transformedProfile.audiences).length === 0) 
        ? minimalDefaults.audiencesJson : transformedProfile.audiences,
      tone: (!transformedProfile.tone || Object.keys(transformedProfile.tone).length === 0) 
        ? minimalDefaults.toneJson : transformedProfile.tone,
      specialInstructions: (!transformedProfile.specialInstructions || Object.keys(transformedProfile.specialInstructions).length === 0) 
        ? minimalDefaults.specialInstructionsJson : transformedProfile.specialInstructions,
      guardrails: (!transformedProfile.guardrails || Object.keys(transformedProfile.guardrails).length === 0) 
        ? minimalDefaults.guardrailsJson : transformedProfile.guardrails,
      platformPrefs: (!transformedProfile.platformPrefs || Object.keys(transformedProfile.platformPrefs).length === 0) 
        ? minimalDefaults.platformPrefsJson : transformedProfile.platformPrefs
    }
  }
  
  return { ok: true, profile: transformedProfile }
})


