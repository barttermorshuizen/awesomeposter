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

export function registerStrategyTools(runtime: AgentRuntime) {
  runtime.registerTool({
    name: 'strategy_analyze_assets',
    description: 'Analyze provided assets to determine feasible formats and a recommendation',
    parameters: z.object({
      assets: z.array(z.any()).optional(),
      briefId: z.string().optional()
    }),
    handler: async ({ assets, briefId }: { assets?: Asset[]; briefId?: string }) => {
      let sourceAssets: Asset[] | undefined = assets
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
    parameters: z.object({
      objective: z.string(),
      assetAnalysis: z.any().optional(),
      clientPolicy: z.any().optional(),
      briefId: z.string().optional()
    }),
    handler: async ({ objective, assetAnalysis, clientPolicy, briefId }: { objective: string; assetAnalysis?: any; clientPolicy?: any; briefId?: string }) => {
      let analysis = assetAnalysis
      if (!analysis && briefId) {
        // Compute on the fly from DB assets if analysis not provided
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
      if (clientPolicy?.maxHookIntensity != null) hookIntensity = Math.min(hookIntensity, Number(clientPolicy.maxHookIntensity) || hookIntensity)
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
