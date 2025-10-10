import { d as defineEventHandler } from '../../../../nitro/nitro.mjs';
import { Agent, Runner } from '@openai/agents';
import { g as getDefaultModelName } from '../../../../_/model.mjs';
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
  const model = getDefaultModelName();
  if (!apiKey) {
    return { ok: false, configured: false, error: "OPENAI_API_KEY not set" };
  }
  const start = Date.now();
  try {
    const agent = new Agent({ name: "Health Probe", instructions: "Reply with OK." });
    const runner = new Runner({ model });
    const res = await runner.run(agent, "Health check");
    const reply = typeof (res == null ? void 0 : res.finalOutput) === "string" ? res.finalOutput : "";
    const durationMs = Date.now() - start;
    return {
      ok: reply.toUpperCase().includes("OK") || Boolean(reply),
      configured: true,
      model,
      durationMs,
      reply
    };
  } catch (primaryErr) {
    try {
      const { default: OpenAI } = await import('openai');
      const client = new OpenAI({ apiKey });
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
    } catch (fallbackErr) {
      const durationMs = Date.now() - start;
      return {
        ok: false,
        configured: true,
        model,
        durationMs,
        error: (fallbackErr == null ? void 0 : fallbackErr.message) || (primaryErr == null ? void 0 : primaryErr.message) || "OpenAI health check failed"
      };
    }
  }
});

export { openai_get as default };
//# sourceMappingURL=openai.get.mjs.map
