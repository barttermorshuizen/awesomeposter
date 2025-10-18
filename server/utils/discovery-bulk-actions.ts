import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import {
  archiveDiscoveryItem,
  promoteDiscoveryItem,
  type ArchiveDiscoveryItemOptions,
  type PromoteDiscoveryItemOptions,
  DiscoveryItemNotFoundError,
  DiscoveryItemAlreadyPromotedError,
  DiscoveryItemAlreadyArchivedError,
} from './discovery-repository'
import { emitDiscoveryEvent } from './discovery-events'
import type {
  DiscoveryBulkActionRequest,
  DiscoveryBulkActionResponse,
  DiscoveryBulkActionItemResult,
} from '@awesomeposter/shared'
import { getDb, discoveryBulkActionAudits } from '@awesomeposter/db'

const DEFAULT_ACTOR_NAME = 'Discovery Reviewer'

function toPromoteOptions(request: DiscoveryBulkActionRequest, itemId: string): PromoteDiscoveryItemOptions {
  return {
    itemId,
    note: request.note,
    actorId: request.actorId,
    actorName: DEFAULT_ACTOR_NAME,
  }
}

function toArchiveOptions(request: DiscoveryBulkActionRequest, itemId: string): ArchiveDiscoveryItemOptions {
  return {
    itemId,
    note: request.note,
    actorId: request.actorId,
    actorName: DEFAULT_ACTOR_NAME,
  }
}

export async function executeDiscoveryBulkAction(
  action: 'promote' | 'archive',
  request: DiscoveryBulkActionRequest,
): Promise<DiscoveryBulkActionResponse> {
  const startedAt = performance.now()
  const results: DiscoveryBulkActionItemResult[] = []
  const auditResults: Array<{
    itemId: string
    status: DiscoveryBulkActionItemResult['status']
    message?: string | null
    briefId?: string | null
  }> = []
  const successBriefIds: string[] = []

  for (const itemId of request.itemIds) {
    try {
      if (action === 'promote') {
        const detail = await promoteDiscoveryItem(toPromoteOptions(request, itemId))
        if (detail.briefRef?.briefId) {
          successBriefIds.push(detail.briefRef.briefId)
        }
        results.push({ itemId, status: 'success', message: null, briefId: detail.briefRef?.briefId ?? null })
        auditResults.push({
          itemId,
          status: 'success',
          message: null,
          briefId: detail.briefRef?.briefId ?? null,
        })
      } else {
        await archiveDiscoveryItem(toArchiveOptions(request, itemId))
        results.push({ itemId, status: 'success', message: null, briefId: null })
        auditResults.push({
          itemId,
          status: 'success',
          message: null,
        })
      }
    } catch (error) {
      if (error instanceof DiscoveryItemNotFoundError) {
        results.push({ itemId, status: 'failed', message: error.message, briefId: null })
        auditResults.push({ itemId, status: 'failed', message: error.message })
      } else if (
        error instanceof DiscoveryItemAlreadyPromotedError ||
        error instanceof DiscoveryItemAlreadyArchivedError
      ) {
        results.push({ itemId, status: 'conflict', message: error.message, briefId: null })
        auditResults.push({ itemId, status: 'conflict', message: error.message })
      } else {
        console.error(`[DiscoveryBulkActions] Failed to ${action} discovery item ${itemId}`, error)
        results.push({
          itemId,
          status: 'failed',
          message: error instanceof Error ? error.message : String(error),
          briefId: null,
        })
        auditResults.push({
          itemId,
          status: 'failed',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  const success = results.filter((entry) => entry.status === 'success').length
  const conflict = results.filter((entry) => entry.status === 'conflict').length
  const failed = results.filter((entry) => entry.status === 'failed').length
  const durationMs = Math.max(0, Math.round(performance.now() - startedAt))

  await recordBulkActionAudit(action, request, {
    results: auditResults,
    success,
    conflict,
    failed,
    durationMs,
    successBriefIds,
  }).catch((error) => {
    console.error('[DiscoveryBulkActions] Failed to persist bulk action audit record', error)
  })

  emitDiscoveryEvent({
    type: 'discovery.bulk.action.completed',
    version: 1,
    payload: {
      actionId: request.actionId,
      action,
      clientId: request.clientId,
      actorId: request.actorId,
      itemCount: request.itemIds.length,
      successCount: success,
      conflictCount: conflict,
      failedCount: failed,
      durationMs,
      filtersSnapshot: request.filtersSnapshot,
      recordedAt: new Date().toISOString(),
      results: auditResults.map((entry) => ({
        itemId: entry.itemId,
        status: entry.status,
        message: entry.message ?? null,
        briefId: entry.briefId ?? null,
      })),
    },
  })

  return {
    actionId: request.actionId,
    summary: {
      success,
      conflict,
      failed,
      durationMs,
    },
    results,
  }
}

async function recordBulkActionAudit(
  action: 'promote' | 'archive',
  request: DiscoveryBulkActionRequest,
  options: {
    results: Array<{ itemId: string; status: DiscoveryBulkActionItemResult['status']; message?: string | null; briefId?: string | null }>
    success: number
    conflict: number
    failed: number
    durationMs: number
    successBriefIds: string[]
  },
) {
  const db = getDb()
  const successIds = options.results.filter((entry) => entry.status === 'success').map((entry) => entry.itemId)
  const conflictIds = options.results.filter((entry) => entry.status === 'conflict').map((entry) => entry.itemId)
  const failedIds = options.results.filter((entry) => entry.status === 'failed').map((entry) => entry.itemId)

  const payload = {
    id: randomUUID(),
    actionId: request.actionId,
    clientId: request.clientId,
    actorId: request.actorId,
    actorName: DEFAULT_ACTOR_NAME,
    action,
    note: request.note ?? null,
    filtersSnapshot: request.filtersSnapshot ?? null,
    itemIds: request.itemIds,
    successIds,
    conflictIds,
    failedIds,
    successBriefIds: options.successBriefIds,
    resultsJson: options.results.map((entry) => ({
      itemId: entry.itemId,
      status: entry.status,
      message: entry.message ?? null,
      briefId: entry.briefId ?? null,
    })),
    successCount: options.success,
    conflictCount: options.conflict,
    failedCount: options.failed,
    totalCount: request.itemIds.length,
    durationMs: options.durationMs,
  }

  await db
    .insert(discoveryBulkActionAudits)
    .values(payload)
    .onConflictDoUpdate({
      target: discoveryBulkActionAudits.actionId,
      set: {
        clientId: payload.clientId,
        actorId: payload.actorId,
        actorName: payload.actorName,
        action: payload.action,
        note: payload.note,
        filtersSnapshot: payload.filtersSnapshot,
        itemIds: payload.itemIds,
        successIds: payload.successIds,
        conflictIds: payload.conflictIds,
        failedIds: payload.failedIds,
        successBriefIds: payload.successBriefIds,
        resultsJson: payload.resultsJson,
        successCount: payload.successCount,
        conflictCount: payload.conflictCount,
        failedCount: payload.failedCount,
        totalCount: payload.totalCount,
        durationMs: payload.durationMs,
      },
    })
}
