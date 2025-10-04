import { randomUUID } from 'node:crypto';
import { i as listDiscoverySourcesDue, j as claimDiscoverySourceForFetch, k as completeDiscoverySourceFetch } from './discovery-repository.mjs';
import { e as emitDiscoveryEvent } from './discovery-events.mjs';
import { e as discoveryIngestionFailureReasonSchema } from './discovery.mjs';
import './index.mjs';
import '../nitro/nitro.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:url';
import 'drizzle-orm/node-postgres';
import 'pg';
import 'drizzle-orm/pg-core';
import 'drizzle-orm';
import 'zod';
import './feature-flags.mjs';
import '@upstash/redis';

function resolveFailureReason$1(responseStatus) {
  if (responseStatus >= 500)
    return "http_5xx";
  if (responseStatus >= 400)
    return "http_4xx";
  return "unknown_error";
}
async function readResponseBody(response) {
  try {
    const cloned = response.clone();
    return await cloned.text();
  } catch (error) {
    return { error: error.message };
  }
}
const fetchHttpSource = async (input, context) => {
  var _a;
  const fetcher = (_a = context == null ? void 0 : context.fetch) != null ? _a : globalThis.fetch;
  if (!fetcher) {
    return {
      ok: false,
      failureReason: "unknown_error",
      error: new Error("No fetch implementation available for HTTP adapter")
    };
  }
  try {
    const response = await fetcher(input.url, { signal: context == null ? void 0 : context.signal });
    if (!response.ok) {
      const failureReason = resolveFailureReason$1(response.status);
      const raw = {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: await readResponseBody(response)
      };
      return {
        ok: false,
        failureReason,
        raw,
        retryInMinutes: failureReason === "http_5xx" ? 5 : null,
        metadata: {
          adapter: "http",
          status: response.status
        }
      };
    }
    const body = await response.text();
    return {
      ok: true,
      items: [],
      raw: {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries())
      },
      metadata: {
        adapter: "http",
        contentLength: body.length
      }
    };
  } catch (error) {
    const err = error;
    const failureReason = err.name === "AbortError" ? "timeout" : "network_error";
    return {
      ok: false,
      failureReason,
      error: err,
      retryInMinutes: failureReason === "network_error" ? 5 : null,
      metadata: {
        adapter: "http",
        message: err.message
      }
    };
  }
};

const fetchRssSource = async (input, context) => {
  var _a, _b;
  const result = await fetchHttpSource(input, context);
  if (result.ok) {
    return {
      ...result,
      metadata: {
        ...(_a = result.metadata) != null ? _a : {},
        adapter: "rss"
      }
    };
  }
  return {
    ...result,
    metadata: {
      ...(_b = result.metadata) != null ? _b : {},
      adapter: "rss"
    }
  };
};

function mapYoutubeFailureReason(result) {
  var _a, _b, _c;
  if (result.ok) {
    return {
      ...result,
      metadata: {
        ...(_a = result.metadata) != null ? _a : {},
        adapter: "youtube"
      }
    };
  }
  let failureReason = result.failureReason;
  const status = typeof ((_b = result.metadata) == null ? void 0 : _b.status) === "number" ? result.metadata.status : null;
  if (status === 403 || status === 429) {
    failureReason = "youtube_quota";
  } else if (status === 404) {
    failureReason = "youtube_not_found";
  }
  return {
    ...result,
    failureReason,
    metadata: {
      ...(_c = result.metadata) != null ? _c : {},
      adapter: "youtube"
    }
  };
}
const fetchYoutubeSource = async (input, context) => {
  var _a, _b, _c, _d;
  const result = await fetchHttpSource(input, context);
  const normalized = result.ok ? result : {
    ...result,
    metadata: {
      ...(_a = result.metadata) != null ? _a : {},
      status: (_d = (_b = result.metadata) == null ? void 0 : _b.status) != null ? _d : typeof ((_c = result.raw) == null ? void 0 : _c.status) === "number" ? result.raw.status : void 0
    }
  };
  return mapYoutubeFailureReason(normalized);
};

const ADAPTERS = {
  "web-page": fetchHttpSource,
  rss: fetchRssSource,
  "youtube-channel": fetchYoutubeSource,
  "youtube-playlist": fetchYoutubeSource
};
function getIngestionAdapter(type) {
  const adapter = ADAPTERS[type];
  if (!adapter) {
    throw new Error(`No ingestion adapter registered for type ${type}`);
  }
  return adapter;
}
async function executeIngestionAdapter(input, context) {
  const adapter = getIngestionAdapter(input.sourceType);
  return adapter(input, context);
}

