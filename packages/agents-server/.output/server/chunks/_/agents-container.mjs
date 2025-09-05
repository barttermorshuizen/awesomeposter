globalThis.__timing__.logStart('Load chunks/_/agents-container');import { ZodObject, z } from 'zod';
import { tool, Runner, Agent } from '@openai/agents';
import { g as getDb, b as briefs, c as clients, a as assets, d as getClientProfileByClientId } from './index.mjs';
import { eq } from 'drizzle-orm';

const DEFAULT_MODEL_FALLBACK = "gpt-4o";
function getDefaultModelName() {
  const m = process.env.OPENAI_DEFAULT_MODEL || process.env.OPENAI_MODEL || DEFAULT_MODEL_FALLBACK;
  return m.trim();
}

var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
class AgentRuntime {
  constructor() {
    __publicField(this, "model", getDefaultModelName());
    __publicField(this, "tools", []);
    if (!process.env.OPENAI_API_KEY) {
      console.warn("[AgentRuntime] OPENAI_API_KEY not set; SDK calls will fail");
    }
  }
  registerTool(tool) {
    this.tools.push(tool);
  }
  getModel() {
    return this.model;
  }
  // Return wrapped agent tools, with support for allowlists and policy
  // Backward compatible signature: getAgentTools(allowlist?: string[], onEvent?: ...)
  // New signature: getAgentTools(options?: { allowlist?: string[]; policy?: 'auto' | 'required' | 'off'; requestAllowlist?: string[] }, onEvent?: ...)
  getAgentTools(allowlistOrOptions, onEvent) {
    const opts = Array.isArray(allowlistOrOptions) ? { allowlist: allowlistOrOptions } : allowlistOrOptions || {};
    const policy = opts.policy;
    if (policy === "off") {
      return [];
    }
    const listA = opts.allowlist;
    const listB = opts.requestAllowlist;
    const combineAllowlist = (a, b) => {
      if (a && a.length && b && b.length) return a.filter((n) => b.includes(n));
      return (a && a.length ? a : b) || void 0;
    };
    const finalAllowlist = combineAllowlist(listA, listB);
    const selected = finalAllowlist && finalAllowlist.length > 0 ? this.tools.filter((t) => finalAllowlist.includes(t.name)) : this.tools;
    return selected.map((t) => {
      const paramsSchema = t.parameters instanceof ZodObject ? t.parameters : z.object({});
      return tool({
        name: t.name,
        description: t.description,
        parameters: paramsSchema,
        execute: async (input) => {
          const start = Date.now();
          onEvent == null ? void 0 : onEvent({ type: "tool_call", name: t.name, args: input });
          try {
            const res = await t.handler(input);
            onEvent == null ? void 0 : onEvent({ type: "tool_result", name: t.name, result: res, durationMs: Date.now() - start });
            return res;
          } catch (err) {
            const res = { error: true, code: "TOOL_HANDLER_ERROR", message: (err == null ? void 0 : err.message) || "Tool handler error" };
            onEvent == null ? void 0 : onEvent({ type: "tool_result", name: t.name, result: res, durationMs: Date.now() - start });
            return res;
          }
        }
      });
    });
  }
  async runStructured(schema, messages, opts) {
    const { agent, prompt } = this.buildAgentAndPrompt(messages, void 0, opts);
    const runner = new Runner({ model: this.model });
    const result = await runner.run(agent, prompt);
    const out = result == null ? void 0 : result.finalOutput;
    const text = typeof out === "string" ? out : JSON.stringify(out != null ? out : "");
    if (!text) throw new Error("No content from model");
    return schema.parse(JSON.parse(text));
  }
  async runWithTools(messages, onEvent, opts) {
    var _a, _b, _c;
    const { agent, prompt } = this.buildAgentAndPrompt(messages, onEvent, opts);
    const runner = new Runner({ model: this.model });
    const started = Date.now();
    const stream = await runner.run(agent, prompt, { stream: true });
    await stream.completed;
    const result = await stream.finalResult;
    const durationMs = Date.now() - started;
    const tokens = (((_a = result == null ? void 0 : result.usage) == null ? void 0 : _a.inputTokens) || 0) + (((_b = result == null ? void 0 : result.usage) == null ? void 0 : _b.outputTokens) || 0);
    onEvent == null ? void 0 : onEvent({ type: "metrics", durationMs, tokens: Number.isFinite(tokens) && tokens > 0 ? tokens : void 0 });
    return { content: typeof (result == null ? void 0 : result.finalOutput) === "string" ? result.finalOutput : JSON.stringify((_c = result == null ? void 0 : result.finalOutput) != null ? _c : "") };
  }
  async runChatStream(messages, onDelta, opts) {
    var _a, _b;
    const { agent, prompt } = this.buildAgentAndPrompt(messages, void 0, opts);
    const runner = new Runner({ model: this.model });
    const stream = await runner.run(agent, prompt, { stream: true });
    let full = "";
    const textStream = stream.toTextStream({ compatibleWithNodeStreams: false });
    for await (const chunk of textStream) {
      const d = (_b = (_a = chunk == null ? void 0 : chunk.toString) == null ? void 0 : _a.call(chunk)) != null ? _b : String(chunk);
      if (d) {
        full += d;
        onDelta(d);
      }
    }
    await stream.completed;
    const result = await stream.finalResult;
    if (typeof (result == null ? void 0 : result.finalOutput) === "string") full += result.finalOutput;
    return full;
  }
  buildAgentAndPrompt(messages, onEvent, opts) {
    const systemText = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n") || "You are a helpful assistant.";
    const userText = messages.filter((m) => m.role !== "system").map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");
    const filteredTools = (() => {
      if ((opts == null ? void 0 : opts.toolPolicy) === "off") return [];
      if ((opts == null ? void 0 : opts.toolsAllowlist) && opts.toolsAllowlist.length > 0) {
        return this.tools.filter((t) => opts.toolsAllowlist.includes(t.name));
      }
      return this.tools;
    })();
    const wrappedTools = filteredTools.map((t) => {
      const paramsSchema = t.parameters instanceof ZodObject ? t.parameters : z.object({});
      return tool({
        name: t.name,
        description: t.description,
        parameters: paramsSchema,
        execute: async (input) => {
          const start = Date.now();
          onEvent == null ? void 0 : onEvent({ type: "tool_call", name: t.name, args: input });
          try {
            const res = await t.handler(input);
            onEvent == null ? void 0 : onEvent({ type: "tool_result", name: t.name, result: res, durationMs: Date.now() - start });
            return res;
          } catch (err) {
            const res = {
              error: true,
              code: "TOOL_HANDLER_ERROR",
              message: (err == null ? void 0 : err.message) || "Tool handler error"
            };
            onEvent == null ? void 0 : onEvent({ type: "tool_result", name: t.name, result: res, durationMs: Date.now() - start });
            return res;
          }
        }
      });
    });
    const agent = new Agent({
      name: "Orchestrator",
      instructions: systemText,
      tools: wrappedTools
    });
    return { agent, prompt: userText || "Proceed." };
  }
}

