import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema.js'

export type Database = NodePgDatabase<typeof schema>

let cachedPool: pg.Pool | null = null
let cachedDb: Database | null = null

export function getPool(): pg.Pool {
  if (cachedPool) return cachedPool
  
  // Try to get DATABASE_URL from runtime config first, then fall back to process.env
  let databaseUrl: string | undefined
  
  try {
    // This will work in Nuxt server context
    const runtimeConfig = useRuntimeConfig()
    databaseUrl = runtimeConfig.DATABASE_URL
  } catch {
    // Fall back to process.env for non-Nuxt contexts
    databaseUrl = process.env.DATABASE_URL
  }
  
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set in runtime config or process.env')
  }
  
  cachedPool = new pg.Pool({ connectionString: databaseUrl })
  return cachedPool
}

export function getDb() {
  if (cachedDb) return cachedDb
  const pool = getPool()
  cachedDb = drizzle(pool, { schema })
  return cachedDb
}

export * from './schema.js'



import { eq } from 'drizzle-orm'
export { eq, and, isNotNull } from 'drizzle-orm'

export async function getClientProfileByClientId(clientId: string) {
  const db = getDb()
  const [row] = await db
    .select()
    .from(schema.clientProfiles)
    .where(eq(schema.clientProfiles.clientId, clientId))
    .limit(1)
  return row ?? null
}

export type UpsertClientProfileInput = {
  objectives: Record<string, unknown>
  audiences: Record<string, unknown>
  tone?: Record<string, unknown>
  specialInstructions?: Record<string, unknown>
  guardrails?: Record<string, unknown>
  platformPrefs?: Record<string, unknown>
  permissions?: Record<string, unknown>
}

export async function upsertClientProfile(
  clientId: string,
  data: UpsertClientProfileInput
) {
  const db = getDb()
  const [existing] = await db
    .select()
    .from(schema.clientProfiles)
    .where(eq(schema.clientProfiles.clientId, clientId))
    .limit(1)
  const now = new Date()
  if (existing) {
    await db
      .update(schema.clientProfiles)
      .set({
        objectivesJson: data.objectives as any,
        audiencesJson: data.audiences as any,
        toneJson: (data.tone ?? {}) as any,
        specialInstructionsJson: (data.specialInstructions ?? {}) as any,
        guardrailsJson: (data.guardrails ?? {}) as any,
        platformPrefsJson: (data.platformPrefs ?? {}) as any,
        permissionsJson: (data.permissions ?? {}) as any,
        updatedAt: now
      })
      .where(eq(schema.clientProfiles.id, existing.id))
    return existing.id as string
  }
  const profileId = crypto.randomUUID()
  await db.insert(schema.clientProfiles).values({
    id: profileId,
    clientId,
    objectivesJson: data.objectives as any,
    audiencesJson: data.audiences as any,
    toneJson: (data.tone ?? {}) as any,
    specialInstructionsJson: (data.specialInstructions ?? {}) as any,
    guardrailsJson: (data.guardrails ?? {}) as any,
    platformPrefsJson: (data.platformPrefs ?? {}) as any,
    permissionsJson: (data.permissions ?? {}) as any,
    updatedAt: now
  })
  return profileId
}
