import { AgentRuntime } from '../services/agent-runtime'
import type { Asset, FormatType } from '@awesomeposter/shared'
import { getDb, assets as assetsTable, eq } from '@awesomeposter/db'
import { z } from 'zod'

export function analyzeAssetsLocal(assets: Asset[]) {
  const images = assets.filter((a) => a.type === 'image')
  const documents = assets.filter((a) => a.type === 'document')
  const videos = assets.filter((a) => a.type === 'video')

  const hasPdf = documents.some((d) => (d.mimeType || '').includes('pdf'))

  const achievable: FormatType[] = ['text']
  if (images.length >= 1) achievable.push('single_image')
  if (images.length >= 3) achievable.push('multi_image')
  if (documents.length >= 1 && hasPdf) achievable.push('document_pdf')
  if (videos.length >= 1) achievable.push('video')

  let recommended: FormatType = 'text'
  if (videos.length >= 1) recommended = 'video'
  else if (images.length >= 3) recommended = 'multi_image'
  else if (images.length >= 1) recommended = 'single_image'
  else if (documents.length >= 1 && hasPdf) recommended = 'document_pdf'

  const assetQuality = {
    images: { count: images.length, quality: images.length >= 3 ? 'high' : images.length >= 1 ? 'medium' : 'low' as 'high' | 'medium' | 'low' },
    documents: { count: documents.length, hasSlides: hasPdf },
    videos: { count: videos.length, duration: undefined as number | undefined }
  }

  const formatFeasibility: Record<FormatType, { feasible: boolean; reason: string; assetRequirements: string[] }> = {
    text: { feasible: true, reason: 'Always available', assetRequirements: [] },
    single_image: {
      feasible: images.length >= 1,
      reason: images.length >= 1 ? 'Sufficient images' : 'Need at least 1 image',
      assetRequirements: images.length >= 1 ? [] : ['At least 1 image']
    },
    multi_image: {
      feasible: images.length >= 3,
      reason: images.length >= 3 ? 'Sufficient images' : 'Need at least 3 images',
      assetRequirements: images.length >= 3 ? [] : ['At least 3 images']
    },
    document_pdf: {
      feasible: documents.length >= 1 && hasPdf,
      reason: hasPdf ? 'PDF available' : 'PDF required',
      assetRequirements: hasPdf ? [] : ['PDF or presentation document']
    },
    video: {
      feasible: videos.length >= 1,
      reason: videos.length >= 1 ? 'Video available' : 'Video required',
      assetRequirements: videos.length >= 1 ? [] : ['Video file']
    }
  }

  const recommendations: string[] = []
  if (images.length === 0) recommendations.push('Consider adding at least one strong image to increase scannability.')
  if (videos.length === 0 && images.length >= 1) recommendations.push('Short clips or motion can further improve engagement.')
  if (documents.length >= 1 && !hasPdf) recommendations.push('Export documents to PDF for easier sharing.')

  return { achievableFormats: achievable, recommendedFormat: recommended, assetQuality, formatFeasibility, recommendations }
}
// Define a strict asset schema for tool parameters (Agents SDK requires array items to be specified)
// All fields must be required in JSON Schema terms; use nullable for optional semantics.
// additionalProperties must be false (catchall never) to satisfy the API validator.
// Note: metaJson removed from params to satisfy OpenAI JSON Schema validator.
const AssetParamSchema = z
  .object({
    id: z.string().nullable(),
    filename: z.string().nullable(),
    originalName: z.string().nullable(),
    url: z.string().nullable(),
    type: z.enum(['image', 'document', 'video', 'audio', 'other']).nullable(),
    mimeType: z.string().nullable(),
    fileSize: z.number().int().nonnegative().nullable()
  })
  .strict()
  .catchall(z.never())

// Structured analysis schema for tool parameters (required+nullable, additionalProperties=false)
const FormatTypeEnum = z.enum(['text', 'single_image', 'multi_image', 'document_pdf', 'video'])

const AssetQualityParamSchema = z
  .object({
    images: z
      .object({
        count: z.number().int().nonnegative(),
        quality: z.enum(['high', 'medium', 'low'])
      })
      .strict(),
    documents: z
      .object({
        count: z.number().int().nonnegative(),
        hasSlides: z.boolean()
      })
      .strict(),
    videos: z
      .object({
        count: z.number().int().nonnegative(),
        duration: z.number().int().nonnegative().nullable()
      })
      .strict()
  })
  .strict()

const FormatFeasibilityEntrySchema = z
  .object({
    feasible: z.boolean(),
    reason: z.string(),
    assetRequirements: z.array(z.string())
  })
  .strict()

