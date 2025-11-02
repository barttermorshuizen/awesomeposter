import { putAssetObject } from '../../../utils/storage'
import { getEnv } from '../../../utils/env'
import { flexAssets, getDb } from '@awesomeposter/db'

function sanitizeSegment(segment: string, fallback: string): string {
  const normalized = segment
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized.length ? normalized : fallback
}

export default defineEventHandler(async (event) => {
  const env = getEnv()
  if (!env.R2_BUCKET_ASSETS || !env.R2_ACCESS_KEY || !env.R2_SECRET_KEY || !env.R2_ENDPOINT) {
    throw createError({ statusCode: 500, statusMessage: 'Asset storage is not configured.' })
  }

  const formData = await readMultipartFormData(event)
  if (!formData) {
    throw createError({ statusCode: 400, statusMessage: 'No form data received.' })
  }

  const file = formData.find((entry) => entry.name === 'file')
  const assignmentId = formData.find((entry) => entry.name === 'assignmentId')?.data.toString()
  const facet = formData.find((entry) => entry.name === 'facet')?.data.toString()
  const runId = formData.find((entry) => entry.name === 'flexRunId')?.data.toString()
  const nodeId = formData.find((entry) => entry.name === 'nodeId')?.data.toString()
  const uploadedBy = formData.find((entry) => entry.name === 'uploadedBy')?.data.toString()

  if (!file || !file.data || !file.filename) {
    throw createError({ statusCode: 400, statusMessage: 'File and filename are required.' })
  }
  if (!assignmentId || !facet) {
    throw createError({ statusCode: 400, statusMessage: 'assignmentId and facet are required.' })
  }

  const extension = file.filename.includes('.') ? `.${file.filename.split('.').pop()}` : ''
  const assetId = crypto.randomUUID()
  const key = `flex/${sanitizeSegment(assignmentId, 'assignment')}/${sanitizeSegment(facet, 'facet')}/${assetId}${extension}`

  const publicUrl = await putAssetObject(key, file.data, file.type)

  const db = getDb()
  const meta = {
    scope: facet === 'post_visual' ? 'flex.post_visual' : 'flex.assignment_asset',
    facet,
    assignmentId,
    flexRunId: runId ?? null,
    nodeId: nodeId ?? null
  }

  await db.insert(flexAssets).values({
    id: assetId,
    assignmentId,
    runId: runId ?? null,
    nodeId: nodeId ?? null,
    facet,
    url: publicUrl,
    filename: key,
    originalName: file.filename,
    mimeType: file.type || null,
    fileSize: file.data.length,
    ordering: 0,
    metaJson: meta,
    uploadedBy: uploadedBy ?? null
  })

  return {
    ok: true,
    asset: {
      id: assetId,
      url: publicUrl,
      ordering: 0,
      originalName: file.filename,
      mimeType: file.type || null,
      meta
    }
  }
})