class StrategyManagerAgent {
  constructor(runtime) {
    this.runtime = runtime;
  }
}
const STRATEGY_TOOLS = [
  "io_get_brief",
  "io_list_assets",
  "io_get_client_profile",
  "strategy_analyze_assets",
  "strategy_plan_knobs"
];
const STRATEGY_INSTRUCTIONS_APP = [
  "You are the Strategy Manager agent for social content.",
  "Plan using a 4\u2011knob system: formatType, hookIntensity, expertiseDepth, structure.",
  "Use available tools to analyze assets and propose knob settings. Respect client policy; never invent assets.",
  "When asked for a final result in workflow/app mode, produce structured JSON that the caller expects."
].join("\n");
const STRATEGY_INSTRUCTIONS_CHAT = [
  "You are the Strategy Manager agent speaking directly with a user.",
  "Respond conversationally with plain text summaries and recommendations.",
  "Do NOT return JSON or wrap the answer in code fences."
].join("\n");
function createStrategyAgent(runtime, onEvent, opts, mode = "app") {
  const tools = runtime.getAgentTools({ allowlist: [...STRATEGY_TOOLS], policy: opts == null ? void 0 : opts.policy, requestAllowlist: opts == null ? void 0 : opts.requestAllowlist }, onEvent);
  const instructions = mode === "chat" ? STRATEGY_INSTRUCTIONS_CHAT : STRATEGY_INSTRUCTIONS_APP;
  return new Agent({ name: "Strategy Manager", instructions, tools });
}

