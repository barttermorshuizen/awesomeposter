import { a as setHeader } from '../nitro/nitro.mjs';
import { getLogger } from './logger.mjs';

function createSse(event, opts = {}) {
  var _a, _b;
  const res = event.node.res;
  const heartbeatMs = (_a = opts.heartbeatMs) != null ? _a : 15e3;
  const correlationId = opts.correlationId;
  let id = 1;
  let closed = false;
  setHeader(event, "Content-Type", "text/event-stream; charset=utf-8");
  setHeader(event, "Cache-Control", "no-cache, no-transform");
  setHeader(event, "Connection", "keep-alive");
  setHeader(event, "X-Accel-Buffering", "no");
  setHeader(event, "Content-Encoding", "identity");
  try {
    (_b = res.flushHeaders) == null ? void 0 : _b.call(res);
  } catch {
  }
  res.write(":\n\n");
  const writeRaw = (chunk) => new Promise((resolve) => {
    if (closed) return resolve();
    const ok = res.write(chunk);
    if (ok) return resolve();
    const start = Date.now();
    try {
      const log = getLogger();
      log.warn("sse_backpressure", {
        correlationId,
        bytes: typeof chunk === "string" ? Buffer.byteLength(chunk) : 0
      });
    } catch {
    }
    res.once("drain", () => {
      try {
        const log = getLogger();
        log.info("sse_drain", { correlationId, waitMs: Date.now() - start });
      } catch {
      }
      resolve();
    });
  });
  const sendNamed = async (type, data) => {
    if (closed) return;
    const payload = JSON.stringify(
      correlationId ? { correlationId, ...data } : data
    );
    const frame = `event: ${type}
id: ${id}
data: ${payload}

`;
    id++;
    await writeRaw(frame);
  };
  const send = (evt) => {
    const type = typeof (evt == null ? void 0 : evt.type) === "string" ? evt.type : "message";
    return sendNamed(type, evt);
  };
  const hbTimer = setInterval(() => {
    void sendNamed("heartbeat", { ts: Date.now() });
  }, heartbeatMs);
  const onClose = () => {
    if (closed) return;
    closed = true;
    clearInterval(hbTimer);
    try {
      res.end();
    } catch {
    }
  };
  event.node.req.on("close", onClose);
  event.node.req.on("aborted", onClose);
  return {
    send,
    sendNamed,
    close: onClose,
    aborted: () => closed
  };
}

var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
class Semaphore {
  constructor(limit) {
    __publicField(this, "available");
    __publicField(this, "queue", []);
    __publicField(this, "capacity");
    this.available = Math.max(1, Math.floor(limit || 1));
    this.capacity = this.available;
  }
  get used() {
    return this.capacity - this.available;
  }
  get pending() {
    return this.queue.length;
  }
  async acquire() {
    if (this.available > 0) {
      this.available -= 1;
      return () => this.release();
    }
    await new Promise((resolve) => this.queue.push(resolve));
    this.available -= 1;
    return () => this.release();
  }
  release() {
    this.available += 1;
    if (this.available > this.capacity) this.available = this.capacity;
    const next = this.queue.shift();
    if (next) next();
  }
}
const defaultLimit = Number.parseInt(process.env.SSE_CONCURRENCY || "4", 10);
const sseSemaphore = new Semaphore(Number.isFinite(defaultLimit) ? defaultLimit : 4);
const parsedMax = Number.parseInt(process.env.SSE_MAX_PENDING || "32", 10);
const SSE_MAX_PENDING = Number.isFinite(parsedMax) ? parsedMax : 32;
async function withSseConcurrency(fn) {
  const release = await sseSemaphore.acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}
function isBacklogFull() {
  return sseSemaphore.pending >= SSE_MAX_PENDING;
}
function backlogSnapshot() {
  return { used: sseSemaphore.used, pending: sseSemaphore.pending, limit: SSE_MAX_PENDING };
}

export { backlogSnapshot as b, createSse as c, isBacklogFull as i, sseSemaphore as s, withSseConcurrency as w };
//# sourceMappingURL=concurrency.mjs.map
