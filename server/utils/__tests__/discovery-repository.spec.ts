import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DiscoverySourceRecord } from '../discovery-repository'
import { createDiscoverySource, DuplicateDiscoverySourceError } from '../discovery-repository'

const records: DiscoverySourceRecord[] = []

type InsertHandler = (rows: DiscoverySourceRecord[]) => Promise<void>

let insertHandler: InsertHandler = async (rows) => {
  records.push(...rows)
}

function createSelectBuilder() {
  return {
    selection: null as Record<string, keyof DiscoverySourceRecord> | null,
    condition: null as unknown,
    select(selection: Record<string, keyof DiscoverySourceRecord>) {
      this.selection = selection
      return this
    },
    from() {
      return this
    },
    where(condition: unknown) {
      this.condition = condition
      return this
    },
    limit(count?: number) {
      return Promise.resolve(applyCondition(records, this.condition)
        .slice(0, count ?? records.length)
        .map((row) => project(row, this.selection)))
    },
    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | undefined,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined,
    ) {
      return this.limit()?.then(onfulfilled, onrejected)
    },
  }
}

function applyCondition(rows: DiscoverySourceRecord[], condition: unknown) {
  if (!condition) return rows

  if (isAnd(condition)) {
    return rows.filter((row) => condition.conditions.every((child) => matches(row, child)))
  }

  return rows.filter((row) => matches(row, condition))
}

function matches(row: DiscoverySourceRecord, condition: unknown): boolean {
  if (isEq(condition)) {
    return row[condition.column] === condition.value
  }
  return true
}

function project(row: DiscoverySourceRecord, selection: Record<string, keyof DiscoverySourceRecord> | null) {
  if (!selection) return row
  return Object.entries(selection).reduce<Record<string, unknown>>((acc, [alias, column]) => {
    acc[alias] = row[column]
    return acc
  }, {})
}

function isAnd(value: unknown): value is { type: 'and'; conditions: unknown[] } {
  return typeof value === 'object' && value !== null && (value as any).type === 'and'
}

function isEq(value: unknown): value is { type: 'eq'; column: keyof DiscoverySourceRecord; value: unknown } {
  return typeof value === 'object' && value !== null && (value as any).type === 'eq'
}

vi.mock('@awesomeposter/db', () => ({
  getDb: () => ({
    select: (selection: Record<string, keyof DiscoverySourceRecord>) => {
      return createSelectBuilder().select(selection)
    },
    insert: () => ({
      values: (rows: DiscoverySourceRecord[]) => {
        return insertHandler(rows)
      },
    }),
  }),
  discoverySources: {
    id: 'id',
    clientId: 'clientId',
    sourceType: 'sourceType',
    identifier: 'identifier',
  },
  and: (...conditions: unknown[]) => ({ type: 'and', conditions }),
  eq: (column: keyof DiscoverySourceRecord, value: unknown) => ({ type: 'eq', column, value }),
}))

vi.mock('../client-config/feature-flags', () => ({
  requireDiscoveryFeatureEnabled: vi.fn().mockResolvedValue(undefined),
}))

describe('createDiscoverySource duplicate detection', () => {
  beforeEach(() => {
    records.length = 0
    insertHandler = async (rows) => {
      records.push(...rows)
    }
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('rejects duplicate YouTube channels regardless of casing', async () => {
    const clientId = '00000000-0000-0000-0000-000000000001'
    records.push({
      id: 'existing-youtube',
      clientId,
      url: 'https://youtube.com/channel/UCExample',
      canonicalUrl: 'https://youtube.com/channel/UCExample',
      sourceType: 'youtube-channel',
      identifier: 'UCEXAMPLE',
      notes: null,
      configJson: null,
      fetchIntervalMinutes: 60,
      nextFetchAt: new Date(),
      lastFetchStatus: 'idle',
      lastFetchStartedAt: null,
      lastFetchCompletedAt: null,
      lastFailureReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await expect(createDiscoverySource({
      clientId,
      url: 'https://www.youtube.com/channel/ucexample',
    })).rejects.toMatchObject({ duplicateKey: 'youtube-channel::ucexample' })
  })

  it('rejects duplicate RSS feeds when the path casing differs', async () => {
    const clientId = '00000000-0000-0000-0000-000000000002'
    records.push({
      id: 'existing-rss',
      clientId,
      url: 'https://blog.example.com/Feed.xml',
      canonicalUrl: 'https://blog.example.com/Feed.xml',
      sourceType: 'rss',
      identifier: 'https://blog.example.com/Feed.xml',
      notes: null,
      configJson: { rss: { canonical: true } },
      fetchIntervalMinutes: 60,
      nextFetchAt: new Date(),
      lastFetchStatus: 'idle',
      lastFetchStartedAt: null,
      lastFetchCompletedAt: null,
      lastFailureReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await expect(createDiscoverySource({
      clientId,
      url: 'https://blog.example.com/feed.xml',
    })).rejects.toBeInstanceOf(DuplicateDiscoverySourceError)
  })
  it('translates database unique violations into DuplicateDiscoverySourceError', async () => {
    const clientId = '00000000-0000-0000-0000-000000000003'
    insertHandler = async () => {
      const error = new Error('duplicate key value violates unique constraint') as Error & { code?: string; constraint?: string }
      error.code = '23505'
      error.constraint = 'discovery_sources_client_identifier_lower_unique'
      throw error
    }

    await expect(createDiscoverySource({
      clientId,
      url: 'https://www.youtube.com/channel/UC123ABC',
    })).rejects.toBeInstanceOf(DuplicateDiscoverySourceError)
  })
})
