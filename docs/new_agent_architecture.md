
# [Historical]New Agent Architecture Implementation Plan

> Plan Update — 2025-09-03
>
> End goal: a separate Agents SDK server that fully owns orchestration, wired into the existing UI via a small AgentsService client and flag‑gated rollout. The UI calls the agents server over HTTP and streams progress via SSE. Legacy workflow endpoints proxy/alias temporarily and then are deprecated.

## Plan Update Summary

### Architectural Change
- Replace `/api/v1/workflow/*` with a single orchestrator entrypoint:
  - `POST /api/v1/agent/run.stream` (primary, SSE streaming)
  - Modes: `app` (structured JSON outputs) and `chat` (conversational sandbox)
  - Standardized progress frames (`AgentEvent`) for both modes
- Keep `/api/v1/workflow/*` as a temporary alias; plan deprecation headers + eventual removal
 - App integration: introduce `AgentsService` in the main app to call the agents server (including SSE), controlled by `USE_NEW_AGENTS` and per‑client gating

### Monitoring & Progress
- Emit normalized events: `start`, `phase`, `tool_call`, `tool_result`, `message`, `delta`, `metrics`, `warning`, `error`, `complete`
- Health endpoint is canonical at `/api/v1/health`; `/health` and `/api/health` redirect to the canonical path

### Security & Env
- `API_KEY` middleware enforced only when set
- `.env` loaded from package and monorepo root for DX

## Current Project Status (2025-09-03)

### Completed
- Agents server scaffolded (`packages/agents-server`) with Nitro + TS
- Canonical health route: `/api/v1/health` (+ redirects from `/health`, `/api/health`)
- Env loading plugin (`dotenv`) for package and repo root
- Database service and health check (`AgentsDatabaseService`)
- Agent runtime using `@openai/agents` (`Agent`, `Runner`, `tool`) with structured output and chat streaming
- Objective‑based orchestrator and streaming endpoint:
  - `POST /api/v1/agent/run.stream` with modes `app` and `chat` (chat gated in prod)
- Basic logging with correlation IDs (Winston + `x-correlation-id` propagation)
 - Core tools registered: IO (brief/assets/client profile) and Strategy (asset analysis + knob planning)

### In Progress
- Tooling: Content formatting + Platform optimization tools; QA scoring tool
- Event mapping: tool_call/result + timing; add token usage to `metrics`
- Align legacy `/workflow/*` to orchestrator (proxy/alias), then deprecate
- App integration: add `AgentsService` in app and proxy app routes behind `USE_NEW_AGENTS`
- SSE progress wiring from agents server to existing UI

### Not Started / Pending
- Guardrails (input/output) and tracing visualization
- Database‑backed event/session persistence (optional, start in‑memory)
- API documentation and integration tests
- Rollout flags and client allowlist finalization; cleanup of legacy


## Overview

This document outlines the detailed implementation plan for migrating from the current agent system to a modernized OpenAI Agent SDK–based architecture with a separate agents server. The Agent SDK runtime manages tool/function-calling loops, retries, and multi-turn coordination so our agents only register tools and business logic.

## Current vs. New Architecture

### Current Architecture
- **Orchestrator**: Manual workflow coordination with complex state management
- **Digital Marketeer**: Strategy planning and draft evaluation with manual prompt engineering
- **Copywriter**: Content generation with format-specific rendering logic
- **Integration**: Direct function calls within the main application server

### New Architecture
- **Strategy Manager Agent**: Asset analysis and 4‑knob optimization using structured outputs (Agent SDK runtime)
- **Content Generator Agent**: Multi‑platform content creation with Agent SDK tools for format rendering and platform optimization
- **Quality Assurance Agent**: Automated scoring and revision recommendations using structured outputs
- **Integration**: HTTP API communication with separate agents server (port 3002)

## Implementation Phases

---

## Phase 1: Foundation Setup (Weeks 1-2)

### Week 1: Project Structure & Dependencies

#### Day 1-2: Package Structure Setup
**Tasks:**
- [X] Create `packages/agents-server` directory structure
- [X] Initialize package.json with OpenAI AgentSDK dependencies
- [X] Set up TypeScript configuration
- [X] Create basic folder structure:
  ```
  packages/agents-server/
  ├── server/
  │   ├── api/
  │   │   └── health.get.ts
  │   ├── plugins/
  │   │   └── agents.ts
  │   └── middleware/
  │       └── v1-deprecation.ts
  ├── src/
  │   ├── agents/
  │   ├── services/
  │   └── utils/
  ├── tests/
  ├── nitro.config.ts
  ├── package.json
  └── tsconfig.json
  ```

**Deliverables:**
- Working package structure
- Package.json with correct dependencies
- TypeScript compilation working

**Additions (Agents SDK focus):**
- [X] Define standard SSE `AgentEvent` envelope in `@awesomeposter/shared`
- [X] Create `POST /api/v1/agent/run.stream` route scaffold
- [X] Add API key middleware and correlation ID propagation

**Dependencies to Add (Nitro runtime):**
```json
{
  "dependencies": {
    "@awesomeposter/db": "workspace:*",
    "@awesomeposter/shared": "workspace:*",
    "openai": "^5.12.2",
    "zod": "^3.25.76",
    "winston": "^3.11.0",
    "nitropack": "^2.12.4"
  },
  "devDependencies": {
    "@tsconfig/node22": "^22.0.2",
    "typescript": "~5.8.0"
  }
}
```

#### Day 3-4: Basic Server Setup (Nitro/H3)
**Tasks:**
- [X] Create Nitro app with basic health endpoint
- [X] Configure environment variables
- [X] Add basic logging with Winston

