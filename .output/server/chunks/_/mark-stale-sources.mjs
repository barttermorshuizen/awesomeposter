import { h as defineTask } from '../nitro/nitro.mjs';
import { q as markStaleDiscoverySources } from './discovery-repository.mjs';
import { p as publishSourceHealthStatus } from './discovery-health.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';
import 'drizzle-orm';
import './client.mjs';
import 'drizzle-orm/node-postgres';
import 'pg';
import 'drizzle-orm/pg-core';
import 'zod';
import './feature-flags.mjs';
import '@upstash/redis';
import './discovery.mjs';
import './discovery-events.mjs';

const DEFAULT_WARNING_THRESHOLD_HOURS = 24;
function resolveWarningThresholdHours() {
  const raw = process.env.DISCOVERY_STALE_WARNING_HOURS;
  if (!raw) {
    return DEFAULT_WARNING_THRESHOLD_HOURS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_WARNING_THRESHOLD_HOURS;
}
async function runMarkStaleDiscoverySourcesJob(now = /* @__PURE__ */ new Date()) {
  var _a, _b, _c;
  const thresholdHours = resolveWarningThresholdHours();
  const cutoff = new Date(now.getTime() - thresholdHours * 60 * 60 * 1e3);
  let updates = [];
  try {
    updates = await markStaleDiscoverySources(cutoff, now);
  } catch (error) {
    console.error("[discovery.mark-stale] failed to evaluate stale sources", {
      error
    });
    throw error;
  }
  for (const stale of updates) {
    const { health } = stale;
    publishSourceHealthStatus({
      clientId: stale.clientId,
      sourceId: stale.sourceId,
      sourceType: stale.sourceType,
      status: health.status,
      lastFetchedAt: (_a = health.lastFetchedAt) != null ? _a : void 0,
      observedAt: health.observedAt,
      failureReason: (_b = health.failureReason) != null ? _b : void 0,
      consecutiveFailures: health.consecutiveFailures,
      staleSince: (_c = health.staleSince) != null ? _c : void 0
    });
  }
  return {
    updated: updates.length,
    thresholdHours
  };
}
const markStaleSources = defineTask({
  meta: {
    name: "discovery-mark-stale-sources",
    description: "Mark discovery sources as warning when no fetch has succeeded in the threshold window"
  },
  async run() {
    const result = await runMarkStaleDiscoverySourcesJob();
    return result;
  }
});

export { markStaleSources as default, runMarkStaleDiscoverySourcesJob };
//# sourceMappingURL=mark-stale-sources.mjs.map
