import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migrationPath = resolve('packages/db/migrations/20251026_add_flex_capability_kind.sql')
const migrationSql = readFileSync(migrationPath, 'utf-8')

describe('flex_capabilities kind migration', () => {
  it('adds a non-null kind column with the expected constraint', () => {
    expect(migrationSql).toMatch(/ALTER TABLE flex_capabilities\s+ADD COLUMN kind text;/)
    expect(migrationSql).toMatch(/ALTER TABLE flex_capabilities\s+ALTER COLUMN kind SET NOT NULL;/)
    expect(migrationSql).toMatch(/CHECK\s*\(kind IN \('structuring', 'execution', 'validation', 'transformation', 'routing'\)\)/)
  })

  it('backfills historical kinds using the legacy heuristics before enforcing constraints', () => {
    expect(migrationSql).toMatch(/SET kind = 'structuring'[\s\S]+(strategy|planner)/)
    expect(migrationSql).toMatch(/SET kind = 'validation'[\s\S]+(review|qa)/)
    expect(migrationSql).toMatch(/SET kind = 'transformation'[\s\S]+transform/)
    expect(migrationSql).toMatch(/SET kind = 'execution'\s+WHERE kind IS NULL;/)
  })
})