**Code Example:**
```typescript
// server/api/health.get.ts
export default defineEventHandler(() => ({
  status: 'healthy',
  timestamp: new Date().toISOString()
}))

// nitro.config.ts
import { defineNitroConfig } from 'nitropack/config'

export default defineNitroConfig({
  devServer: { port: 3002 },
  srcDir: '.',
  future: { nativeSWR: true }
})
```

**Deliverables:**
- Basic Nitro server running on port 3002
- Health check endpoint responding
- Logging system operational

**Agent Runtime Bootstrap (Nitro plugin):**
```typescript
// server/plugins/agents.ts
import { AgentRuntime } from '../../src/services/agent-runtime'
import { StrategyManagerAgent } from '../../src/agents/strategy-manager'
import { ContentGeneratorAgent } from '../../src/agents/content-generator'
import { QualityAssuranceAgent } from '../../src/agents/quality-assurance'

declare module 'h3' {
  interface H3EventContext {
    agents: {
      runtime: AgentRuntime
      strategy: StrategyManagerAgent
      generator: ContentGeneratorAgent
      qa: QualityAssuranceAgent
    }
  }
}

export default defineNitroPlugin((nitro) => {
  const runtime = new AgentRuntime()
  const agents = {
    runtime,
    strategy: new StrategyManagerAgent(runtime),
    generator: new ContentGeneratorAgent(runtime),
    qa: new QualityAssuranceAgent(runtime)
  }
  nitro.hooks.hook('request', (event) => {
    // attach per-request for convenience
    // @ts-ignore
    event.context.agents = agents
  })
})
```

#### Day 5: Database Integration
**Tasks:**
- [X] Set up database connection using existing `@awesomeposter/db` package
- [X] Create database service for agents server
- [X] Test database connectivity
- [X] Add database health check

**Code Example:**
```typescript
// src/services/database.ts
import { getDb } from '@awesomeposter/db'
import { assets, briefs, eq } from '@awesomeposter/db'
import type { Asset } from '@awesomeposter/shared'

export class AgentsDatabaseService {
  private db = getDb()

  async enrichBriefWithAssets(briefId: string) {
    const [brief] = await this.db.select().from(briefs).where(eq(briefs.id, briefId))
    const briefAssets = await this.db.select().from(assets).where(eq(assets.briefId, briefId))
    
    return {
      ...brief,
      assets: briefAssets.map(asset => ({
        id: asset.id,
        filename: asset.filename || '',
        url: asset.url,
        type: asset.type || 'other',
        mimeType: asset.mimeType || ''
      } as Asset))
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.db.select().from(briefs).limit(1)
      return true
    } catch {
      return false
    }
  }
}
```

### Week 2: Agent SDK Integration & Shared Types

#### Day 6-7: Agent SDK Runtime Setup
**Tasks:**
- [X] Install and configure `@openai/agents`
- [X] Implement AgentRuntime using `Agent`, `Runner`, and `tool`
- [X] Switch all tool parameter definitions to Zod schemas (no `z.any()`)
- [X] Set up structured output schemas with Zod for app results and scoring
- [X] Standardize SSE event mapping to `AgentEvent` (start/phase/tool_call/tool_result/metrics/error/complete)
- [X] Test basic Agents SDK connectivity and streaming

**Code Example:**
```typescript
// src/services/agent-runtime.ts
import OpenAI from 'openai'
import { z } from 'zod'

type ToolHandler = (args: any) => Promise<any> | any

export type RegisteredTool = {
  name: string
  description: string
  parameters: Record<string, any>
  handler: ToolHandler
}

export class AgentRuntime {
  private client: OpenAI
  private model = process.env.OPENAI_MODEL || 'gpt-4o'
  private tools: RegisteredTool[] = []

  constructor() {
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }

  registerTool(tool: RegisteredTool) {
    this.tools.push(tool)
  }

  async runStructured<T>(schema: z.ZodSchema<T>, messages: OpenAI.Chat.ChatCompletionMessageParam[]): Promise<T> {
    // Use JSON schema mode via response_format for structured outputs
    // The Agent runtime handles the loop if tools are not needed
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages,
      response_format: { type: 'json_object' }
    })
    const raw = completion.choices[0]?.message?.content
    if (!raw) throw new Error('No content from model')
    return schema.parse(JSON.parse(raw))
  }

  async runWithTools(messages: OpenAI.Chat.ChatCompletionMessageParam[]) {
    const toolSpecs = this.tools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }))

    const convo: OpenAI.Chat.ChatCompletionMessageParam[] = [...messages]

    while (true) {
      const res = await this.client.chat.completions.create({
        model: this.model,
        messages: convo,
        tools: toolSpecs,
        tool_choice: 'auto'
      })

      const msg = res.choices[0]?.message
      if (!msg) throw new Error('No message from model')

      // If no tool calls, we are done
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        return msg
      }

      // Execute tool calls and append results
      for (const call of msg.tool_calls) {
        const tool = this.tools.find(t => t.name === call.function.name)
        if (!tool) continue
        const args = JSON.parse(call.function.arguments || '{}')
        const result = await tool.handler(args)
        convo.push({
          role: 'tool',
          tool_call_id: call.id,
          content: typeof result === 'string' ? result : JSON.stringify(result)
        } as any)
      }

      // Add assistant message with tool calls to the conversation before next turn
      convo.push({ role: 'assistant', tool_calls: msg.tool_calls, content: msg.content || null } as any)
    }
  }
}
```

#### Day 8-9: Enhanced Shared Types
**Tasks:**
- [X] Extend shared types for new agent architecture
- [X] Create Zod schemas for API validation
- [X] Add new agent-specific types
- [X] Update existing types for backward compatibility

