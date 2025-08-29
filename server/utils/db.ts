// This file provides a database utility wrapper
import { getDb as getDbInternal } from '@awesomeposter/db'
import { getEnv } from './env'

let initialized = false

export function getDb() {
  if (!initialized) {
    // Validate environment on first use
    getEnv()
    initialized = true
  }
  return getDbInternal()
}
