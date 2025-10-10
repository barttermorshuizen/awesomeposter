import { AsyncLocalStorage } from 'node:async_hooks'
import type { HitlRequestRecord, HitlRunState } from '@awesomeposter/shared'
import type { HitlService } from './hitl-service'

type HitlContext = {
  runId: string
  threadId?: string
  stepId?: string
  capabilityId?: string
  hitlService: HitlService
  limit: { current: number; max: number }
  onRequest: (record: HitlRequestRecord, state: HitlRunState) => void
  onDenied: (reason: string, state: HitlRunState) => void
  snapshot: HitlRunState
}

const storage = new AsyncLocalStorage<HitlContext>()

export function withHitlContext<T>(ctx: HitlContext, fn: () => Promise<T> | T): Promise<T> | T {
  return storage.run(ctx, fn)
}

export function getHitlContext(): HitlContext | undefined {
  return storage.getStore()
}