**Code Example:**
```typescript
// packages/shared/src/agent-types.ts
import { z } from 'zod'

export const WorkflowRequestSchema = z.object({
  briefId: z.string(),
  state: z.object({
    objective: z.string(),
    inputs: z.object({
      brief: z.object({
        id: z.string().optional(),
        title: z.string(),
        description: z.string().optional(),
        objective: z.string().optional()
      }),
      clientProfile: z.any().optional(),
      assets: z.array(z.any()).optional()
    })
  }),
  options: z.object({
    enableProgressTracking: z.boolean().optional(),
    maxRevisionCycles: z.number().optional()
  }).optional()
})

export type WorkflowRequest = z.infer<typeof WorkflowRequestSchema>

export interface AgentMetrics {
  executionTime: number
  tokensUsed: number
  revisionCycles: number
  qualityScore: number
  knobEffectiveness: {
    formatType: string
    hookIntensity: string
    expertiseDepth: string
    structure: string
  }
}
```

#### Day 10: Development Environment
**Tasks:**
- [X] Update root package.json scripts for concurrent development
- [X] Set up environment variables for both servers
- [ ] Create development documentation
- [X] Test concurrent server startup (npm run dev:all worksrw)

**Scripts (root awesomeposter/package.json):**
```json
{
  "scripts": {
    "dev": "vite",
    "dev:app": "vite",
    "dev:api": "PORT=3001 nitropack dev",
    "dev:agents": "cd packages/agents-server && npm run dev",
    "dev:both": "run-p dev:app dev:agents",
    "dev:all": "run-p dev:app dev:api dev:agents",
    "build:agents": "cd packages/agents-server && npm run build"
  }
}
```

**Success Criteria for Phase 1:**
- [X] Agents server runs successfully on port 3002
- [X] Health check endpoint returns 200 OK
- [X] Database connection established and tested
- [X] Agent SDK runtime configured and tested; tools use Zod parameters
- [X] Shared types updated and validated
- [X] Development environment supports concurrent servers
 - [X] SSE event schema implemented and used by orchestrator

---

## Phase 2: Core Agent Implementation (Weeks 3-4)

### Week 3: IO Tools Foundation

#### Day 11: Implement IO Tools
**Tasks:**
- [X] Add `io_get_brief` tool (fetch brief by id)
- [X] Add `io_list_assets` tool (list assets for a brief)
- [X] Add `io_get_client_profile` tool (fetch client profile by clientId)
- [X] Add basic tool-call logging and timing
- [X] Add tool-call error shaping (consistent error objects)
- [X] Enforce Zod parameter validation across all tools (fail fast with helpful errors)
- [X] Add tokens/time capture per run and emit `metrics` events

**Code Example:**
```typescript
// src/tools/io.ts
import { AgentRuntime } from '../services/agent-runtime'
import { getDb, briefs, assets, clients, eq, getClientProfileByClientId } from '@awesomeposter/db'

export function registerIOTools(runtime: AgentRuntime) {
  const db = getDb()
  runtime.registerTool({
    name: 'io_get_brief',
    description: 'Fetch a brief by id',
    parameters: { type: 'object', properties: { briefId: { type: 'string' } }, required: ['briefId'] },
    handler: async ({ briefId }) => {
      const [row] = await db.select().from(briefs).where(eq(briefs.id, briefId)).limit(1)
      if (!row) throw new Error('Brief not found')
      const [client] = await db.select().from(clients).where(eq(clients.id, row.clientId)).limit(1)
      return { ...row, clientName: client?.name }
    }
  })

  runtime.registerTool({
    name: 'io_list_assets',
    description: 'List assets for a brief',
    parameters: { type: 'object', properties: { briefId: { type: 'string' } }, required: ['briefId'] },
    handler: async ({ briefId }) => db.select().from(assets).where(eq(assets.briefId, briefId))
  })

  runtime.registerTool({
    name: 'io_get_client_profile',
    description: 'Fetch the client profile for a clientId',
    parameters: { type: 'object', properties: { clientId: { type: 'string' } }, required: ['clientId'] },
    handler: async ({ clientId }) => (await getClientProfileByClientId(clientId)) || null
  })
}

// src/services/agents-container.ts
import { registerIOTools } from '../tools/io'
const runtime = new AgentRuntime()
registerIOTools(runtime)
```

### Week 3: Strategy Manager Agent

#### Day 11-12: Asset Analysis Implementation
**Tasks:**
- [X] Implement asset analysis with structured outputs (initial heuristic tool)
- [X] Create format feasibility assessment
- [X] Add asset quality scoring
- [ ] Test with various asset combinations
- [ ] Integrate `strategy_plan_knobs` tool using Zod schema

**Code Example:**
```typescript
// src/agents/strategy-manager.ts
import { z } from 'zod'
import { AgentRuntime } from '../services/agent-runtime'
import type { Asset, AssetAnalysis } from '@awesomeposter/shared'

const AssetAnalysisSchema = z.object({
  achievableFormats: z.array(z.enum(['text', 'single_image', 'multi_image', 'document_pdf', 'video'])),
  recommendedFormat: z.enum(['text', 'single_image', 'multi_image', 'document_pdf', 'video']),
  assetQuality: z.object({
    images: z.object({
      count: z.number(),
      quality: z.enum(['high', 'medium', 'low'])
    }),
    documents: z.object({
      count: z.number(),
      hasSlides: z.boolean()
    }),
    videos: z.object({
      count: z.number(),
      duration: z.number().optional()
    })
  }),
  recommendations: z.array(z.string())
})

export class StrategyManagerAgent {
  constructor(private runtime: AgentRuntime) {}

  async analyzeAssets(assets: Asset[]): Promise<AssetAnalysis> {
    const images = assets.filter(a => a.type === 'image')
    const documents = assets.filter(a => a.type === 'document')
    const videos = assets.filter(a => a.type === 'video')

    const prompt = `Analyze the following assets and determine optimal content formats:
    
