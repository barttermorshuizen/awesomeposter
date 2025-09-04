import { clients, clientProfiles, assets, getDb, eq } from '@awesomeposter/db'
import { updateClientSchema } from '@awesomeposter/shared'
import { defineEventHandler, readBody, createError } from 'h3'

// Normalize legacy tone presets to new 7-option set
function normalizeTonePreset(tone: Record<string, unknown> | undefined | null): Record<string, unknown> | undefined | null {
  if (!tone || typeof tone !== 'object') return tone
  const presetRaw = (tone as Record<string, unknown>)['preset']
  const preset = typeof presetRaw === 'string' ? presetRaw : undefined
  let mapped: string | undefined = preset
  if (preset === 'Professional') mapped = 'Professional & Formal'
  else if (preset === 'Friendly') mapped = 'Warm & Friendly'
  else if (preset === 'Bold') mapped = 'Confident & Bold'
  // If no preset present, try legacy fields
  if (!mapped) {
    const legacyStyle = (tone as Record<string, unknown>)['style']
    if (legacyStyle === 'Professional') mapped = 'Professional & Formal'
    else if (legacyStyle === 'Friendly') mapped = 'Warm & Friendly'
    else if (legacyStyle === 'Bold') mapped = 'Confident & Bold'
  }
  return { ...(tone as Record<string, unknown>), preset: mapped }
}

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    
    console.log('=== PATCH REQUEST START ===')
    console.log('Full body:', body)
    
    // Validate the request body using the updateClientSchema
    const parsed = updateClientSchema.safeParse(body)
    
    if (!parsed.success) {
      console.log('Validation failed:', parsed.error.message)
      throw createError({ 
        statusCode: 400, 
        statusMessage: `Invalid request data: ${parsed.error.message}` 
      })
    }

    const { clientId, name, slug, website, industry, settings, profile, assets: assetsData } = parsed.data
    
    console.log('Validation passed, getting database connection...')
    const db = getDb()
    console.log('Database connection obtained')
    
    // First, verify the client exists
    console.log('Checking if client exists...')
    const [existingClient] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1)
    console.log('Existing client found:', existingClient)
    
    if (!existingClient) {
      console.log('Client not found in database')
      throw createError({ statusCode: 404, statusMessage: 'Client not found' })
    }
    
    // Check if slug is already taken by another client (only if slug is being updated)
    if (slug && slug !== existingClient.slug) {
      console.log('Checking for slug conflicts...')
      const [slugConflict] = await db.select().from(clients).where(eq(clients.slug, slug)).limit(1)
      console.log('Slug conflict check result:', slugConflict)
      
      if (slugConflict && slugConflict.id !== clientId) {
        console.log('Slug conflict detected')
        throw createError({ 
          statusCode: 400, 
          statusMessage: 'Slug is already taken by another client' 
        })
      }
    }
    
    // Prepare client update data (only include fields that are provided)
    const clientUpdateFields: Record<string, unknown> = {}
    if (name !== undefined) clientUpdateFields.name = name.trim()
    if (slug !== undefined) clientUpdateFields.slug = slug.trim()
    if (website !== undefined) clientUpdateFields.website = website
    if (industry !== undefined) clientUpdateFields.industry = industry
    if (settings !== undefined) clientUpdateFields.settingsJson = settings
    
    // Update the client if there are fields to update
    if (Object.keys(clientUpdateFields).length > 0) {
      console.log('Starting client update with fields:', clientUpdateFields)
      await db.update(clients).set(clientUpdateFields).where(eq(clients.id, clientId))
      console.log('Client updated successfully')
    }
    
    // Handle profile updates if provided
    if (profile) {
      console.log('Handling profile updates...')
      const [existingProfile] = await db.select().from(clientProfiles).where(eq(clientProfiles.clientId, clientId)).limit(1)
      
      if (existingProfile) {
        // Update existing profile
        const profileUpdateFields: Record<string, unknown> = {}
        if (profile.primaryCommunicationLanguage !== undefined) profileUpdateFields.primaryCommunicationLanguage = profile.primaryCommunicationLanguage
        if (profile.objectives !== undefined) profileUpdateFields.objectivesJson = profile.objectives
        if (profile.audiences !== undefined) profileUpdateFields.audiencesJson = profile.audiences
        if (profile.tone !== undefined) profileUpdateFields.toneJson = normalizeTonePreset(profile.tone as Record<string, unknown> | undefined | null) as Record<string, unknown>
        if (profile.specialInstructions !== undefined) profileUpdateFields.specialInstructionsJson = profile.specialInstructions
        if (profile.guardrails !== undefined) profileUpdateFields.guardrailsJson = profile.guardrails
        if (profile.platformPrefs !== undefined) profileUpdateFields.platformPrefsJson = profile.platformPrefs
        if (profile.permissions !== undefined) profileUpdateFields.permissionsJson = profile.permissions
        
        if (Object.keys(profileUpdateFields).length > 0) {
          profileUpdateFields.updatedAt = new Date()
          await db.update(clientProfiles).set(profileUpdateFields).where(eq(clientProfiles.id, existingProfile.id))
          console.log('Profile updated successfully')
        }
      } else {
        // Create new profile
        const profileId = crypto.randomUUID()
        await db.insert(clientProfiles).values({
          id: profileId,
          clientId,
          primaryCommunicationLanguage: profile.primaryCommunicationLanguage ?? null,
          objectivesJson: profile.objectives ?? {},
          audiencesJson: profile.audiences ?? {},
          toneJson: normalizeTonePreset(profile.tone as Record<string, unknown> | undefined | null) ?? {},
          specialInstructionsJson: profile.specialInstructions ?? {},
          guardrailsJson: profile.guardrails ?? {},
          platformPrefsJson: profile.platformPrefs ?? {},
          permissionsJson: profile.permissions ?? {},
          updatedAt: new Date()
        })
        console.log('New profile created successfully')
      }
    }
    
    // Handle assets management if provided
    if (assetsData) {
      console.log('Handling assets management...')
      
      // Delete assets if requested
      if (assetsData.delete && assetsData.delete.length > 0) {
        console.log('Deleting assets:', assetsData.delete)
        for (const assetId of assetsData.delete) {
          await db.delete(assets).where(eq(assets.id, assetId))
        }
        console.log('Assets deleted successfully')
      }
      
      // Add new assets if requested
      if (assetsData.add && assetsData.add.length > 0) {
        console.log('Adding new assets:', assetsData.add)
        for (const asset of assetsData.add) {
          const assetId = crypto.randomUUID()
          // Generate the download URL that points to our app endpoint
          const downloadUrl = `/api/assets/${assetId}/download`
          
          await db.insert(assets).values({
            id: assetId,
            clientId,
            briefId: null,
            filename: asset.url.split('/').pop() ?? 'unknown',
            originalName: asset.url.split('/').pop() ?? 'unknown',
            url: downloadUrl,
            type: (asset.type as 'image' | 'document' | 'video' | 'audio' | 'other') ?? null,
            mimeType: null,
            fileSize: null,
            metaJson: asset.meta ?? {},
            createdBy: null
          })
        }
        console.log('New assets added successfully')
      }
    }
    
    // Fetch the updated client and profile data
    console.log('Fetching updated data...')
    const [updatedClient] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1)
    const [updatedProfile] = await db.select().from(clientProfiles).where(eq(clientProfiles.clientId, clientId)).limit(1)
    const clientAssets = await db.select().from(assets).where(
      eq(assets.clientId, clientId)
    ).then(assets => assets.filter(asset => asset.briefId === null))
    
    console.log('Update completed successfully')
    
    return { 
      ok: true, 
      message: 'Client updated successfully',
      client: {
        id: clientId,
        name: updatedClient.name,
        slug: updatedClient.slug,
        website: updatedClient.website,
        industry: updatedClient.industry,
        settings: updatedClient.settingsJson,
        createdAt: updatedClient.createdAt
      },
      profile: updatedProfile ? {
        id: updatedProfile.id,
        primaryLanguage: updatedProfile.primaryCommunicationLanguage,
        objectives: updatedProfile.objectivesJson,
        audiences: updatedProfile.audiencesJson,
        tone: updatedProfile.toneJson,
        guardrails: updatedProfile.guardrailsJson,
        platformPrefs: updatedProfile.platformPrefsJson,
        permissions: updatedProfile.permissionsJson,
        updatedAt: updatedProfile.updatedAt
      } : null,
      assets: clientAssets.map(asset => ({
        id: asset.id,
        url: asset.url,
        type: asset.type,
        meta: asset.metaJson
      }))
    }
  } catch (error) {
    console.error('=== ERROR IN PATCH ENDPOINT ===')
    console.error('Error type:', typeof error)
    console.error('Error message:', error instanceof Error ? error.message : String(error))
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace')
    
    if (error instanceof Error && error.message.includes('Client not found')) {
      throw error
    }
    
    if (error instanceof Error && error.message.includes('Slug is already taken')) {
      throw error
    }
    
    if (error instanceof Error && error.message.includes('Invalid request data')) {
      throw error
    }
    
    throw createError({ 
      statusCode: 500, 
      statusMessage: `Failed to update client: ${error instanceof Error ? error.message : String(error)}` 
    })
  }
})
