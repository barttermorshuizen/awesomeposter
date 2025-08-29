import { defineEventHandler, readBody } from 'h3'
import { clients, getDb } from '@awesomeposter/db'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event) as {
      name: string
      industry?: string
      website?: string
    }
    
    const { name, industry, website } = body
    
    if (!name) {
      throw new Error('Client name is required')
    }
    
    const db = getDb()
    const id = crypto.randomUUID()
    
    await db.insert(clients).values({
      id,
      name,
      website: website || null,
      industry: industry || null,
      createdAt: new Date()
    })
    
    return {
      success: true,
      id,
      name
    }
  } catch (error) {
    console.error('Error creating client:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
})