Images: ${images.length} files
Documents: ${documents.length} files (${documents.some(d => d.mimeType?.includes('pdf')) ? 'includes PDFs' : 'no PDFs'})
Videos: ${videos.length} files

Provide format recommendations and asset quality assessment.`

    const analysis = await this.runtime.runStructured(
      AssetAnalysisSchema,
      [{ role: 'user', content: prompt }]
    )

    return {
      availableAssets: assets,
      ...analysis,
      formatFeasibility: this.calculateFormatFeasibility(analysis.assetQuality)
    }
  }

  private calculateFormatFeasibility(assetQuality: any) {
    return {
      text: { feasible: true, reason: 'Always available', assetRequirements: [] },
      single_image: {
        feasible: assetQuality.images.count >= 1,
        reason: assetQuality.images.count >= 1 ? 'Sufficient images' : 'Need at least 1 image',
        assetRequirements: assetQuality.images.count >= 1 ? [] : ['At least 1 image']
      },
      multi_image: {
        feasible: assetQuality.images.count >= 3,
        reason: assetQuality.images.count >= 3 ? 'Sufficient images' : 'Need at least 3 images',
        assetRequirements: assetQuality.images.count >= 3 ? [] : ['At least 3 images']
      },
      document_pdf: {
        feasible: assetQuality.documents.count >= 1 && assetQuality.documents.hasSlides,
        reason: 'PDF or presentation required',
        assetRequirements: ['PDF or presentation document']
      },
      video: {
        feasible: assetQuality.videos.count >= 1,
        reason: assetQuality.videos.count >= 1 ? 'Video available' : 'Video required',
        assetRequirements: assetQuality.videos.count >= 1 ? [] : ['Video file']
      }
    }
  }
}
```

#### Day 13-14: 4-Knob Optimization
**Tasks:**
- [ ] Implement knob configuration with structured outputs
- [ ] Add client policy validation
- [ ] Create knob effectiveness scoring
- [ ] Test knob optimization logic
- [ ] Emit planning `phase` and `metrics` events; log rationale

**Code Example:**
```typescript
const KnobConfigurationSchema = z.object({
  formatType: z.enum(['text', 'single_image', 'multi_image', 'document_pdf', 'video']),
  hookIntensity: z.number().min(0).max(1),
  expertiseDepth: z.number().min(0).max(1),
  structure: z.object({
    lengthLevel: z.number().min(0).max(1),
    scanDensity: z.number().min(0).max(1)
  }),
  rationale: z.string()
})

async planStrategy(state: AgentState, assetAnalysis: AssetAnalysis): Promise<KnobConfiguration> {
  const prompt = `Based on the brief and available assets, optimize the 4-knob configuration:

Brief: ${state.inputs.brief.title}
Objective: ${state.objective}
Available Formats: ${assetAnalysis.achievableFormats.join(', ')}
Recommended Format: ${assetAnalysis.recommendedFormat}

Client Profile: ${JSON.stringify(state.inputs.clientProfile, null, 2)}

Determine optimal knob settings:
1. formatType: Must be from available formats
2. hookIntensity: 0.0-1.0 (attention-grabbing strength)
3. expertiseDepth: 0.0-1.0 (technical specificity)
4. structure: lengthLevel and scanDensity (0.0-1.0 each)

Provide rationale for each setting.`

  return await this.runtime.runStructured(
    KnobConfigurationSchema,
    [{ role: 'user', content: prompt }]
  )
}
```

#### Day 15: Strategy Integration
**Tasks:**
- [ ] Combine asset analysis and knob optimization
- [ ] Add platform-specific strategy generation
- [ ] Implement strategy validation
- [ ] Create comprehensive strategy response
- [ ] Wrap strategy steps as SDK tools for reuse by other agents

### Week 3: Handoffs and Agents-as-Tools

**Tasks:**
- [ ] Define specialist agents (Strategy, Content, QA) with domain instructions
- [ ] Expose specialists as tools callable by Orchestrator agent (minimal change path)
- [ ] Optionally, add `Agent.create({ handoffs: [...] })` triage pattern for future routing
- [ ] Verify finalOutput typing when using handoffs

### Week 4: Content Generator & Quality Assurance Agents

#### Day 16-17: Content Generator Agent
**Tasks:**
- [ ] Implement multi-platform content generation
- [ ] Add format-specific rendering with function calling
- [ ] Create language localization support
- [ ] Test content generation across platforms
- [ ] Register content tools: `apply_format_rendering`, `optimize_for_platform` (Zod params)
- [ ] Emit generation `phase`, `tool_call`, `tool_result`, and `metrics` events

