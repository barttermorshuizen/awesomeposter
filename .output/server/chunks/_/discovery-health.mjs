import { e as emitDiscoveryEvent } from './discovery-events.mjs';

function normalizeTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
function publishSourceHealthStatus(input) {
  var _a;
  const observedAtIso = (_a = normalizeTimestamp(input.observedAt)) != null ? _a : (/* @__PURE__ */ new Date()).toISOString();
  const lastFetchedAtIso = normalizeTimestamp(input.lastFetchedAt);
  const staleSinceIso = normalizeTimestamp(input.staleSince);
  emitDiscoveryEvent({
    type: "source.health",
    version: 1,
    payload: {
      clientId: input.clientId,
      sourceId: input.sourceId,
      sourceType: input.sourceType,
      status: input.status,
      lastFetchedAt: lastFetchedAtIso,
      observedAt: observedAtIso,
      ...input.failureReason ? { failureReason: input.failureReason } : {},
      ...typeof input.consecutiveFailures === "number" ? { consecutiveFailures: input.consecutiveFailures } : {},
      ...typeof input.attempt === "number" ? { attempt: input.attempt } : {},
      ...staleSinceIso ? { staleSince: staleSinceIso } : {}
    }
  });
}

export { publishSourceHealthStatus as p };
//# sourceMappingURL=discovery-health.mjs.map
