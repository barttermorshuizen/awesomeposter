// Minimal shim for @awesomeposter/db to enable local API dev without Postgres/Drizzle.
// Provides no-op implementations so endpoints can start and basic GETs return empty data.

export type Row = Record<string, unknown>

class SelectBuilder {
  from(_table: unknown) {
    return {
      limit: async (_n: number) => [] as Row[],
    }
  }
}

class InsertBuilder {
  values(v: any) {
    const value = Array.isArray(v) ? (v[0] ?? {}) : (v ?? {})
    return {
      returning: async () => [{ id: Math.floor(Math.random() * 1_000_000), ...value }],
    }
  }
}

class UpdateBuilder {
  set(_vals: any) {
    return {
      where: async (_cond?: any) => ({ count: 1 }),
      returning: async () => [_vals],
    }
  }
}

class DeleteBuilder {
  where(_cond?: any) {
    return {
      returning: async () => [],
    }
  }
}

export function getDb() {
  return {
    select: () => new SelectBuilder(),
    insert: (_table: any) => new InsertBuilder(),
    update: (_table: any) => new UpdateBuilder(),
    delete: (_table: any) => new DeleteBuilder(),
    execute: async () => ({ rows: [] }),
  }
}

export function getPool() {
  // Some endpoints catch this and return safe fallbacks
  throw new Error('DATABASE_URL is not set')
}

// Drizzle helper shim
export const eq = (_a: any, _b: any) => true

// Table placeholders used by endpoints
export const assets = {} as any
export const briefs = {} as any
export const clients = {} as any
export const tasks = {} as any
export const emailsIngested = {} as any
export const clientProfiles = {} as any
export const examplesIndex = {} as any