**Code Example:**
```typescript
// src/agents/content-generator.ts
import { AgentRuntime } from '../services/agent-runtime'

export class ContentGeneratorAgent {
  constructor(private runtime: AgentRuntime) {
    // Register tools once per runtime (or externally at bootstrap)
    this.runtime.registerTool({
      name: 'apply_format_rendering',
      description: 'Apply format-specific rendering rules',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string' },
          formatType: { type: 'string', enum: ['text', 'single_image', 'multi_image', 'document_pdf', 'video'] }
        },
        required: ['content', 'formatType']
      },
      handler: ({ content, formatType }) => {
        // Minimal placeholder logic; real impl can be injected
        return { content, formatType }
      }
    })

    this.runtime.registerTool({
      name: 'optimize_for_platform',
      description: 'Optimize content for specific platform',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string' },
          platform: { type: 'string', enum: ['linkedin', 'x'] },
          knobs: { type: 'object' }
        },
        required: ['content', 'platform']
      },
      handler: ({ content, platform, knobs }) => {
        // Minimal placeholder logic; apply platform heuristics
        return { content, platform, knobs }
      }
    })
  }

  async generateContent(state: AgentState, platform: string, count: number = 3): Promise<Draft[]> {
    const messages = [
      {
        role: 'system' as const,
        content: `You are a content generator specializing in ${platform} posts. Use available tools to format and optimize content based on the 4-knob configuration.`
      },
      {
        role: 'user' as const,
        content: this.buildGenerationPrompt(state, platform, count)
      }
    ]

    const final = await this.runtime.runWithTools(messages)
    return this.processContentResponse(final, state, platform)
  }

  private buildGenerationPrompt(state: AgentState, platform: string, count: number): string {
    return `Generate ${count} content variants for ${platform}:

Brief: ${state.inputs.brief.title}
Objective: ${state.objective}
Language: ${state.inputs.clientProfile?.primaryCommunicationLanguage || 'US English'}

Knob Configuration:
- Format Type: ${state.knobs?.formatType}
- Hook Intensity: ${state.knobs?.hookIntensity}
- Expertise Depth: ${state.knobs?.expertiseDepth}
- Structure: Length ${state.knobs?.structure.lengthLevel}, Scan Density ${state.knobs?.structure.scanDensity}

Use the tools to apply format-specific rendering and platform optimization.`
  }
}
```

#### Day 18-19: Quality Assurance Agent
**Tasks:**
- [ ] Implement automated content scoring
- [ ] Add revision recommendation system
- [ ] Create compliance checking
- [ ] Test quality assessment accuracy
- [ ] Register `qa_evaluate_content` tool with Zod schema and structured output
- [ ] Emit QA `phase` and `metrics` events; return actionable suggestions

**Code Example:**
```typescript
// src/agents/quality-assurance.ts
import { z } from 'zod'
import { AgentRuntime } from '../services/agent-runtime'

const ContentScoreSchema = z.object({
  readability: z.number().min(0).max(1),
  clarity: z.number().min(0).max(1),
  objectiveFit: z.number().min(0).max(1),
  brandRisk: z.number().min(0).max(1),
  compliance: z.boolean(),
  feedback: z.string(),
  suggestedChanges: z.array(z.string()),
  revisionPriority: z.enum(['high', 'medium', 'low'])
})

export class QualityAssuranceAgent {
  constructor(private runtime: AgentRuntime) {}

  async evaluateContent(state: AgentState, draft: Draft): Promise<Scores> {
    const prompt = `Evaluate this ${draft.platform} post for quality and compliance:\n\nContent: \"${draft.post}\"\nObjective: ${state.objective}\nClient Guidelines: ${JSON.stringify(state.inputs.clientProfile, null, 2)}\n\nScore each dimension (0.0-1.0):\n- Readability: How easy to read and understand\n- Clarity: How clear the message is\n- Objective Fit: How well it meets the stated objective\n- Brand Risk: Risk to brand reputation (0 = no risk, 1 = high risk)\n- Compliance: Meets platform and legal requirements\n\nProvide specific feedback and suggested improvements.`

    const scores = await this.runtime.runStructured(
      ContentScoreSchema,
      [{ role: 'user', content: prompt }]
    )

    return {
      ...scores,
      composite: this.calculateCompositeScore(scores)
    }
  }

  private calculateCompositeScore(scores: any): number {
    const weights = {
      readability: 0.35,
      objectiveFit: 0.35,
      clarity: 0.20,
      brandRisk: -0.20
    }

    return Math.max(0, Math.min(1,
      scores.readability * weights.readability +
      scores.objectiveFit * weights.objectiveFit +
      scores.clarity * weights.clarity +
      scores.brandRisk * weights.brandRisk
    ))
  }
}
```

#### Day 20: Agent Integration & Testing
**Tasks:**
- [X] Create workflow orchestration service
- [ ] Integrate all three agents
- [ ] Add comprehensive error handling
- [ ] Create unit tests for each agent

**Success Criteria for Phase 2:**
- [ ] Strategy Manager Agent generates valid knob configurations
- [ ] Content Generator Agent produces platform-optimized content
- [ ] Quality Assurance Agent provides accurate scoring
- [ ] All agents use structured outputs and Agent SDK–managed tool calling
- [ ] Error handling covers edge cases
- [ ] Unit tests achieve >80% coverage
 - [ ] Orchestrator emits consistent `AgentEvent` stream across phases

---

## Phase 3: API Integration (Weeks 5-6)

### API Versioning Strategy

We use URL-based versioning as the canonical scheme. All endpoints mount under `/api/v1/...`. Future versions (e.g., `/api/v2/...`) will coexist during a deprecation window. A lightweight header `X-API-Version` can be sent by clients for analytics; routing is determined by the URL path.

Policy:
- Canonical versioning via URL path: `/api/v1`, `/api/v2`.
- Non-breaking changes only within a major version; breaking changes require a new major version.
- Deprecation window: when v2 launches, v1 returns `Deprecation: true` and `Sunset: <RFC1123 date>` headers; include `Link: </docs/changelog#v1>; rel="deprecation"`.
- Maintain separate OpenAPI specs per version.

