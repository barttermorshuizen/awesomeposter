import { clients, getDb, eq, emailsIngested, examplesIndex, tasks } from '@awesomeposter/db'
import { deleteClientAssets } from '../../../utils/storage'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'id required' })
  
  try {
    const db = getDb()
    
    // First, verify the client exists
    const [client] = await db.select().from(clients).where(eq(clients.id, id)).limit(1)
    if (!client) {
      throw createError({ statusCode: 404, statusMessage: 'Client not found' })
    }
    
    // Clean up R2 assets first
    try {
      await deleteClientAssets(id)
    } catch (storageError) {
      console.error('Failed to delete client assets from R2:', storageError)
      // Continue with database deletion even if R2 cleanup fails
    }
    
    // Manually delete records from tables that don't have cascade deletes
    try {
      // Delete emails ingested for this client
      await db.delete(emailsIngested).where(eq(emailsIngested.clientId, id))
      
      // Delete examples index entries for this client
      await db.delete(examplesIndex).where(eq(examplesIndex.clientId, id))
      
      // Delete tasks for this client
      await db.delete(tasks).where(eq(tasks.clientId, id))
    } catch (manualDeleteError) {
      console.error('Failed to manually delete some client records:', manualDeleteError)
      // Continue with client deletion even if manual cleanup fails
    }
    
    // Delete the client (cascade will handle related data in other tables)
    await db.delete(clients).where(eq(clients.id, id))
    
    return { 
      ok: true, 
      message: `Client "${client.name}" and all related data have been permanently deleted.`
    }
  } catch (error) {
    console.error('Error deleting client:', error)
    
    if (error instanceof Error && error.message.includes('Client not found')) {
      throw error
    }
    
    throw createError({ 
      statusCode: 500, 
      statusMessage: 'Failed to delete client. Please try again.' 
    })
  }
})
