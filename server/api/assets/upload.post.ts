import { putAssetObject } from '../../utils/storage'
import { getEnv } from '../../utils/env'
import { assets, getDb } from '@awesomeposter/db'

export default defineEventHandler(async (event) => {
  console.log('=== ASSET UPLOAD START ===')
  
  try {
    const env = getEnv()
    console.log('Environment loaded:', {
      hasR2Bucket: !!env.R2_BUCKET_ASSETS,
      hasR2Keys: !!(env.R2_ACCESS_KEY && env.R2_SECRET_KEY),
      hasR2Endpoint: !!env.R2_ENDPOINT,
      endpoint: env.R2_ENDPOINT,
      bucket: env.R2_BUCKET_ASSETS
    })

    if (!env.R2_BUCKET_ASSETS || !env.R2_ACCESS_KEY || !env.R2_SECRET_KEY || !env.R2_ENDPOINT) {
      console.error('R2 configuration missing:', {
        bucket: env.R2_BUCKET_ASSETS,
        hasAccessKey: !!env.R2_ACCESS_KEY,
        hasSecretKey: !!env.R2_SECRET_KEY,
        endpoint: env.R2_ENDPOINT
      })
      throw createError({ statusCode: 500, statusMessage: 'Asset storage is not configured.' })
    }

    console.log('Reading multipart form data...')
    const formData = await readMultipartFormData(event)
    console.log('Form data received:', {
      hasFormData: !!formData,
      formDataLength: formData?.length || 0,
      formDataKeys: formData?.map(f => f.name) || []
    })

    if (!formData) {
      throw createError({ statusCode: 400, statusMessage: 'No form data received.' })
    }

    const file = formData.find(f => f.name === 'file')
    const clientId = formData.find(f => f.name === 'clientId')?.data.toString()
    const briefId = formData.find(f => f.name === 'briefId')?.data.toString()

    console.log('File info:', {
      hasFile: !!file,
      fileName: file?.filename,
      fileSize: file?.data?.length,
      fileType: file?.type,
      clientId
    })

    if (!file || !file.data || !file.filename || !clientId) {
      console.error('Missing required fields:', {
        hasFile: !!file,
        hasData: !!file?.data,
        hasFilename: !!file?.filename,
        hasClientId: !!clientId
      })
      throw createError({ statusCode: 400, statusMessage: 'File, filename, and clientId are required.' })
    }

    const fileExtension = file.filename.split('.').pop()
    const key = briefId ? `briefs/${briefId}/${crypto.randomUUID()}.${fileExtension}` : `clients/${clientId}/${crypto.randomUUID()}.${fileExtension}`

    console.log('Generated key:', key)

    console.log('Uploading to R2...')
    await putAssetObject(key, file.data, file.type)
    console.log('Upload successful')

    // Determine asset type based on MIME type
    let assetType: 'image' | 'document' | 'video' | 'audio' | 'other' = 'other'
    if (file.type) {
      if (file.type.startsWith('image/')) assetType = 'image'
      else if (file.type.startsWith('video/')) assetType = 'video'
      else if (file.type.startsWith('audio/')) assetType = 'audio'
      else if (file.type.includes('pdf') || file.type.includes('document') || file.type.includes('text') || file.type.includes('spreadsheet')) assetType = 'document'
    }

    // Save asset metadata to database
    const db = getDb()
    const assetId = crypto.randomUUID()
    
    // Generate the download URL that points to our app endpoint
    const downloadUrl = `/api/assets/${assetId}/download`
    
    await db.insert(assets).values({
      id: assetId,
      clientId,
      briefId: briefId || null,
      filename: key,
      originalName: file.filename,
      url: downloadUrl,
      type: assetType,
      mimeType: file.type || null,
      fileSize: file.data.length,
      metaJson: {}
    })

    console.log('Asset metadata saved to database with ID:', assetId)

    return { ok: true, url: downloadUrl, assetId }
  } catch (error) {
    console.error('Asset upload error:', error)
    throw error
  } finally {
    console.log('=== ASSET UPLOAD END ===')
  }
})