Code Examples (Nitro/H3):
```typescript
// server/middleware/v1-deprecation.ts
export default defineEventHandler((event) => {
  const path = event.path || ''
  if (path.startsWith('/api/v1') && process.env.API_V1_DEPRECATION_START) {
    setHeader(event, 'Deprecation', 'true')
    if (process.env.API_V1_SUNSET) setHeader(event, 'Sunset', process.env.API_V1_SUNSET)
    setHeader(event, 'Link', '</docs/changelog#v1>; rel="deprecation"')
  }
})

// server/middleware/auth.ts
export default defineEventHandler((event) => {
  if (!event.path?.startsWith('/api/')) return
  const header = getHeader(event, 'authorization') || ''
  const expected = process.env.API_KEY
  if (!expected) throw createError({ statusCode: 500, statusMessage: 'Server misconfigured' })
  if (!header.startsWith('Bearer ')) throw createError({ statusCode: 401, statusMessage: 'Missing bearer token' })
  const token = header.slice('Bearer '.length)
  if (token !== expected) throw createError({ statusCode: 403, statusMessage: 'Invalid API key' })
})
```

### Week 5: REST API Implementation

#### Day 21-22: Core API Endpoints
**Tasks:**
- [ ] Implement workflow execution endpoints
- [X] Add individual agent endpoints (objective-based `agent/run.stream`)
- [X] Create request/response validation
- [ ] Add comprehensive error handling
- [X] Add versioned routes under `server/api/v1/**` and apply API key middleware
- [ ] Alias `/api/v1/workflow/*` to orchestrator (`agent/run.stream`) and mark deprecated via headers

**Code Example (Nitro v1 routes):**
```typescript
// server/api/v1/workflow/execute.post.ts
import { WorkflowRequestSchema } from '@awesomeposter/shared'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const request = WorkflowRequestSchema.parse(body)
  // Access orchestrator/agents via plugin
  const { strategy, generator, qa } = event.context.agents
  const orchestrator = new (await import('../../../../src/services/workflow-orchestrator')).WorkflowOrchestrator(
    strategy,
    generator,
    qa
  )
  const result = await orchestrator.executeWorkflow(request)
  return {
    success: true,
    workflowId: result.workflowId,
    finalState: result.finalState,
    metrics: result.metrics
  }
})

// server/api/v1/workflow/execute-with-progress.post.ts
import { WorkflowRequestSchema } from '@awesomeposter/shared'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const request = WorkflowRequestSchema.parse(body)

  // SSE headers
  setHeader(event, 'Content-Type', 'text/event-stream')
  setHeader(event, 'Cache-Control', 'no-cache')
  setHeader(event, 'Connection', 'keep-alive')

  const write = (data: any) => {
    event.node.res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  try {
    const { strategy, generator, qa } = event.context.agents
    const orchestrator = new (await import('../../../../src/services/workflow-orchestrator')).WorkflowOrchestrator(
      strategy,
      generator,
      qa
    )

    const result = await orchestrator.executeWorkflowWithProgress(request, (progress) => write(progress))
    write({ type: 'complete', result })
  } catch (error: any) {
    write({ type: 'error', error: error?.message || 'Unknown error' })
  } finally {
    event.node.res.end()
  }
})
```

#### Day 23-24: Server-Sent Events for Progress
**Tasks:**
- [X] Implement SSE for real-time progress tracking
- [X] Add progress event types and formatting
- [ ] Test progress streaming
- [ ] Handle client disconnections gracefully
- [ ] Ensure SSE events conform to `AgentEvent` in all phases

#### Day 25: API Documentation & Testing
**Tasks:**
- [ ] Create OpenAPI/Swagger documentation
- [ ] Add API integration tests
- [ ] Test error scenarios
- [ ] Validate request/response schemas

### Week 6: Main App Integration

#### Day 26-27: AgentsService Implementation
**Tasks:**
- [ ] Create `AgentsService` HTTP client in main app (base URL, API key, version)
- [ ] Implement workflow execution and SSE methods in `AgentsService`
- [ ] Add feature flag `USE_NEW_AGENTS` and per-client allowlist for rollout
- [ ] Proxy legacy app routes to agents server when flag is on
- [ ] Wire UI to SSE progress (e.g., `CreatePostPopup.vue`, progress UI)
- [ ] Handle network errors and retries; display user-friendly errors

**Code Example:**
```typescript
// awesomeposter/server/services/agents-service.ts
import type { WorkflowRequest, WorkflowResponse } from '@awesomeposter/shared'

export class AgentsService {
  private baseUrl = process.env.AGENTS_SERVER_URL || 'http://localhost:3002'
  private apiKey = process.env.AGENTS_SERVER_API_KEY
  private version = process.env.AGENTS_SERVER_API_VERSION || 'v1'

  private headers() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      'X-API-Version': this.version
    } as Record<string, string>
  }

  async executeWorkflow(request: WorkflowRequest): Promise<WorkflowResponse> {
    const response = await fetch(`${this.baseUrl}/api/${this.version}/workflow/execute`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(request)
    })

    if (!response.ok) {
      throw new Error(`Agents server error: ${response.statusText}`)
    }

    return response.json()
  }

  async executeWorkflowWithProgress(
    request: WorkflowRequest,
    onProgress: (progress: any) => void
  ): Promise<WorkflowResponse> {
    const response = await fetch(`${this.baseUrl}/api/${this.version}/workflow/execute-with-progress`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(request)
    })

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()
    let buffer = ''
    let result: WorkflowResponse | null = null

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let idx: number
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        const line = frame.trim()
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6))
          if (data.type === 'complete') result = data.result
          else if (data.type === 'error') throw new Error(data.error)
          else onProgress(data)
        }
      }
    }

    if (!result) throw new Error('No result received')
    return result
  }
}
```

#### Day 28-29: API Route Updates
**Tasks:**
- [ ] Update existing agent API routes to proxy to agents server
- [ ] Add feature flags for gradual rollout
- [ ] Maintain backward compatibility
- [ ] Add fallback to old system if needed

