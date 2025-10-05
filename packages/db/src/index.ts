import { eq } from 'drizzle-orm'
export { eq, and, isNotNull } from 'drizzle-orm'
import * as schema from './schema.js'
import { getDb, getPool, type Database } from './client.js'

export { getDb, getPool }
export type { Database }
export * from './schema.js'
export * from './discovery/index.js'

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
