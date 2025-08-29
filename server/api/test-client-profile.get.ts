import { getPool } from '@awesomeposter/db'
import { generateMinimalClientProfile, validateClientProfileStructure } from '../utils/sample-client-profile'

export default defineEventHandler(async (event) => {
  try {
    const pool = getPool()
    
    // Get all client profiles to see what's in the database
    const { rows } = await pool.query('SELECT * FROM client_profiles LIMIT 5')
    
    // Generate a sample profile for comparison
    const sampleProfile = generateMinimalClientProfile()
    
    // Test validation
    const validation = validateClientProfileStructure(sampleProfile)
    
    return {
      ok: true,
      databaseProfiles: rows,
      sampleProfile,
      validation,
      message: 'Client profile test completed'
    }
  } catch (error) {
    console.error('Error testing client profiles:', error)
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      message: 'Failed to test client profiles'
    }
  }
})