**Code Example:**
```typescript
// awesomeposter/server/api/agent/execute-workflow.post.ts
import { defineEventHandler, readBody, createError } from 'h3'
import { AgentsService } from '../../services/agents-service'
import { AgentOrchestrator } from '../../utils/agents/orchestrator' // Legacy

const USE_NEW_AGENTS = process.env.USE_NEW_AGENTS === 'true'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    
    if (USE_NEW_AGENTS) {
      // Use new agents server
      const agentsService = new AgentsService()
      return await agentsService.executeWorkflow(body)
    } else {
      // Use legacy system
      const orchestrator = new AgentOrchestrator()
      return await orchestrator.executeWorkflow(body.state)
    }
  } catch (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Workflow execution failed'
    })
  }
})
```

#### Day 30: Integration Testing
**Tasks:**
- [ ] Test end-to-end workflow execution
- [ ] Validate progress tracking functionality
- [ ] Test error handling and fallbacks
- [ ] Performance testing and optimization

**Success Criteria for Phase 3:**
- [ ] All API endpoints functional and documented
- [ ] Progress tracking works reliably
- [ ] Main app successfully communicates with agents server
- [ ] Feature flags enable gradual rollout
- [ ] Backward compatibility maintained
- [ ] Integration tests pass
- [X] API versioning mounted at `/api/v1` with deprecation headers supported
 - [ ] Legacy workflow routes safely alias to orchestrator

---

## Phase 4: Testing & Optimization (Weeks 7-8)

### Week 7: Comprehensive Testing

#### Day 31-32: Integration Testing
**Tasks:**
- [ ] Create comprehensive integration test suite
- [ ] Test all workflow scenarios
- [ ] Validate 4-knob system preservation
- [ ] Test error scenarios and recovery
- [ ] Add contract tests for `AgentEvent` stream structure

**Test Examples:**
```typescript
// tests/integration/workflow.test.ts
describe('Workflow Integration', () => {
  test('should execute complete workflow with all agents', async () => {
    const request = {
      briefId: 'test-brief-123',
      state: {
        objective: 'Increase brand awareness',
        inputs: {
          brief: {
            title: 'Test Brief',
            description: 'Test description'
          },
          assets: [
            { id: '1', type: 'image', url: 'test.jpg' }
          ]
        }
      }
    }

    const result = await agentsService.executeWorkflow(request)
    
    expect(result.success).toBe(true)
    expect(result.finalState.knobs).toBeDefined()
    expect(result.finalState.drafts).toHaveLength(3)
    expect(result.metrics.qualityScore).toBeGreaterThan(0.7)
  })

  test('should handle progress tracking correctly', async () => {
    const progressEvents = []
    
    await agentsService.executeWorkflowWithProgress(
      request,
      (progress) => progressEvents.push(progress)
    )

    expect(progressEvents.length).toBeGreaterThan(0)
    expect(progressEvents[0]).toHaveProperty('currentStep')
    expect(progressEvents[0]).toHaveProperty('percentage')
  })
})
```

#### Day 33-34: Performance Testing
**Tasks:**
- [ ] Benchmark workflow execution times
- [ ] Test concurrent request handling
- [ ] Memory usage analysis
- [ ] Optimize bottlenecks

#### Day 35: Load Testing
**Tasks:**
- [ ] Test server under load
- [ ] Validate rate limiting
- [ ] Test OpenAI API rate limits
- [ ] Optimize for production load

### Week 8: Production Readiness

#### Day 36-37: Monitoring & Observability
**Tasks:**
- [ ] Add comprehensive logging
- [ ] Implement metrics collection
- [X] Set up health checks
- [ ] Add alerting for failures
- [ ] Capture and expose token usage, durations, and tool timings
- [ ] Optional: wire tracing viewer if available from SDK

**Code Example:**
```typescript
// src/utils/metrics.ts
export class MetricsCollector {
  private metrics = {
    workflowExecutions: 0,
    averageExecutionTime: 0,
    errorRate: 0,
    tokensUsed: 0
  }

  recordWorkflowExecution(duration: number, tokensUsed: number, success: boolean) {
    this.metrics.workflowExecutions++
    this.metrics.averageExecutionTime = 
      (this.metrics.averageExecutionTime + duration) / 2
    this.metrics.tokensUsed += tokensUsed
    
    if (!success) {
      this.metrics.errorRate = 
        (this.metrics.errorRate * (this.metrics.workflowExecutions - 1) + 1) / 
        this.metrics.workflowExecutions
    }
  }

  getMetrics() {
    return { ...this.metrics }
  }
}
```

#### Day 38-39: Security & Deployment
**Tasks:**
- [X] Add API authentication
- [ ] Implement rate limiting
- [ ] Security audit and fixes
- [ ] Create deployment scripts
- [ ] Secrets hygiene: remove real secrets from VCS; enforce `.env` and CI secrets management
- [ ] CORS tightening for known app origins

#### Day 40: Documentation & Handover
**Tasks:**
- [ ] Complete API documentation
- [ ] Create deployment guide
- [ ] Write troubleshooting guide
- [ ] Conduct knowledge transfer

**Success Criteria for Phase 4:**
- [ ] All tests pass with >90% coverage
- [ ] Performance meets or exceeds current system
- [ ] Monitoring and alerting operational
- [ ] Security measures implemented
- [ ] Documentation complete
- [ ] System ready for production deployment
 - [ ] Guardrails and tracing enabled or deferred with clear plan

---

## Rollout Strategy

### Feature Flag Implementation
```typescript
// Environment variables for gradual rollout
USE_NEW_AGENTS=false           // Global toggle
NEW_AGENTS_PERCENTAGE=0        // Percentage of requests to new system
NEW_AGENTS_WHITELIST=client1,client2  // Specific clients for testing
```

