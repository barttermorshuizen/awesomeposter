import { AgentRuntime } from '../services/agent-runtime'
import { getDb, briefs, assets, clients, eq, getClientProfileByClientId } from '@awesomeposter/db'
import { requireDiscoveryFeatureEnabled } from '../utils/feature-flags'
import { z } from 'zod'

export function registerIOTools(runtime: AgentRuntime) {
  const db = getDb()

  runtime.registerTool({
    name: 'io_get_brief',
    description: 'Fetch a brief by id',
    parameters: z.object({ briefId: z.string().uuid() }),
    handler: async ({ briefId }: { briefId: string }) => {
      const [row] = await db.select().from(briefs).where(eq(briefs.id, briefId)).limit(1)
      if (!row) throw new Error('Brief not found')
      await requireDiscoveryFeatureEnabled(row.clientId as string)
      const [client] = await db.select().from(clients).where(eq(clients.id, row.clientId as any)).limit(1)
      return { ...row, clientName: client?.name }
    }
  })

  runtime.registerTool({
    name: 'io_list_assets',
    description: 'List assets for a brief',
    parameters: z.object({ briefId: z.string().uuid() }),
    handler: async ({ briefId }: { briefId: string }) => {
      const [brief] = await db.select({ clientId: briefs.clientId }).from(briefs).where(eq(briefs.id, briefId)).limit(1)
      if (!brief) throw new Error('Brief not found')
      await requireDiscoveryFeatureEnabled(brief.clientId as string)
      const rows = await db.select().from(assets).where(eq(assets.briefId, briefId))
      return rows
    }
  })

  runtime.registerTool({
    name: 'io_get_client_profile',
    description: 'Fetch the client profile for a clientId',
    parameters: z.object({ clientId: z.string().uuid() }),
    handler: async ({ clientId }: { clientId: string }) => {
      await requireDiscoveryFeatureEnabled(clientId)
      const profile = await getClientProfileByClientId(clientId)
      if (!profile) return null
      return profile
    }
  })
}
