import { setHeader } from 'h3';

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
      if (closed) return resolve();
      const ok = res.write(chunk);
      if (ok) return resolve();
      res.once('drain', () => resolve());
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