### Rollout Phases
1. **Internal Testing** (0% traffic): Team testing
1. **Internal Testing** (0% traffic): Team testing with feature flag
2. **Beta Testing** (5% traffic): Selected clients with monitoring
3. **Gradual Rollout** (25% → 50% → 75%): Incremental traffic increase
4. **Full Migration** (100% traffic): Complete switch to new system

### Monitoring During Rollout
- **Performance Metrics**: Response times, error rates, throughput
- **Quality Metrics**: Content scores, revision rates, client satisfaction
- **System Metrics**: CPU usage, memory consumption, OpenAI API usage
- **Business Metrics**: Workflow completion rates, client engagement

---

## Risk Mitigation

### Technical Risks
1. **OpenAI API Reliability**
   - **Risk**: Service outages or rate limiting
   - **Mitigation**: Implement retry logic, circuit breakers, and fallback to legacy system

2. **Network Latency**
   - **Risk**: HTTP communication slower than direct function calls
   - **Mitigation**: Connection pooling, request batching, local caching

3. **Data Consistency**
   - **Risk**: State synchronization issues between services
   - **Mitigation**: Atomic operations, transaction boundaries, state validation

### Business Risks
1. **Quality Regression**
   - **Risk**: New system produces lower quality content
   - **Mitigation**: A/B testing, quality benchmarking, gradual rollout

2. **Performance Degradation**
   - **Risk**: Slower workflow execution
   - **Mitigation**: Performance testing, optimization, SLA monitoring

3. **Client Disruption**
   - **Risk**: Service interruption during migration
   - **Mitigation**: Feature flags, rollback procedures, communication plan

---

## Success Metrics

### Technical Metrics
- **Performance**: ≤ 10% increase in workflow execution time
- **Reliability**: ≥ 99.5% uptime for agents server
- **Quality**: Maintain or improve content quality scores
- **Scalability**: Handle 2x current load without degradation

### Business Metrics
- **Client Satisfaction**: No decrease in satisfaction scores
- **Content Quality**: Maintain current quality standards
- **Operational Efficiency**: Reduce manual intervention by 30%
- **Development Velocity**: Faster feature development and deployment

---

## Post-Migration Cleanup

### Legacy System Removal (Week 9-10)
1. **Code Cleanup**
   - Remove old agent classes
   - Clean up unused dependencies
   - Update documentation

2. **Database Cleanup**
   - Archive old workflow data
   - Remove deprecated fields
   - Optimize queries

3. **Monitoring Updates**
   - Remove legacy metrics
   - Update dashboards
   - Adjust alerting rules

### Optimization Phase (Week 11-12)
1. **Performance Optimization**
   - Analyze bottlenecks
   - Implement caching strategies
   - Optimize database queries

2. **Feature Enhancements**
   - Add new OpenAI capabilities
   - Implement advanced agent features
   - Enhance monitoring and observability

---

## Appendix

### Environment Variables

#### Main Application
```bash
# Agents server configuration
AGENTS_SERVER_URL=http://localhost:3002
AGENTS_SERVER_API_KEY=your-api-key
AGENTS_SERVER_API_VERSION=v1

# Feature flags
USE_NEW_AGENTS=false
NEW_AGENTS_PERCENTAGE=0
NEW_AGENTS_WHITELIST=

# Fallback configuration
ENABLE_AGENT_FALLBACK=true
FALLBACK_TIMEOUT_MS=30000
```

#### Agents Server
```bash
# Server configuration
PORT=3002
NODE_ENV=development

# OpenAI configuration
OPENAI_API_KEY=your-openai-key
OPENAI_MODEL=gpt-4o
OPENAI_MAX_TOKENS=2000

# Database configuration
DATABASE_URL=postgresql://...

# Security
API_KEY=your-api-key
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
API_V1_DEPRECATION_START=
API_V1_SUNSET=

# Monitoring
LOG_LEVEL=info
METRICS_ENABLED=true
```

### Useful Commands

#### Development
```bash
# Start both servers
npm run dev

# Start only agents server
npm run dev:agents

# Build agents server
npm run build:agents

# Run tests
npm run test:agents
```

#### Production
```bash
# Build and deploy agents server
npm run build:agents
docker build -t agents-server packages/agents-server
docker run -p 3002:3002 agents-server

# Health check
curl http://localhost:3002/health
```

### Troubleshooting Guide

#### Common Issues

1. **Agents server won't start**
   - Check environment variables
   - Verify database connection
   - Check OpenAI API key

2. **Workflow execution fails**
   - Check agents server logs
   - Verify request format
   - Test individual agents

3. **Progress tracking not working**
   - Check SSE connection
   - Verify client-side event handling
   - Check network connectivity

4. **Quality scores inconsistent**
   - Review scoring prompts
   - Check client profile data
   - Validate knob configurations

#### Log Analysis
```bash
# View agents server logs
docker logs agents-server

# Filter for errors
docker logs agents-server | grep ERROR

# Monitor real-time logs
docker logs -f agents-server
```

---

## Conclusion

This implementation plan provides a comprehensive roadmap for migrating to a modern OpenAI AgentSDK-based architecture while maintaining all existing functionality. The phased approach ensures minimal risk and allows for thorough testing at each stage.

Key benefits of the new architecture:
- **Simplified orchestration** using OpenAI's native patterns
- **Better performance** with structured outputs and Agent SDK tool calling
- **Independent scaling** of agent workloads
- **Enhanced maintainability** with cleaner separation of concerns
- **Future-ready** foundation for advanced AI capabilities

The migration preserves your sophisticated 4-knob optimization system while modernizing the underlying technology stack for better performance, reliability, and developer experience.