class ContentGeneratorAgent {
  constructor(runtime) {
    this.runtime = runtime;
  }
}
const CONTENT_TOOLS = [
  "apply_format_rendering",
  "optimize_for_platform"
];
const CONTENT_INSTRUCTIONS_APP = [
  "You are the Content Generator agent.",
  "Generate multi\u2011platform posts based on the 4\u2011knob configuration and client language.",
  "Use tools to apply format\u2011specific rendering and platform optimization while respecting platform rules and client policy.",
  // Keep structured bias for workflow mode only.
  "When asked for a final result in workflow/app mode, produce structured JSON that the caller expects."
].join("\n");
const CONTENT_INSTRUCTIONS_CHAT = [
  "You are the Content Generator agent speaking directly with a user.",
  "Respond conversationally with the content only.",
  "Do NOT return JSON, code fences, or wrap the answer in an object.",
  "When asked to produce a post, return only the post text."
].join("\n");
function createContentAgent(runtime, onEvent, opts, mode = "app") {
  const tools = runtime.getAgentTools({ allowlist: [...CONTENT_TOOLS], policy: opts == null ? void 0 : opts.policy, requestAllowlist: opts == null ? void 0 : opts.requestAllowlist }, onEvent);
  const instructions = mode === "chat" ? CONTENT_INSTRUCTIONS_CHAT : CONTENT_INSTRUCTIONS_APP;
  return new Agent({ name: "Content Generator", instructions, tools });
}

class QualityAssuranceAgent {
  constructor(runtime) {
    this.runtime = runtime;
  }
}
const QA_TOOLS = [
  "qa_evaluate_content"
];
const QA_INSTRUCTIONS = [
  "You are the Quality Assurance agent.",
  "Evaluate drafts for readability, clarity, objective fit, brand risk, and compliance.",
  "Return structured scores and prioritized suggestions as JSON only."
].join("\n");
function createQaAgent(runtime, onEvent, opts) {
  const tools = runtime.getAgentTools({ allowlist: [...QA_TOOLS], policy: opts == null ? void 0 : opts.policy, requestAllowlist: opts == null ? void 0 : opts.requestAllowlist }, onEvent);
  return new Agent({ name: "Quality Assurance", instructions: QA_INSTRUCTIONS, tools });
}

function registerIOTools(runtime) {
  const db = getDb();
  runtime.registerTool({
    name: "io_get_brief",
    description: "Fetch a brief by id",
    parameters: z.object({ briefId: z.string() }),
    handler: async ({ briefId }) => {
      const [row] = await db.select().from(briefs).where(eq(briefs.id, briefId)).limit(1);
      if (!row) throw new Error("Brief not found");
      const [client] = await db.select().from(clients).where(eq(clients.id, row.clientId)).limit(1);
      return { ...row, clientName: client == null ? void 0 : client.name };
    }
  });
  runtime.registerTool({
    name: "io_list_assets",
    description: "List assets for a brief",
    parameters: z.object({ briefId: z.string() }),
    handler: async ({ briefId }) => {
      const rows = await db.select().from(assets).where(eq(assets.briefId, briefId));
      return rows;
    }
  });
  runtime.registerTool({
    name: "io_get_client_profile",
    description: "Fetch the client profile for a clientId",
    parameters: z.object({ clientId: z.string() }),
    handler: async ({ clientId }) => {
      const profile = await getClientProfileByClientId(clientId);
      if (!profile) return null;
      return profile;
    }
  });
}

