import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema.js'

export type Database = NodePgDatabase<typeof schema>

let cachedPool: pg.Pool | null = null
let cachedDb: Database | null = null

export function getPool(): pg.Pool {
  if (cachedPool) return cachedPool

  let databaseUrl: string | undefined
  try {
    const runtimeConfig = useRuntimeConfig()
    databaseUrl = runtimeConfig.DATABASE_URL
  } catch {
    databaseUrl = process.env.DATABASE_URL
  }

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set in runtime config or process.env')
  }

  cachedPool = new pg.Pool({ connectionString: databaseUrl })
  return cachedPool
}

export function getDb(): Database {
  if (cachedDb) return cachedDb
  const pool = getPool()
  cachedDb = drizzle(pool, { schema })
  return cachedDb
}
