globalThis.__timing__.logStart('Load chunks/routes/api/v1/health/openai.get');import { d as defineEventHandler } from '../../../../nitro/nitro.mjs';
import OpenAI from 'openai';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';

const openai_get = defineEventHandler(async () => {
  var _a, _b, _c;
  const apiKey = process.env.OPENAI_API_KEY;
  const model = (process.env.OPENAI_DEFAULT_MODEL || process.env.OPENAI_MODEL || "gpt-4o").trim();
  if (!apiKey) {
    return { ok: false, configured: false, error: "OPENAI_API_KEY not set" };
  }
  const client = new OpenAI({ apiKey });
  const start = Date.now();
  try {
    const res = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "You are a health probe. Reply with OK." },
        { role: "user", content: "Health check" }
      ],
      max_tokens: 1,
      temperature: 0
    });
    const content = ((_c = (_b = (_a = res.choices) == null ? void 0 : _a[0]) == null ? void 0 : _b.message) == null ? void 0 : _c.content) || "";
    const durationMs = Date.now() - start;
    return {
      ok: Boolean(res.id),
      configured: true,
      model,
      durationMs,
      reply: content
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    return {
      ok: false,
      configured: true,
      model,
      durationMs,
      error: (err == null ? void 0 : err.message) || "OpenAI health check failed"
    };
  }
});

export { openai_get as default };;globalThis.__timing__.logEnd('Load chunks/routes/api/v1/health/openai.get');
//# sourceMappingURL=openai.get.mjs.map