function analyzeAssetsLocal(assets) {
  const images = assets.filter((a) => a.type === "image");
  const documents = assets.filter((a) => a.type === "document");
  const videos = assets.filter((a) => a.type === "video");
  const hasPdf = documents.some((d) => (d.mimeType || "").includes("pdf"));
  const achievable = ["text"];
  if (images.length >= 1) achievable.push("single_image");
  if (images.length >= 3) achievable.push("multi_image");
  if (documents.length >= 1 && hasPdf) achievable.push("document_pdf");
  if (videos.length >= 1) achievable.push("video");
  let recommended = "text";
  if (videos.length >= 1) recommended = "video";
  else if (images.length >= 3) recommended = "multi_image";
  else if (images.length >= 1) recommended = "single_image";
  else if (documents.length >= 1 && hasPdf) recommended = "document_pdf";
  const assetQuality = {
    images: { count: images.length, quality: images.length >= 3 ? "high" : images.length >= 1 ? "medium" : "low" },
    documents: { count: documents.length, hasSlides: hasPdf },
    videos: { count: videos.length, duration: void 0 }
  };
  const formatFeasibility = {
    text: { feasible: true, reason: "Always available", assetRequirements: [] },
    single_image: {
      feasible: images.length >= 1,
      reason: images.length >= 1 ? "Sufficient images" : "Need at least 1 image",
      assetRequirements: images.length >= 1 ? [] : ["At least 1 image"]
    },
    multi_image: {
      feasible: images.length >= 3,
      reason: images.length >= 3 ? "Sufficient images" : "Need at least 3 images",
      assetRequirements: images.length >= 3 ? [] : ["At least 3 images"]
    },
    document_pdf: {
      feasible: documents.length >= 1 && hasPdf,
      reason: hasPdf ? "PDF available" : "PDF required",
      assetRequirements: hasPdf ? [] : ["PDF or presentation document"]
    },
    video: {
      feasible: videos.length >= 1,
      reason: videos.length >= 1 ? "Video available" : "Video required",
      assetRequirements: videos.length >= 1 ? [] : ["Video file"]
    }
  };
  const recommendations = [];
  if (images.length === 0) recommendations.push("Consider adding at least one strong image to increase scannability.");
  if (videos.length === 0 && images.length >= 1) recommendations.push("Short clips or motion can further improve engagement.");
  if (documents.length >= 1 && !hasPdf) recommendations.push("Export documents to PDF for easier sharing.");
  return { achievableFormats: achievable, recommendedFormat: recommended, assetQuality, formatFeasibility, recommendations };
}
const AssetParamSchema = z.object({
  id: z.string().nullable(),
  filename: z.string().nullable(),
  originalName: z.string().nullable(),
  url: z.string().nullable(),
  type: z.enum(["image", "document", "video", "audio", "other"]).nullable(),
  mimeType: z.string().nullable(),
  fileSize: z.number().int().nonnegative().nullable()
}).strict().catchall(z.never());
const FormatTypeEnum = z.enum(["text", "single_image", "multi_image", "document_pdf", "video"]);
const AssetQualityParamSchema = z.object({
  images: z.object({
    count: z.number().int().nonnegative(),
    quality: z.enum(["high", "medium", "low"])
  }).strict(),
  documents: z.object({
    count: z.number().int().nonnegative(),
    hasSlides: z.boolean()
  }).strict(),
  videos: z.object({
    count: z.number().int().nonnegative(),
    duration: z.number().int().nonnegative().nullable()
  }).strict()
}).strict();
const FormatFeasibilityEntrySchema = z.object({
  feasible: z.boolean(),
  reason: z.string(),
  assetRequirements: z.array(z.string())
}).strict();
const FormatFeasibilityParamSchema = z.object({
  text: FormatFeasibilityEntrySchema,
  single_image: FormatFeasibilityEntrySchema,
  multi_image: FormatFeasibilityEntrySchema,
  document_pdf: FormatFeasibilityEntrySchema,
  video: FormatFeasibilityEntrySchema
}).strict();
const AssetAnalysisParamSchema = z.object({
  achievableFormats: z.array(FormatTypeEnum),
  recommendedFormat: FormatTypeEnum,
  assetQuality: AssetQualityParamSchema,
  formatFeasibility: FormatFeasibilityParamSchema,
  recommendations: z.array(z.string())
}).strict();
function registerStrategyTools(runtime) {
  runtime.registerTool({
    name: "strategy_analyze_assets",
    description: "Analyze provided assets to determine feasible formats and a recommendation",
    parameters: z.object({
      // OpenAI structured outputs: all fields required; use nullable for optional semantics.
      // Important: arrays must define item schemas; avoid z.any() for array items.
      assets: z.array(AssetParamSchema).nullable(),
      briefId: z.string().nullable()
    }).strict(),
    handler: async ({ assets: assets$1, briefId }) => {
      let sourceAssets = assets$1;
      if ((!sourceAssets || !Array.isArray(sourceAssets)) && briefId) {
        const db = getDb();
        const rows = await db.select().from(assets).where(eq(assets.briefId, briefId));
        sourceAssets = rows.map((r) => ({
          id: r.id,
          filename: r.filename || "",
          originalName: r.originalName || void 0,
          url: r.url,
          type: r.type || "other",
          mimeType: r.mimeType || void 0,
          fileSize: r.fileSize || void 0,
          metaJson: r.metaJson || void 0
        }));
      }
      if (!sourceAssets || !Array.isArray(sourceAssets)) {
        sourceAssets = [];
      }
      return analyzeAssetsLocal(sourceAssets);
    }
  });
  runtime.registerTool({
    name: "strategy_plan_knobs",
    description: "Plan 4-knob configuration based on objective and asset analysis",
    parameters: z.object({
      objective: z.string(),
      // Add assetAnalysis parameter that the SDK expects
      assetAnalysis: AssetAnalysisParamSchema.nullable(),
      // Narrow client policy shape to satisfy JSON Schema requirements
      clientPolicy: z.object({
        maxHookIntensity: z.number().nullable()
      }).strict().nullable(),
      briefId: z.string().nullable()
    }).strict(),
    handler: async ({ objective, assetAnalysis, clientPolicy, briefId }) => {
      let analysis = assetAnalysis;
      if (!analysis && briefId) {
        const db = getDb();
        const rows = await db.select().from(assets).where(eq(assets.briefId, briefId));
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
        analysis = analyzeAssetsLocal(mapped);
      }
      const format = (analysis == null ? void 0 : analysis.recommendedFormat) || "text";
      let hookIntensity = /awareness|launch|new/i.test(objective) ? 0.75 : 0.6;
      if ((clientPolicy == null ? void 0 : clientPolicy.maxHookIntensity) != null) {
        const cap = Number(clientPolicy.maxHookIntensity);
        if (Number.isFinite(cap)) hookIntensity = Math.min(hookIntensity, cap);
      }
      const expertiseDepth = /technical|deep|guide|how\-to/i.test(objective) ? 0.7 : 0.5;
      const structure = {
        lengthLevel: format === "text" ? 0.7 : format === "document_pdf" ? 0.9 : 0.4,
        scanDensity: format === "text" ? 0.6 : 0.5
      };
      const rationale = `Chosen format ${format} based on available assets. Hook ${hookIntensity.toFixed(2)} to match objective. Depth ${expertiseDepth.toFixed(2)} for clarity.`;
      return { formatType: format, hookIntensity, expertiseDepth, structure, rationale };
    }
  });
}

