import { EventEmitter } from 'node:events';

const globalScope = globalThis;
if (!globalScope.__awesomeposterDiscoveryEventEmitter__) {
  const globalEmitter = new EventEmitter();
  globalEmitter.setMaxListeners(100);
  globalScope.__awesomeposterDiscoveryEventEmitter__ = globalEmitter;
}
const emitter = globalScope.__awesomeposterDiscoveryEventEmitter__;
const CHANNEL = "event";
function emitDiscoveryEvent(event) {
  emitter.emit(CHANNEL, event);
}
function onDiscoveryEvent(listener) {
  emitter.on(CHANNEL, listener);
  return () => emitter.off(CHANNEL, listener);
}

export { emitDiscoveryEvent as e, onDiscoveryEvent as o };
//# sourceMappingURL=discovery-events.mjs.map
