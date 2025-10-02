import { EventEmitter } from 'node:events'
import type { DiscoveryEventEnvelope } from '@awesomeposter/shared'

type DiscoveryEventGlobal = typeof globalThis & {
  __awesomeposterDiscoveryEventEmitter__?: EventEmitter
}

const globalScope = globalThis as DiscoveryEventGlobal

if (!globalScope.__awesomeposterDiscoveryEventEmitter__) {
  const globalEmitter = new EventEmitter()
  globalEmitter.setMaxListeners(100)
  globalScope.__awesomeposterDiscoveryEventEmitter__ = globalEmitter
}

const emitter = globalScope.__awesomeposterDiscoveryEventEmitter__!

const CHANNEL = 'event'

export function emitDiscoveryEvent(event: DiscoveryEventEnvelope) {
  emitter.emit(CHANNEL, event)
}

export function onDiscoveryEvent(listener: (event: DiscoveryEventEnvelope) => void) {
  emitter.on(CHANNEL, listener)
  return () => emitter.off(CHANNEL, listener)
}

export function getDiscoveryEventEmitter() {
  return emitter
}