const FormatEnum = z.enum(["text", "single_image", "multi_image", "document_pdf", "video"]);
const PlatformEnum$1 = z.enum(["linkedin", "x", "facebook", "instagram", "youtube", "tiktok"]);
const KnobsParamSchema = z.object({
  formatType: FormatEnum.nullable(),
  hookIntensity: z.number().min(0).max(1).nullable(),
  expertiseDepth: z.number().min(0).max(1).nullable(),
  structure: z.object({
    lengthLevel: z.number().min(0).max(1),
    scanDensity: z.number().min(0).max(1)
  }).strict().catchall(z.never()).nullable()
}).strict().catchall(z.never());
function registerContentTools(runtime) {
  runtime.registerTool({
    name: "apply_format_rendering",
    description: "Apply format-specific rendering rules to the content",
    parameters: z.object({
      content: z.string(),
      formatType: FormatEnum
    }),
    handler: ({ content, formatType }) => {
      let post = content;
      switch (formatType) {
        case "document_pdf": {
          const lines = post.split("\n").filter(Boolean);
          const sections = ["\u{1F4CB} Overview", "\u{1F50D} Key Points", "\u{1F4A1} Insights", "\u{1F680} Action Items"];
          post = sections.map((s, i) => lines[i] ? `${s}
${lines[i]}` : "").filter(Boolean).join("\n\n");
          break;
        }
        case "multi_image": {
          const lines = post.split("\n").filter(Boolean);
          const sections = ["\u{1F3AF} Step 1", "\u{1F3AF} Step 2", "\u{1F3AF} Step 3", "\u2705 Result"];
          post = sections.map((s, i) => lines[i] ? `${s}
${lines[i]}` : "").filter(Boolean).join("\n\n");
          break;
        }
        case "single_image": {
          const lines = post.split("\n");
          post = `\u{1F5BC}\uFE0F ${lines[0] || ""}

${lines.slice(1).join("\n")}`.trim();
          break;
        }
        case "video": {
          const lines = post.split("\n");
          post = `\u{1F3AC} Hook: ${lines[0] || ""}

\u25B6\uFE0F Body:
${lines.slice(1).join("\n")}

\u{1F514} CTA: Follow for more`;
          break;
        }
        case "text":
        default: {
          post = post.split("\n").map((ln) => ln.length > 0 ? `\u2022 ${ln}` : ln).join("\n");
          break;
        }
      }
      return { content: post, formatType };
    }
  });
  runtime.registerTool({
    name: "optimize_for_platform",
    description: "Optimize content for a target platform and knob settings",
    parameters: z.object({
      content: z.string(),
      platform: PlatformEnum$1,
      // Strict object with known fields; allow null to indicate no knobs provided
      knobs: KnobsParamSchema.nullable()
    }).strict().catchall(z.never()),
    handler: ({ content, platform, knobs }) => {
      let post = content.trim();
      const maxChars = {
        linkedin: 3e3,
        x: 280,
        facebook: 63206,
        instagram: 2200,
        youtube: 5e3,
        tiktok: 2200
      };
      const limit = maxChars[platform] || 3e3;
      if (post.length > limit) post = post.slice(0, limit - 3) + "...";
      const hook = knobs == null ? void 0 : knobs.hookIntensity;
      if (typeof hook === "number") {
        if (hook > 0.7) post = post.replace(/^•\s*/gm, "\u26A1 ");
        else if (hook < 0.3) post = post.replace(/^•\s*/gm, "\u2014 ");
      }
      return { content: post, platform, length: post.length, knobs };
    }
  });
}

