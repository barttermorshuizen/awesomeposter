globalThis.__timing__.logStart('Load chunks/_/orchestrator-agent');import { getLogger } from './logger.mjs';
import { g as getAgents, c as createStrategyAgent, a as createContentAgent, b as createQaAgent, d as analyzeAssetsLocal } from './agents-container.mjs';
import { g as getDb, a as assets } from './index.mjs';
import { Runner, Agent } from '@openai/agents';
import { a as AppResultSchema } from './agent-run.mjs';
import { eq } from 'drizzle-orm';
import 'winston';
import 'zod';
import '../nitro/nitro.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';
import 'drizzle-orm/node-postgres';
import 'pg';
import 'drizzle-orm/pg-core';

class OrchestratorAgent {
  constructor(runtime) {
    this.runtime = runtime;
  }
  async run(req, onEvent, correlationId) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _A, _B, _C, _D, _E, _F, _G, _H, _I, _J;
    const cid = correlationId || `run_${Math.random().toString(36).slice(2)}`;
    const log = getLogger();
    const start = Date.now();
    const metricsAgg = { tokensTotal: 0 };
    onEvent({ type: "start", correlationId: cid, message: "Run started" });
    log.info("orchestrator_run_start", { cid, mode: req.mode, hasState: Boolean(req.state), briefId: req.briefId });
    const system = this.buildSystemPrompt(req);
    const messages = [
      { role: "system", content: system },
      { role: "user", content: req.objective }
    ];
    if (req.briefId) {
      messages.push({
        role: "user",
        content: `Context: briefId=${req.briefId}. You may use tools like io_get_brief, io_list_assets, io_get_client_profile if needed.`
      });
    }
    try {
      if (req.mode === "chat") {
        const target = ((_a = req.options) == null ? void 0 : _a.targetAgentId) || "orchestrator";
        onEvent({ type: "phase", phase: "analysis", message: `Entering chat mode (${target})`, correlationId: cid });
        let full = "";
        if (target === "orchestrator") {
          await this.runtime.runChatStream(
            messages,
            (delta) => {
              full += delta;
              onEvent({ type: "delta", message: delta, correlationId: cid });
            },
            {
              toolsAllowlist: (_b = req.options) == null ? void 0 : _b.toolsAllowlist,
              toolPolicy: (_c = req.options) == null ? void 0 : _c.toolPolicy,
              temperature: (_d = req.options) == null ? void 0 : _d.temperature,
              schemaName: (_e = req.options) == null ? void 0 : _e.schemaName,
              trace: (_f = req.options) == null ? void 0 : _f.trace
            }
          );
        } else {
          const onToolEvent = (e) => {
            if (e.type === "tool_call") onEvent({ type: "tool_call", message: e.name, data: { args: e.args }, correlationId: cid });
            if (e.type === "tool_result") onEvent({ type: "tool_result", message: e.name, data: { result: e.result }, correlationId: cid });
            if (e.type === "metrics") onEvent({ type: "metrics", tokens: e.tokens, durationMs: e.durationMs, correlationId: cid });
          };
          const opts = { policy: (_g = req.options) == null ? void 0 : _g.toolPolicy, requestAllowlist: (_h = req.options) == null ? void 0 : _h.toolsAllowlist };
          let agentInstance;
          if (target === "strategy") agentInstance = createStrategyAgent(this.runtime, onToolEvent, opts, "chat");
          else if (target === "generator") agentInstance = createContentAgent(this.runtime, onToolEvent, opts, "chat");
          else if (target === "qa") agentInstance = createQaAgent(this.runtime, onToolEvent, opts);
          else agentInstance = void 0;
          const systemText2 = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
          const userText2 = messages.filter((m) => m.role !== "system").map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");
          const prompt2 = [systemText2, userText2].filter(Boolean).join("\n\n") || "Proceed.";
          const runner2 = new Runner({ model: this.runtime.getModel() });
          const stream2 = await runner2.run(agentInstance, prompt2, { stream: true });
          const textStream = stream2.toTextStream({ compatibleWithNodeStreams: false });
          for await (const chunk of textStream) {
            const d = (_j = (_i = chunk == null ? void 0 : chunk.toString) == null ? void 0 : _i.call(chunk)) != null ? _j : String(chunk);
            if (d) {
              full += d;
              onEvent({ type: "delta", message: d, correlationId: cid });
            }
          }
          await stream2.completed;
          const result = await stream2.finalResult;
          if (typeof (result == null ? void 0 : result.finalOutput) === "string") full += result.finalOutput;
        }
        const normalizeChatOutput = (input) => {
          let text = (input || "").trim();
          if (text.startsWith("```")) {
            const last = text.lastIndexOf("```");
            if (last > 3) {
              const firstNl = text.indexOf("\n");
              const inner = firstNl !== -1 ? text.slice(firstNl + 1, last) : text;
              text = inner.trim();
            }
          }
          try {
            const j = JSON.parse(text);
            if (j && typeof j === "object" && typeof j.content === "string") {
              return String(j.content);
            }
          } catch {
          }
          return text;
        };
        const finalText = normalizeChatOutput(full);
        const durationMs2 = Date.now() - start;
        onEvent({ type: "message", message: finalText, correlationId: cid });
        onEvent({ type: "metrics", durationMs: durationMs2, correlationId: cid });
        onEvent({ type: "complete", data: { message: finalText }, durationMs: durationMs2, correlationId: cid });
        log.info("orchestrator_run_complete", { cid, mode: "chat", durationMs: durationMs2, size: finalText.length, target });
        return { final: { message: finalText }, metrics: { durationMs: durationMs2 } };
      }
      onEvent({ type: "phase", phase: "planning", message: "Structured run started", correlationId: cid });
      const strategyAgent = createStrategyAgent(this.runtime, (e) => {
        if (e.type === "metrics" && typeof e.tokens === "number") metricsAgg.tokensTotal += e.tokens;
        if (e.type === "tool_call") onEvent({ type: "tool_call", message: e.name, data: { args: e.args }, correlationId: cid });
        if (e.type === "tool_result") onEvent({ type: "tool_result", message: e.name, data: { result: e.result }, correlationId: cid });
        if (e.type === "metrics") onEvent({ type: "metrics", tokens: e.tokens, durationMs: e.durationMs, correlationId: cid });
      }, { policy: (_k = req.options) == null ? void 0 : _k.toolPolicy, requestAllowlist: (_l = req.options) == null ? void 0 : _l.toolsAllowlist });
      const contentAgent = createContentAgent(this.runtime, (e) => {
        if (e.type === "metrics" && typeof e.tokens === "number") metricsAgg.tokensTotal += e.tokens;
        if (e.type === "tool_call") onEvent({ type: "tool_call", message: e.name, data: { args: e.args }, correlationId: cid });
        if (e.type === "tool_result") onEvent({ type: "tool_result", message: e.name, data: { result: e.result }, correlationId: cid });
        if (e.type === "metrics") onEvent({ type: "metrics", tokens: e.tokens, durationMs: e.durationMs, correlationId: cid });
      }, { policy: (_m = req.options) == null ? void 0 : _m.toolPolicy, requestAllowlist: (_n = req.options) == null ? void 0 : _n.toolsAllowlist });
      const qaAgent = createQaAgent(this.runtime, (e) => {
        if (e.type === "metrics" && typeof e.tokens === "number") metricsAgg.tokensTotal += e.tokens;
        if (e.type === "tool_call") onEvent({ type: "tool_call", message: e.name, data: { args: e.args }, correlationId: cid });
        if (e.type === "tool_result") onEvent({ type: "tool_result", message: e.name, data: { result: e.result }, correlationId: cid });
        if (e.type === "metrics") onEvent({ type: "metrics", tokens: e.tokens, durationMs: e.durationMs, correlationId: cid });
      }, { policy: (_o = req.options) == null ? void 0 : _o.toolPolicy, requestAllowlist: (_p = req.options) == null ? void 0 : _p.toolsAllowlist });
      const TRIAGE_INSTRUCTIONS = [
        "You are the Orchestrator. Decide which specialist (Strategy, Content, QA) should handle each step and perform handoffs as needed.",
        "When you are ready to return the final result, output only a single JSON object that matches this schema:",
        '{ "result": <any>, "rationale"?: <string> }',
        "Do not include any additional commentary outside of the JSON.",
        ((_q = req.options) == null ? void 0 : _q.schemaName) ? `Schema name: ${req.options.schemaName}` : ""
      ].join("\n");
      const triageAgent = Agent.create({
        name: "Triage Agent",
        instructions: TRIAGE_INSTRUCTIONS,
        handoffs: [strategyAgent, contentAgent, qaAgent]
      });
      const systemText = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
      const userText = messages.filter((m) => m.role !== "system").map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");
      const prompt = [systemText, userText].filter(Boolean).join("\n\n") || "Proceed.";
      const runner = new Runner({ model: this.runtime.getModel() });
      const stream = await runner.run(triageAgent, prompt, { stream: true });
      const phaseForAgent = (name) => {
        if (!name) return void 0;
        if (/strategy/i.test(name)) return "analysis";
        if (/content/i.test(name)) return "generation";
        if (/quality|qa/i.test(name)) return "qa";
        return void 0;
      };
      try {
        for await (const ev of stream) {
          if ((ev == null ? void 0 : ev.type) === "raw_model_stream_event") {
            const data = ev.data;
            if ((data == null ? void 0 : data.type) === "output_text_delta" && typeof data.delta === "string" && data.delta.length > 0) {
              onEvent({ type: "delta", message: data.delta, correlationId: cid });
            }
            continue;
          }
          if ((ev == null ? void 0 : ev.type) === "run_item_stream_event") {
            const name = ev.name;
            const item = ev.item;
            const raw = item == null ? void 0 : item.rawItem;
            if (name === "message_output_created") {
              const text = typeof (item == null ? void 0 : item.content) === "string" ? item.content : void 0;
              if (text && text.length > 0) onEvent({ type: "delta", message: text, correlationId: cid });
            } else if (name === "tool_called") {
              const toolName = (raw == null ? void 0 : raw.name) || ((_r = item == null ? void 0 : item.agent) == null ? void 0 : _r.name) || "tool";
              let args = void 0;
              if (typeof (raw == null ? void 0 : raw.arguments) === "string") {
                try {
                  args = JSON.parse(raw.arguments);
                } catch {
                  args = raw.arguments;
                }
              }
              onEvent({ type: "tool_call", message: toolName, data: { args }, correlationId: cid });
            } else if (name === "tool_output") {
              const toolName = (raw == null ? void 0 : raw.name) || ((_s = item == null ? void 0 : item.agent) == null ? void 0 : _s.name) || "tool";
              const result = (raw == null ? void 0 : raw.output) && typeof raw.output === "object" ? raw.output : (_u = (_t = item == null ? void 0 : item.output) != null ? _t : raw == null ? void 0 : raw.output) != null ? _u : null;
              onEvent({ type: "tool_result", message: toolName, data: { result }, correlationId: cid });
            } else if (name === "handoff_requested") {
              const from = (_v = item == null ? void 0 : item.agent) == null ? void 0 : _v.name;
              onEvent({ type: "handoff", message: "requested", data: { from }, correlationId: cid });
            } else if (name === "handoff_occurred") {
              const from = ((_w = item == null ? void 0 : item.sourceAgent) == null ? void 0 : _w.name) || ((_x = item == null ? void 0 : item.agent) == null ? void 0 : _x.name);
              const to = (_y = item == null ? void 0 : item.targetAgent) == null ? void 0 : _y.name;
              onEvent({ type: "handoff", message: "occurred", data: { from, to }, correlationId: cid });
              const phase = phaseForAgent(to);
              if (phase) onEvent({ type: "phase", phase, message: `Handed off to ${to}`, correlationId: cid });
            } else if (name === "reasoning_item_created") {
              const text = ((_A = (_z = raw == null ? void 0 : raw.rawContent) == null ? void 0 : _z[0]) == null ? void 0 : _A.text) || ((_C = (_B = raw == null ? void 0 : raw.content) == null ? void 0 : _B[0]) == null ? void 0 : _C.text) || "";
              if (text) onEvent({ type: "message", message: text, correlationId: cid });
            } else if (name === "tool_approval_requested") {
              onEvent({ type: "warning", message: "Tool approval requested", data: { item }, correlationId: cid });
            }
            continue;
          }
          if ((ev == null ? void 0 : ev.type) === "agent_updated_stream_event") {
            const agentName = (_D = ev == null ? void 0 : ev.agent) == null ? void 0 : _D.name;
            const phase = phaseForAgent(agentName);
            if (phase) onEvent({ type: "phase", phase, message: `Running ${agentName}`, correlationId: cid });
            continue;
          }
        }
      } catch (streamErr) {
        log.warn("orchestrator_stream_iteration_error", { cid, err: String(streamErr) });
      }
      await stream.completed;
      let parsed;
      try {
        const finalOutput = stream.finalOutput;
        const contentStr = typeof finalOutput === "string" ? finalOutput : JSON.stringify(finalOutput != null ? finalOutput : "");
        parsed = AppResultSchema.parse(JSON.parse(contentStr || "{}"));
      } catch {
        const outputs = ((_I = (_H = (_E = stream == null ? void 0 : stream.state) == null ? void 0 : _E._modelResponses) == null ? void 0 : _H[((_G = (_F = stream == null ? void 0 : stream.state) == null ? void 0 : _F._modelResponses) == null ? void 0 : _G.length) - 1]) == null ? void 0 : _I.output) || [];
        const text = outputs.map((o) => ((o == null ? void 0 : o.content) || []).filter((p) => (p == null ? void 0 : p.type) === "output_text").map((p) => p.text).join("")).join("");
        parsed = text ? { result: text } : { result: null };
      }
      if (!(parsed == null ? void 0 : parsed.result) || typeof parsed.result === "string" && parsed.result.trim() === "") {
        try {
          if (req.briefId) {
            const db = getDb();
            const rows = await db.select().from(assets).where(eq(assets.briefId, req.briefId));
            const mapped = rows.map((r) => ({
              id: r.id,
              filename: r.filename || "",
              originalName: r.originalName || void 0,
              url: r.url,
              type: r.type || "other",
              mimeType: r.mimeType || void 0,
              fileSize: r.fileSize || void 0,
              metaJson: r.metaJson || void 0
            }));
            const analysis = analyzeAssetsLocal(mapped);
            const format = (analysis == null ? void 0 : analysis.recommendedFormat) || "text";
            let hookIntensity = /awareness|launch|new/i.test(req.objective) ? 0.75 : 0.6;
            const expertiseDepth = /technical|deep|guide|how\-to/i.test(req.objective) ? 0.7 : 0.5;
            const structure = { lengthLevel: format === "document_pdf" ? 0.9 : format === "text" ? 0.7 : 0.4, scanDensity: format === "text" ? 0.6 : 0.5 };
            const knobs = { formatType: format, hookIntensity, expertiseDepth, structure };
            parsed = { result: { analysis, knobs }, rationale: "Heuristic fallback used due to empty model output." };
          } else {
            parsed = { result: { message: "No content generated" }, rationale: "Fallback due to empty model output." };
          }
        } catch {
        }
      }
      const durationMs = Date.now() - start;
      try {
        const responses = ((_J = stream == null ? void 0 : stream.state) == null ? void 0 : _J._modelResponses) || [];
        const tokens = responses.reduce((acc, r) => {
          var _a2, _b2;
          return acc + (((_a2 = r == null ? void 0 : r.usage) == null ? void 0 : _a2.inputTokens) || 0) + (((_b2 = r == null ? void 0 : r.usage) == null ? void 0 : _b2.outputTokens) || 0);
        }, 0);
        if (tokens > 0) metricsAgg.tokensTotal += tokens;
      } catch {
      }
      onEvent({ type: "metrics", tokens: metricsAgg.tokensTotal || void 0, durationMs, correlationId: cid });
      onEvent({ type: "complete", data: parsed, durationMs, correlationId: cid });
      log.info("orchestrator_run_complete", { cid, mode: "app", durationMs });
      return { final: parsed, metrics: { durationMs, tokens: metricsAgg.tokensTotal || void 0 } };
    } catch (error) {
      onEvent({ type: "error", message: (error == null ? void 0 : error.message) || "Unknown error", correlationId: cid });
      log.error("orchestrator_run_error", { cid, err: error == null ? void 0 : error.message });
      return { final: null, metrics: void 0 };
    }
  }
  buildSystemPrompt(req) {
    var _a;
    const base = ((_a = req.options) == null ? void 0 : _a.systemPromptOverride) || "You are the Orchestrator agent for social content creation. Be concise and reliable.";
    if (req.mode === "app") {
      return base + "\n" + [
        "When responding, output only a single JSON object that matches this schema:",
        '{ "result": <any>, "rationale"?: <string> }',
        "Do not include any additional commentary outside of the JSON."
      ].join("\n");
    }
    return base + "\nRespond conversationally. Keep answers short when possible.";
  }
}
function getOrchestrator() {
  const { runtime } = getAgents();
  return new OrchestratorAgent(runtime);
}

export { OrchestratorAgent, getOrchestrator };;globalThis.__timing__.logEnd('Load chunks/_/orchestrator-agent');
//# sourceMappingURL=orchestrator-agent.mjs.map
