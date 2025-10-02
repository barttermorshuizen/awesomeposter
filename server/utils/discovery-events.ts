import { EventEmitter } from 'node:events'
import type { DiscoveryEventEnvelope } from '@awesomeposter/shared'

const emitter = new EventEmitter()
emitter.setMaxListeners(100)

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
