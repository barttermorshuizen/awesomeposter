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

  for (const itemId of request.itemIds) {
    try {
      if (action === 'promote') {
        await promoteDiscoveryItem(toPromoteOptions(request, itemId))
      } else {
        await archiveDiscoveryItem(toArchiveOptions(request, itemId))
      }
      results.push({ itemId, status: 'success' })
    } catch (error) {
      if (error instanceof DiscoveryItemNotFoundError) {
        results.push({ itemId, status: 'failed', message: error.message })
      } else if (
        error instanceof DiscoveryItemAlreadyPromotedError ||
        error instanceof DiscoveryItemAlreadyArchivedError
      ) {
        results.push({ itemId, status: 'conflict', message: error.message })
      } else {
        console.error(`[DiscoveryBulkActions] Failed to ${action} discovery item ${itemId}`, error)
        results.push({
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