const DEFAULT_WORKER_LIMIT = 3;
const MAX_BATCH_MULTIPLIER = 4;
const EVENT_VERSION = 1;
function parseWorkerLimit(raw) {
  const parsed = Number.parseInt(raw != null ? raw : "", 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_WORKER_LIMIT;
}
function resolveFailureReason(raw) {
  if (typeof raw === "string") {
    const result = discoveryIngestionFailureReasonSchema.safeParse(raw);
    if (result.success) return result.data;
  }
  return "unknown_error";
}
function buildAdapterTelemetry(result) {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j;
  if (result.ok) {
    return {
      adapter: (_b = (_a = result.metadata) == null ? void 0 : _a.adapter) != null ? _b : "unknown",
      itemsFetched: result.items.length,
      metadata: (_c = result.metadata) != null ? _c : null
    };
  }
  return {
    adapter: (_e = (_d = result.metadata) == null ? void 0 : _d.adapter) != null ? _e : "unknown",
    metadata: (_f = result.metadata) != null ? _f : null,
    error: {
      message: (_h = (_g = result.error) == null ? void 0 : _g.message) != null ? _h : null,
      name: (_j = (_i = result.error) == null ? void 0 : _i.name) != null ? _j : null
    }
  };
}
async function processSource(source, options, stats) {
  var _a, _b, _c, _d;
  const claimed = await claimDiscoverySourceForFetch(source.id, options.now());
  if (!claimed) {
    stats.skipped += 1;
    return;
  }
  const runId = randomUUID();
  const startedAt = options.now();
  const scheduledAt = (_a = source.nextFetchAt) != null ? _a : startedAt;
  emitDiscoveryEvent({
    type: "ingestion.started",
    version: EVENT_VERSION,
    payload: {
      runId,
      clientId: claimed.clientId,
      sourceId: claimed.id,
      sourceType: claimed.sourceType,
      scheduledAt: scheduledAt.toISOString(),
      startedAt: startedAt.toISOString()
    }
  });
  let success = false;
  let failureReason = null;
  let retryInMinutes = null;
  let adapterResult = null;
  try {
    adapterResult = await executeIngestionAdapter(
      {
        sourceId: claimed.id,
        clientId: claimed.clientId,
        sourceType: claimed.sourceType,
        url: claimed.url,
        canonicalUrl: claimed.canonicalUrl,
        config: (_b = claimed.configJson) != null ? _b : null
      },
      { fetch: options.fetch, now: options.now }
    );
    if (adapterResult.ok) {
      success = true;
    } else {
      success = false;
      failureReason = adapterResult.failureReason;
      retryInMinutes = (_c = adapterResult.retryInMinutes) != null ? _c : null;
    }
  } catch (error) {
    success = false;
    failureReason = resolveFailureReason((_d = error == null ? void 0 : error.cause) != null ? _d : null);
    adapterResult = {
      ok: false,
      failureReason,
      error,
      retryInMinutes: null,
      metadata: { adapter: "unknown" }
    };
  }
  const completedAt = options.now();
  const durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime());
  await completeDiscoverySourceFetch({
    runId,
    sourceId: claimed.id,
    clientId: claimed.clientId,
    startedAt,
    completedAt,
    fetchIntervalMinutes: claimed.fetchIntervalMinutes,
    success,
    failureReason,
    retryInMinutes,
    telemetry: {
      durationMs,
      ...adapterResult ? buildAdapterTelemetry(adapterResult) : {}
    }
  });
  emitDiscoveryEvent({
    type: "ingestion.completed",
    version: EVENT_VERSION,
    payload: {
      runId,
      clientId: claimed.clientId,
      sourceId: claimed.id,
      sourceType: claimed.sourceType,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs,
      success,
      failureReason: failureReason != null ? failureReason : void 0,
      retryInMinutes: retryInMinutes != null ? retryInMinutes : void 0
    }
  });
  if (success) {
    stats.succeeded += 1;
  } else {
    stats.failed += 1;
  }
}
async function runDiscoveryIngestionJob(opts = {}) {
  var _a, _b, _c, _d;
  const nowFn = (_a = opts.now) != null ? _a : (() => /* @__PURE__ */ new Date());
  const workerLimit = (_b = opts.workerLimit) != null ? _b : parseWorkerLimit(process.env.DISCOVERY_INGEST_WORKERS);
  const fetchImpl = (_c = opts.fetch) != null ? _c : typeof globalThis.fetch === "function" ? globalThis.fetch : void 0;
  const batchSize = (_d = opts.batchSize) != null ? _d : Math.max(workerLimit * MAX_BATCH_MULTIPLIER, workerLimit);
  const dueSources = await listDiscoverySourcesDue(batchSize, nowFn());
  const stats = {
    totalDue: dueSources.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0
  };
  if (dueSources.length === 0) {
    return stats;
  }
  const runnerOptions = {
    now: nowFn,
    ...fetchImpl ? { fetch: fetchImpl } : {}
  };
  const queue = [...dueSources];
  const active = /* @__PURE__ */ new Set();
  const launch = (source) => {
    const task = (async () => {
      stats.processed += 1;
      await processSource(source, runnerOptions, stats);
    })().catch((error) => {
      console.error("[discovery.ingest] failed to process source", {
        sourceId: source.id,
        error
      });
      stats.failed += 1;
    });
    const tracked = task.finally(() => {
      active.delete(tracked);
    });
    active.add(tracked);
  };
  const refill = () => {
    while (active.size < workerLimit && queue.length > 0) {
      const next = queue.shift();
      launch(next);
    }
  };
  refill();
  while (active.size > 0) {
    await Promise.race(active);
    refill();
  }
  return stats;
}
async function discoveryIngestionCron() {
  await runDiscoveryIngestionJob();
}

export { discoveryIngestionCron as default, runDiscoveryIngestionJob };
//# sourceMappingURL=ingest-sources.mjs.map
