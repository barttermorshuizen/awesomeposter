import { getDb, briefs, eq } from '@awesomeposter/db'
import { createBriefSchema } from '@awesomeposter/shared'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    
    const parsed = createBriefSchema.safeParse(body)
    if (!parsed.success) {
      throw createError({ statusCode: 400, statusMessage: parsed.error.message })
    }
    
    const db = getDb()
    const { clientId, title, description, objective, audienceId, deadlineAt } = parsed.data
    const id = crypto.randomUUID()
    
    await db.insert(briefs).values({
      id,
      clientId,
      title,
      description,
      objective,
      audienceId,
      deadlineAt: deadlineAt ? new Date(deadlineAt) : null
    })
    
    const [created] = await db.select().from(briefs).where(eq(briefs.id, id)).limit(1)
    
    return { ok: true, brief: created }
  } catch (error) {
    console.error('Error creating brief:', error)
    throw error
  }
})

