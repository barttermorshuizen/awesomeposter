import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { getQuery, createError, defineEventHandler } from 'h3'
import { ZodError } from 'zod'
import { requireApiAuth } from '../../utils/api-auth'
import { assertClientAccess, requireUserSession } from '../../utils/session'
import {
  requireDiscoveryFeatureEnabled,
  requireFeatureEnabled,
  FEATURE_DISCOVERY_FILTERS_V1,
} from '../../utils/client-config/feature-flags'
import { emitDiscoveryEvent } from '../../utils/discovery-events'
import { parseDiscoverySearchFilters } from '@awesomeposter/shared'
import { searchDiscoveryItems } from '../../utils/discovery-repository'

const DEGRADE_LATENCY_THRESHOLD_MS = 400
const DEGRADE_TOTAL_RESULTS_THRESHOLD = 1000

export default defineEventHandler(async (event) => {
  requireApiAuth(event)
  const sessionUser = requireUserSession(event)

  const rawQuery = getQuery(event)

  let filters
  try {
    filters = parseDiscoverySearchFilters(rawQuery)
  } catch (error) {
    if (error instanceof ZodError) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid discovery search parameters',
        data: { issues: error.issues },
      })
    }
    throw error
  }

  assertClientAccess(sessionUser, filters.clientId)

  await requireDiscoveryFeatureEnabled(filters.clientId)
  await requireFeatureEnabled(filters.clientId, FEATURE_DISCOVERY_FILTERS_V1, 'Discovery filters are disabled for this client.')

  const requestId = randomUUID()
  const requestedAtIso = new Date().toISOString()
  const startedAt = performance.now()

  emitDiscoveryEvent({
    type: 'discovery.search.requested',
    version: 1,
    payload: {
      requestId,
      clientId: filters.clientId,
      requestedBy: sessionUser.id,
      page: filters.page,
      pageSize: filters.pageSize,
      statuses: filters.statuses,
      sourceCount: filters.sourceIds.length,
      topicCount: filters.topics.length,
      hasSearchTerm: Boolean(filters.searchTerm),
      searchTermLength: filters.searchTerm?.length ?? 0,
      requestedAt: requestedAtIso,
    },
  })

  const result = await searchDiscoveryItems(filters)

  const latencyMs = Math.max(0, Math.round(performance.now() - startedAt))

  let degradeReason: 'latency' | 'results' | 'other' | null = null
  if (latencyMs > DEGRADE_LATENCY_THRESHOLD_MS) {
    degradeReason = 'latency'
  } else if (result.total > DEGRADE_TOTAL_RESULTS_THRESHOLD) {
    degradeReason = 'results'
  }

  const completedAtIso = new Date().toISOString()

  emitDiscoveryEvent({
    type: 'discovery.search.completed',
    version: 1,
    payload: {
      requestId,
      clientId: filters.clientId,
      latencyMs,
      total: result.total,
      returned: result.items.length,
      page: filters.page,
      pageSize: filters.pageSize,
      statuses: filters.statuses,
      sourceCount: filters.sourceIds.length,
      topicCount: filters.topics.length,
      searchTermLength: filters.searchTerm?.length ?? 0,
      degraded: degradeReason !== null,
      degradeReason,
      completedAt: completedAtIso,
    },
  })

  return {
    items: result.items,
    total: result.total,
    page: filters.page,
    pageSize: filters.pageSize,
    latencyMs,
  }
})
