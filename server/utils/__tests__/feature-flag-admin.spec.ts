import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  publishMock,
  emitMock,
} = vi.hoisted(() => ({
  publishMock: vi.fn(),
  emitMock: vi.fn(),
}))

const {
  clientsTable,
  clientFeaturesTable,
  clientFeatureToggleAuditsTable,
} = vi.hoisted(() => ({
  clientsTable: { table: 'clients' },
  clientFeaturesTable: { table: 'client_features' },
  clientFeatureToggleAuditsTable: { table: 'client_feature_toggle_audits' },
}))

const selectMock = vi.fn()
const fromMock = vi.fn()
const whereMock = vi.fn()
const limitMock = vi.fn()
const insertMock = vi.fn()
const updateMock = vi.fn()

const insertedRecords: Array<{ table: string; values: Record<string, unknown> }> = []
const updatedRecords: Array<{ table: string; values: Record<string, unknown> }> = []

const tx = {
  select: selectMock,
  from: fromMock,
  where: whereMock,
  limit: limitMock,
  insert: insertMock,
  update: updateMock,
}

selectMock.mockReturnValue(tx)
fromMock.mockReturnValue(tx)
whereMock.mockReturnValue(tx)

insertMock.mockImplementation((table: any) => ({
  values: async (values: Record<string, unknown>) => {
    insertedRecords.push({ table: table.table ?? table, values })
  },
}))

updateMock.mockImplementation((table: any) => ({
  set: (values: Record<string, unknown>) => ({
    where: async () => {
      updatedRecords.push({ table: table.table ?? table, values })
    },
  }),
}))

vi.mock('@awesomeposter/db', () => ({
  clients: clientsTable,
  clientFeatures: clientFeaturesTable,
  clientFeatureToggleAudits: clientFeatureToggleAuditsTable,
  eq: (column: unknown, value: unknown) => ({ column, value }),
  and: (...conditions: unknown[]) => conditions,
  getDb: () => ({
    transaction: async (callback: (tx: typeof tx) => Promise<any>) => callback(tx),
  }),
}))

vi.mock('../client-config/feature-flags.ts', () => ({
  FEATURE_DISCOVERY_AGENT: 'discovery-agent',
  FEATURE_DISCOVERY_FILTERS_V1: 'discovery.filters.v1',
  FEATURE_FLAG_PUBSUB_TOPIC: 'feature.flags.updated',
  DISCOVERY_FLAG_CHANGED_EVENT: 'discovery.flagChanged',
  publishFeatureFlagUpdate: publishMock,
  emitDiscoveryFlagChanged: emitMock,
}))

import {
  ClientNotFoundError,
  FeatureFlagAdminError,
  setClientFeatureFlag,
  setDiscoveryFlag,
} from '../client-config/feature-flag-admin'

function mockSelectResponses(responses: unknown[][]) {
  limitMock.mockReset()
  responses.forEach((response) => {
    limitMock.mockResolvedValueOnce(response)
  })
  limitMock.mockImplementation(async () => [])
}

beforeEach(() => {
  selectMock.mockClear()
  fromMock.mockClear()
  whereMock.mockClear()
  limitMock.mockReset()
  insertMock.mockClear()
  updateMock.mockClear()
  insertedRecords.length = 0
  updatedRecords.length = 0
  publishMock.mockClear()
  emitMock.mockClear()
})

describe('setDiscoveryFlag', () => {
  it('enables discovery when previously disabled and emits events', async () => {
    mockSelectResponses([
      [{ id: 'client-1', name: 'Acme', slug: 'acme' }],
      [{ enabled: false }],
    ])

    await setDiscoveryFlag({
      clientId: 'client-1',
      enable: true,
      actor: 'bart@awesomeposter.com',
      reason: 'pilot launch',
    })

    expect(updatedRecords).toHaveLength(1)
    expect(updatedRecords[0].table).toBe(clientFeaturesTable.table)
    expect(insertedRecords).toHaveLength(1)
    expect(insertedRecords[0].table).toBe(clientFeatureToggleAuditsTable.table)

    expect(emitMock).toHaveBeenCalledTimes(1)
    expect(publishMock).toHaveBeenCalledTimes(1)

    const payload = emitMock.mock.calls[0][0]
    expect(payload).toMatchObject({
      event: 'discovery.flagChanged',
      clientId: 'client-1',
      enabled: true,
      previousEnabled: false,
      actor: 'bart@awesomeposter.com',
      reason: 'pilot launch',
    })
  })

  it('inserts feature flag record when none exists', async () => {
    mockSelectResponses([
      [{ id: 'client-2', name: 'Beta', slug: null }],
      [],
    ])

    await setDiscoveryFlag({
      clientId: 'client-2',
      enable: true,
      actor: 'qa',
    })

    // Expect two inserts: feature flag + audit
    expect(insertedRecords).toHaveLength(2)
    const tables = insertedRecords.map((record) => record.table)
    expect(tables).toContain(clientFeaturesTable.table)
    expect(tables).toContain(clientFeatureToggleAuditsTable.table)
  })

  it('returns early without emitting when state already matches', async () => {
    mockSelectResponses([
      [{ id: 'client-3', name: 'Gamma', slug: null }],
      [{ enabled: true }],
    ])

    const result = await setDiscoveryFlag({
      clientId: 'client-3',
      enable: true,
      actor: 'ops',
    })

    expect(result.changed).toBe(false)
    expect(insertedRecords).toHaveLength(0)
    expect(updatedRecords).toHaveLength(0)
    expect(emitMock).not.toHaveBeenCalled()
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('throws when actor is missing', async () => {
    mockSelectResponses([
      [{ id: 'client-4', name: 'Delta', slug: null }],
      [{ enabled: false }],
    ])

    await expect(setDiscoveryFlag({
      clientId: 'client-4',
      enable: true,
      actor: '   ',
    })).rejects.toBeInstanceOf(FeatureFlagAdminError)

    expect(insertedRecords).toHaveLength(0)
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('throws ClientNotFoundError when client is missing', async () => {
    mockSelectResponses([
      [],
    ])

    await expect(setDiscoveryFlag({
      clientId: 'missing',
      enable: false,
      actor: 'ops',
    })).rejects.toBeInstanceOf(ClientNotFoundError)
  })
})

describe('setClientFeatureFlag', () => {
  it('supports toggling discovery.filters.v1 without emitting discovery telemetry', async () => {
    mockSelectResponses([
      [{ id: 'client-55', name: 'Omega', slug: null }],
      [{ enabled: false }],
    ])

    await setClientFeatureFlag({
      clientId: 'client-55',
      feature: 'discovery.filters.v1',
      enable: true,
      actor: 'qa@test',
    })

    expect(emitMock).not.toHaveBeenCalled()
    expect(publishMock).toHaveBeenCalledTimes(1)
    const payload = publishMock.mock.calls[0][0]
    expect(payload).toMatchObject({ feature: 'discovery.filters.v1', clientId: 'client-55', enabled: true })
  })

  it('rejects unsupported feature keys', async () => {
    await expect(setClientFeatureFlag({
      clientId: 'client-66',
      feature: 'random-feature',
      enable: true,
      actor: 'qa',
    })).rejects.toBeInstanceOf(FeatureFlagAdminError)
  })
})
