import { setHeader } from 'h3';
import { getLogger } from '../services/logger';

/**
 * SSE writer with:
 * - Standard headers
 * - Event names and incremental ids
 * - Heartbeats (default 15s)
 * - Backpressure handling
 * - Disconnect cleanup
 */
export type SseWriter = {
  send: (evt: { type?: string; [k: string]: any }) => Promise<void>;
  sendNamed: (type: string, data: any) => Promise<void>;
  close: () => void;
  aborted: () => boolean;
};

export function createSse(
  event: any,
  opts: { correlationId?: string; heartbeatMs?: number } = {}
): SseWriter {
  const res = event.node.res as import('http').ServerResponse;
  const heartbeatMs = opts.heartbeatMs ?? 15000;
  const correlationId = opts.correlationId;
  let id = 1;
  let closed = false;

  // Standard SSE headers + proxy buffering off
  setHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8');
  setHeader(event, 'Cache-Control', 'no-cache, no-transform');
  setHeader(event, 'Connection', 'keep-alive');
  setHeader(event, 'X-Accel-Buffering', 'no');
  // Ensure no compression on SSE streams
  setHeader(event, 'Content-Encoding', 'identity');

  try {
    (res as any).flushHeaders?.();
  } catch {}

  // Prologue comment to open stream in some proxies
  res.write(':\n\n');

  const writeRaw = (chunk: string) =>
    new Promise<void>((resolve) => {
      const req = event.node.req as import('http').IncomingMessage | undefined;

      if (closed || res.writableEnded || res.destroyed) {
        closed = true;
        return resolve();
      }

      const ok = res.write(chunk);
      if (ok) return resolve();

      if (closed || res.writableEnded || res.destroyed) {
        closed = true;
        return resolve();
      }

      const start = Date.now();

      const cleanup = () => {
        res.off('drain', handleDrain);
        req?.off('close', handleTerminate);
        req?.off('aborted', handleTerminate);
      };

      const handleDrain = () => {
        cleanup();
        try {
          const log = getLogger();
          log.info('sse_drain', { correlationId, waitMs: Date.now() - start });
        } catch {}
        resolve();
      };

      const handleTerminate = () => {
        cleanup();
        resolve();
      };

      try {
        const log = getLogger();
        log.warn('sse_backpressure', {
          correlationId,
          bytes: typeof chunk === 'string' ? Buffer.byteLength(chunk) : 0
        });
      } catch {}

      res.once('drain', handleDrain);
      req?.once('close', handleTerminate);
      req?.once('aborted', handleTerminate);
    });

  const sendNamed = async (type: string, data: any) => {
    if (closed) return;
    const payload = JSON.stringify(
      correlationId ? { correlationId, ...data } : data
    );
    const frame = `event: ${type}\nid: ${id}\ndata: ${payload}\n\n`;
    id++;
    await writeRaw(frame);
  };

  const send = (evt: any) => {
    const type = typeof evt?.type === 'string' ? evt.type : 'message';
    return sendNamed(type, evt);
  };

  const hbTimer = setInterval(() => {
    // Do not await heartbeats; keep them best-effort
    void sendNamed('heartbeat', { ts: Date.now() });
  }, heartbeatMs);

  const onClose = () => {
    if (closed) return;
    closed = true;
    clearInterval(hbTimer);
    try {
      res.end();
    } catch {}
  };

  event.node.req.on('close', onClose);
  event.node.req.on('aborted', onClose);

  return {
    send,
    sendNamed,
    close: onClose,
    aborted: () => closed
  };
}
