import { getDb as getDbInternal } from '@awesomeposter/db'
import { getEnv } from './env'

let initialized = false

export function getDb() {
  if (!initialized) {
    // forces env validation
    getEnv()
    initialized = true
  }
  return getDbInternal()
}


