import { beforeEach, describe, expect, it, vi } from 'vitest'

let existingRecords: Array<{
  id: string
  clientId: string
  keyword: string
  keywordAlias: string
  addedBy: string | null
  createdAt: Date
  updatedAt: Date
}>

const selectMock = vi.fn()
const orderByMock = vi.fn()
let insertHandler: (record: unknown) => Promise<void> | void
let updateHandler: () => Promise<Array<Record<string, unknown>>> | Array<Record<string, unknown>>

vi.mock('@awesomeposter/db', () => ({
  getDb: () => ({
    select: selectMock,
    insert: () => ({
      values: (record: unknown) => insertHandler(record),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => updateHandler(),
        }),
      }),
    }),
  }),
  discoveryKeywords: {
    id: 'id',
    clientId: 'clientId',
    keyword: 'keyword',
    keywordAlias: 'keywordAlias',
    addedBy: 'addedBy',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
  },
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
}))

vi.mock('../client-config/feature-flags', () => ({
  requireDiscoveryFeatureEnabled: vi.fn().mockResolvedValue(undefined),
}))

describe('discovery keyword repository', () => {
  let createDiscoveryKeyword: typeof import('../discovery-repository').createDiscoveryKeyword
  let updateDiscoveryKeyword: typeof import('../discovery-repository').updateDiscoveryKeyword
  let DuplicateDiscoveryKeywordError: typeof import('../discovery-repository').DuplicateDiscoveryKeywordError

  beforeEach(async () => {
    existingRecords = []
    orderByMock.mockImplementation(async () => existingRecords)
    selectMock.mockImplementation(() => ({
      from: () => ({
        where: () => ({
          orderBy: orderByMock,
        }),
      }),
    }))

    insertHandler = async (record) => {
      existingRecords = [record as any, ...existingRecords]
    }
    updateHandler = async () => existingRecords.map((record) => ({ ...record }))

    vi.resetModules()
    const module = await import('../discovery-repository')
    createDiscoveryKeyword = module.createDiscoveryKeyword
    updateDiscoveryKeyword = module.updateDiscoveryKeyword
    DuplicateDiscoveryKeywordError = module.DuplicateDiscoveryKeywordError
  })

  it('translates unique violations during insert into DuplicateDiscoveryKeywordError', async () => {
    insertHandler = async () => {
      const error = new Error('duplicate key') as Error & { code?: string; constraint?: string }
      error.code = '23505'
      error.constraint = 'discovery_keywords_client_alias_unique'
      throw error
    }

    await expect(createDiscoveryKeyword({
      clientId: '00000000-0000-0000-0000-000000000123',
      keyword: 'Account Based Marketing',
    })).rejects.toBeInstanceOf(DuplicateDiscoveryKeywordError)
  })

  it('translates unique violations during update into DuplicateDiscoveryKeywordError', async () => {
    const now = new Date()
    existingRecords = [{
      id: '00000000-0000-0000-0000-000000000001',
      clientId: '00000000-0000-0000-0000-000000000123',
      keyword: 'account based marketing',
      keywordAlias: 'account-based marketing',
      addedBy: null,
      createdAt: now,
      updatedAt: now,
    }]

    updateHandler = async () => {
      const error = new Error('duplicate key') as Error & { code?: string; constraint?: string }
      error.code = '23505'
      error.constraint = 'discovery_keywords_client_alias_unique'
      throw error
    }

    await expect(updateDiscoveryKeyword({
      clientId: '00000000-0000-0000-0000-000000000123',
      keywordId: '00000000-0000-0000-0000-000000000001',
      keyword: 'New Keyword',
    })).rejects.toBeInstanceOf(DuplicateDiscoveryKeywordError)
  })
})