const PlatformEnum = z.enum(["linkedin", "x", "facebook", "instagram", "youtube", "tiktok"]);
function registerQaTools(runtime) {
  runtime.registerTool({
    name: "qa_evaluate_content",
    description: "Evaluate content quality and compliance; return structured scores and suggestions",
    parameters: z.object({
      content: z.string(),
      platform: PlatformEnum,
      // Structured outputs limitation: use nullable instead of optional
      objective: z.string().nullable(),
      // Strict object to satisfy validator; include expected field(s)
      clientPolicy: z.object({
        bannedClaims: z.array(z.string()).nullable()
      }).strict().catchall(z.never()).nullable()
    }).strict().catchall(z.never()),
    handler: ({ content, platform, objective, clientPolicy }) => {
      var _a, _b;
      const length = content.trim().length;
      const readability = Math.max(0, Math.min(1, 0.9 - Math.max(0, length - 800) / 4e3));
      const clarity = Math.max(0, Math.min(1, 0.6 + Math.min(0.3, content.split("\n").length / 50)));
      const objectiveFit = objective && content.toLowerCase().includes((objective || "").toLowerCase()) ? 0.8 : 0.6;
      const brandRisk = ((_b = (_a = clientPolicy == null ? void 0 : clientPolicy.bannedClaims) == null ? void 0 : _a.some) == null ? void 0 : _b.call(_a, (c) => content.toLowerCase().includes(String(c).toLowerCase()))) ? 0.6 : 0.1;
      const compliance = brandRisk < 0.5;
      const feedback = [];
      if (length < 80) feedback.push("Content may be too short; consider adding a concrete insight or example.");
      if (length > 1200) feedback.push("Content may be too long; tighten for scannability.");
      if (brandRisk >= 0.5) feedback.push("Remove claims that conflict with client policy.");
      const composite = Math.max(0, Math.min(1, readability * 0.35 + clarity * 0.2 + objectiveFit * 0.35 - brandRisk * 0.2));
      const revisionPriority = composite > 0.8 && compliance ? "low" : composite > 0.6 ? "medium" : "high";
      return {
        readability,
        clarity,
        objectiveFit,
        brandRisk,
        compliance,
        feedback: feedback.join(" "),
        suggestedChanges: feedback,
        revisionPriority,
        composite
      };
    }
  });
}

let cached = null;
function getAgents() {
  if (cached) return cached;
  const runtime = new AgentRuntime();
  registerIOTools(runtime);
  registerStrategyTools(runtime);
  registerContentTools(runtime);
  registerQaTools(runtime);
  cached = {
    runtime,
    strategy: new StrategyManagerAgent(runtime),
    generator: new ContentGeneratorAgent(runtime),
    qa: new QualityAssuranceAgent(runtime)
  };
  return cached;
}

const agentsContainer = /*#__PURE__*/Object.freeze({
  __proto__: null,
  getAgents: getAgents
});

export { createContentAgent as a, createQaAgent as b, createStrategyAgent as c, analyzeAssetsLocal as d, agentsContainer as e, getAgents as g };;globalThis.__timing__.logEnd('Load chunks/_/agents-container');
//# sourceMappingURL=agents-container.mjs.map
