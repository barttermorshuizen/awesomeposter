import { getDb, assets, briefs, eq } from '@awesomeposter/db'
import type { Asset } from '@awesomeposter/shared'
import { requireDiscoveryFeatureEnabled } from '../utils/feature-flags'

export class AgentsDatabaseService {
  private db = getDb()

  async enrichBriefWithAssets(briefId: string) {
    const [brief] = await this.db.select().from(briefs).where(eq(briefs.id, briefId))
    if (!brief) throw new Error('Brief not found')
    await requireDiscoveryFeatureEnabled(brief.clientId as string)

    const briefAssets = await this.db.select().from(assets).where(eq(assets.briefId, briefId))

    return {
      ...brief,
      assets: briefAssets.map((asset) => ({
        id: asset.id,
        filename: asset.filename || '',
        originalName: asset.originalName || undefined,
        url: asset.url,
        type: (asset.type || 'other') as Asset['type'],
        mimeType: asset.mimeType || undefined,
        fileSize: asset.fileSize || undefined,
        metaJson: (asset.metaJson || undefined) as Asset['metaJson']
      })) as Asset[]
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.db.select().from(briefs).limit(1)
      return true
    } catch {
      return false
    }
  }
}