const FormatFeasibilityParamSchema = z
  .object({
    text: FormatFeasibilityEntrySchema,
    single_image: FormatFeasibilityEntrySchema,
    multi_image: FormatFeasibilityEntrySchema,
    document_pdf: FormatFeasibilityEntrySchema,
    video: FormatFeasibilityEntrySchema
  })
  .strict()

const AssetAnalysisParamSchema = z
  .object({
    achievableFormats: z.array(FormatTypeEnum),
    recommendedFormat: FormatTypeEnum,
    assetQuality: AssetQualityParamSchema,
    formatFeasibility: FormatFeasibilityParamSchema,
    recommendations: z.array(z.string())
  })
  .strict()
export function registerStrategyTools(runtime: AgentRuntime) {
  runtime.registerTool({
    name: 'strategy_analyze_assets',
    description: 'Analyze provided assets to determine feasible formats and a recommendation',
    parameters: z
      .object({
        // OpenAI structured outputs: all fields required; use nullable for optional semantics.
        // Important: arrays must define item schemas; avoid z.any() for array items.
        assets: z.array(AssetParamSchema).nullable(),
        briefId: z.string().nullable()
      })
      .strict(),
    handler: async ({ assets, briefId }: { assets: Asset[] | null; briefId: string | null }) => {
      let sourceAssets: Asset[] | undefined = assets as any
      if ((!sourceAssets || !Array.isArray(sourceAssets)) && briefId) {
        const db = getDb()
        const rows = await db.select().from(assetsTable).where(eq(assetsTable.briefId, briefId))
        // Map minimal fields to Asset type
        sourceAssets = rows.map((r: any) => ({
          id: r.id,
          filename: r.filename || '',
          originalName: r.originalName || undefined,
          url: r.url,
          type: (r.type || 'other') as any,
          mimeType: r.mimeType || undefined,
          fileSize: r.fileSize || undefined,
          metaJson: r.metaJson || undefined
        })) as Asset[]
      }
      if (!sourceAssets || !Array.isArray(sourceAssets)) {
        sourceAssets = []
      }
      return analyzeAssetsLocal(sourceAssets)
    }
  })

  runtime.registerTool({
    name: 'strategy_plan_knobs',
    description: 'Plan 4-knob configuration based on objective and asset analysis',
    parameters: z
      .object({
        objective: z.string(),
        // Add assetAnalysis parameter that the SDK expects
        assetAnalysis: AssetAnalysisParamSchema.nullable(),
        // Narrow client policy shape to satisfy JSON Schema requirements
        clientPolicy: z
          .object({
            maxHookIntensity: z.number().nullable()
          })
          .strict()
          .nullable(),
        briefId: z.string().nullable()
      })
      .strict(),
    handler: async ({ objective, assetAnalysis, clientPolicy, briefId }: { objective: string; assetAnalysis: any | null; clientPolicy: { maxHookIntensity: number | null } | null; briefId: string | null }) => {
      let analysis: any | undefined = assetAnalysis
      
      // If no assetAnalysis provided but briefId is available, compute from DB assets
      if (!analysis && briefId) {
        const db = getDb()
        const rows = await db.select().from(assetsTable).where(eq(assetsTable.briefId, briefId))
        const mapped = rows.map((r: any) => ({
          id: r.id,
          filename: r.filename || '',
          originalName: r.originalName || undefined,
          url: r.url,
          type: (r.type || 'other') as any,
          mimeType: r.mimeType || undefined,
          fileSize: r.fileSize || undefined,
          metaJson: r.metaJson || undefined
        })) as Asset[]
        analysis = analyzeAssetsLocal(mapped)
      }
      const format: FormatType = analysis?.recommendedFormat || 'text'
      // Heuristic defaults
      let hookIntensity = /awareness|launch|new/i.test(objective) ? 0.75 : 0.6
      if (clientPolicy?.maxHookIntensity != null) {
        const cap = Number(clientPolicy.maxHookIntensity)
        if (Number.isFinite(cap)) hookIntensity = Math.min(hookIntensity, cap)
      }
      const expertiseDepth = /technical|deep|guide|how\-to/i.test(objective) ? 0.7 : 0.5
      const structure = {
        lengthLevel: format === 'text' ? 0.7 : format === 'document_pdf' ? 0.9 : 0.4,
        scanDensity: format === 'text' ? 0.6 : 0.5
      }
      const rationale = `Chosen format ${format} based on available assets. Hook ${hookIntensity.toFixed(2)} to match objective. Depth ${expertiseDepth.toFixed(2)} for clarity.`
      return { formatType: format, hookIntensity, expertiseDepth, structure, rationale }
    }
  })
}
