import { getDb as getDbInternal } from '@awesomeposter/db'
import { getEnv } from './env'

let initialized = false

export function getDb() {
  if (!initialized) {
    // Attempt env validation but don't block local dev if DATABASE_URL is missing
    try {
      getEnv()
    } catch {
      // In dev without DATABASE_URL we proceed with the shimmed/mock DB
    }
    initialized = true
  }
  return getDbInternal()
}


