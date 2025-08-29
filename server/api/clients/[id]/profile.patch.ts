import { getPool } from '@awesomeposter/db'
import { createOrUpdateClientProfileSchema } from '@awesomeposter/shared'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'id required' })
  }

  const body = await readBody(event)
  const parsed = createOrUpdateClientProfileSchema.safeParse(body)
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.message })
  }

  const pool = getPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      'SELECT id FROM client_profiles WHERE client_id = $1 LIMIT 1',
      [id]
    )
    const now = new Date()
    
    if (rows[0]) {
      const profileId = rows[0].id as string
      await client.query(
        `UPDATE client_profiles SET 
           primary_communication_language = $1, objectives_json = $2, audiences_json = $3, tone_json = $4, special_instructions_json = $5, guardrails_json = $6,
           platform_prefs_json = $7, permissions_json = $8, updated_at = $9
         WHERE id = $10`,
        [
          parsed.data.primaryCommunicationLanguage || null,
          parsed.data.objectives ?? {},
          parsed.data.audiences ?? {},
          parsed.data.tone ?? {},
          parsed.data.specialInstructions ?? {},
          parsed.data.guardrails ?? {},
          parsed.data.platformPrefs ?? {},
          parsed.data.permissions ?? {},
          now,
          profileId
        ]
      )
      await client.query('COMMIT')
      return { ok: true, id: profileId }
    }
    
    const profileId = crypto.randomUUID()
    await client.query(
      `INSERT INTO client_profiles (id, client_id, primary_communication_language, objectives_json, audiences_json, tone_json, special_instructions_json, guardrails_json, platform_prefs_json, permissions_json, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        profileId,
        id,
        parsed.data.primaryCommunicationLanguage || null,
        parsed.data.objectives ?? {},
        parsed.data.audiences ?? {},
        parsed.data.tone ?? {},
        parsed.data.specialInstructions ?? {},
        parsed.data.guardrails ?? {},
        parsed.data.platformPrefs ?? {},
        parsed.data.permissions ?? {},
        now
      ]
    )
    await client.query('COMMIT')
    return { ok: true, id: profileId }
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
})


