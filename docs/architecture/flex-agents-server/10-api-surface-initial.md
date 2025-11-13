# 10. API Surface (Initial)
- `POST /api/v1/flex/run.stream`: primary SSE entry point; accepts `TaskEnvelope`, streams `FlexEvent` frames, and enforces output schema validation.
- `POST /api/v1/flex/run.resume`: resumes paused runs after HITL resolution; accepts the run ID and operator payload.
- `GET /api/v1/flex/tasks`: lists pending flex human assignments with filter support (`capabilityId`, `status`).
- `POST /api/v1/flex/tasks/:taskId/decline`: records a structured decline for a flex task, ending the run according to policy.
- `POST /api/v1/flex/hitl/resolve`: records operator decisions that originate from the SPA; reuses existing auth model.
- `POST /api/v1/flex/capabilities/register`: agents call this on boot to advertise or refresh their `CapabilityRegistration`; orchestrator updates the registry and acknowledges health status.
- `GET /api/v1/flex/runs/:id`: debugging endpoint returning persisted envelope, plan graph, and outputs (auth-gated).

## 10.0.1 Flex Run Streaming Contract
The `/api/v1/flex/run.stream` controller validates the incoming envelope, persists an initial `flex_runs` row, and streams `FlexEvent` frames for planner lifecycle updates. Frames conform to `{ type, id?, timestamp, payload?, message?, runId?, nodeId? }`. Supported event types in this release:

- `start`: emitted after persistence with `payload.runId` and optional `threadId`.
- `plan_requested`: planner handshake has started; payload includes attempt number, normalized policy keys, and capability snapshot metadata. When the request is the result of an automatic replan the payload also carries `replan = { reason: string, failedGoalConditions?: GoalConditionResult[] }`, where goal-condition failures list the facet, pointer, DSL, JSON-Logic, observed value, and evaluation error that triggered the cycle.
- `plan_rejected`: validation failed; payload surfaces structured diagnostics aligned with planner feedback loops.
- `plan_generated`: contains trimmed plan metadata (`nodes[{ id, capabilityId, label }]`). Replan-driven generations echo the `replan` metadata described above so clients can display rationale alongside the fresh plan version.
- `plan_updated`: new plan version persisted after replanning or HITL resume; payload includes `previousVersion`, `version`, summary node statuses, trigger metadata, and (when applicable) the same `replan` structure so operators can see why the plan changed.
- `node_start` / `node_complete` / `node_error`: per-node execution lifecycle.
- `policy_triggered`: emitted when runtime policies fire (including during resume); payload includes canonical `actionDetails` (type, metadata, nested follow-ups) alongside legacy fields so clients can identify the requested behaviour.
- `goal_condition_failed`: emitted when a run fails one or more goal predicates; payload includes the failed predicate structures, the automatic replan attempt number, and the configurable retry cap.
- `hitl_request`: surfaced when policies require human approval; downstream UI pauses the run.
-  `hitl_request` payloads include `pendingNodeId`, `contractSummary` (compiled facets + contracts), and `operatorPrompt` so clients can render enriched approval context. Resume streams emit the same structure until the request resolves.
- `validation_error`: Ajv validation failures (payload contains `scope` and `errors[]` for structured UI handling).
- `complete`: final frame containing `payload.output` that satisfies the caller schema. When envelopes supplied `goal_condition` entries, `payload.goal_condition_results` lists the evaluated predicates (facet, path, expression, DSL, JSON-Logic, observed value, satisfied flag, error message if evaluation failed) so clients can see which ones passed without re-inspecting facet snapshots. The orchestrator withholds this frame until all failed predicates have been reparsed and satisfied or the automatic replan cap has been exceeded.
- `log`: informational/debug messages.

Each frame carries `runId` (and `nodeId` for node-scoped events) at the top level, allowing consumers to correlate updates without re-parsing payloads.

**Resume after HITL/Flex Task Submission:** Once the operator submits via `/api/v1/flex/run.resume`, the client should open a fresh stream with the same `threadId` and set `constraints.resumeRunId` to the previous `runId`. The coordinator will rehydrate the persisted plan, emit `plan_generated`/`node_complete` frames, validate the stored output, and finish with `complete`. Declines go through `/api/v1/flex/tasks/:taskId/decline`, triggering policy-defined fail paths without attempting resume.

**Facet goal predicates.** Envelopes may include an optional `goal_condition` array. Each entry names the facet being inspected, points to a path within that facet payload, and supplies the shared Condition DSL envelope. The runtime ANDs the entries together—callers can require multiple facets to satisfy their predicates before the run is marked complete while still keeping the planner contracts immutable. If any predicate fails, the execution engine triggers a `goal_condition_failed` replan, surfaces the failed structures on planner lifecycle frames, and retries up to `FLEX_GOAL_CONDITION_REPLAN_LIMIT` times before returning a terminal `complete` with the failure metadata.

Example `curl` invocation:

```bash
curl -N \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -H "Authorization: Bearer $FLEX_TOKEN" \
  -d @envelope.json \
  http://localhost:3003/api/v1/flex/run.stream
```

Sample envelope payload (`envelope.json`):

```json
{
  "objective": "Create LinkedIn post variants promoting AwesomePoster",
  "inputs": {
    "channel": "linkedin",
    "goal": "attract_new_employees",
    "variantCount": 2,
    "contextBundles": [
      {
        "type": "company_profile",
        "payload": {
          "companyName": "AwesomePoster",
          "coreValue": "Human-first automation",
          "recentEvent": "Summer retreat in Tahoe"
        }
      }
    ]
  },
  "policies": {
    "brandVoice": "inspiring",
    "requiresHitlApproval": false
  },
  "goal_condition": [
    {
      "facet": "post_copy",
      "path": "/variants[0]",
      "condition": {
        "dsl": "quality_score >= 0.8",
        "jsonLogic": {
          ">=": [
            { "var": "quality_score" },
            0.8
          ]
        }
      }
    },
    {
      "facet": "post_visual",
      "path": "/asset/status",
      "condition": {
        "dsl": "status == \"approved\"",
        "jsonLogic": {
          "==": [
            { "var": "status" },
            "approved"
          ]
        }
      }
    }
  ],
  "specialInstructions": [
    "Variant A should highlight team culture.",
    "Variant B should highlight career growth opportunities."
  ],
  "outputContract": {
    "mode": "json_schema",
    "schema": {
      "type": "object",
      "required": ["copyVariants"],
      "properties": {
        "copyVariants": {
          "type": "array",
          "minItems": 2,
          "maxItems": 2,
          "items": {
            "type": "object",
            "required": ["headline", "body", "callToAction"],
            "properties": {
              "headline": { "type": "string" },
              "body": { "type": "string" },
              "callToAction": { "type": "string" }
            }
          }
        }
      }
    }
  }
}
```

**Resume example:**

```bash
curl -N \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -H "Authorization: Bearer $FLEX_TOKEN" \
  -d '{"runId":"flex_resume_123","expectedPlanVersion":4}' \
  http://localhost:3003/api/v1/flex/run.resume
```

The resume stream rehydrates the latest persisted plan snapshot, validates that the caller provided the current plan version, and emits `plan_updated` + `policy_triggered` frames if the HITL operator responses require replanning. Consumers should handle the same event catalogue as the initial stream and expect the `plan_generated` frame to include `metadata.resumed: true` for traceability.

## 10.1 Flex Run Debugging

`GET /api/v1/flex/runs/:id` returns a redacted snapshot of persisted state for support tooling:

- `run`: envelope metadata, schema hash, plan version, and the most recent facet snapshot (sensitive keys such as `token`, `secret`, `apiKey`, etc. are redacted by default).
- `output`: latest recorded result plus facet provenance when available.
- `planVersions`: plan history with timestamps, pending node IDs, and planner metadata.
- `latestSnapshot`: raw snapshot payload (`nodes`, `edges`, compiled contracts) for visual debuggers.
- `nodes`: current node ledger (status, context, output, provenance) to diagnose partial executions.

```bash
curl \
  -H "Accept: application/json" \
  -H "Authorization: Bearer $FLEX_TOKEN" \
  http://localhost:3003/api/v1/flex/runs/flex_resume_123
```

Example response excerpt:

```json
{
  "ok": true,
  "run": {
    "runId": "flex_resume_123",
    "planVersion": 4,
    "metadata": { "lastOperator": { "displayName": "HITL Agent" } }
  },
  "planVersions": [
    { "version": 3, "pendingNodeIds": ["node_policy"], "schemaHash": "c0ffee" }
  ],
  "latestSnapshot": {
    "version": 4,
    "pendingNodeIds": [],
    "facets": { "copyVariants": { "value": [{ "headline": "Resume complete" }] } }
  }
}
```

Use this endpoint during incident response to validate operator guidance, inspect planner revisions, or export artifacts for external ticketing systems.

## 10.1 Sample TaskEnvelope
```json
{
  "objective": "Generate LinkedIn post variants promoting Akkuro's AI compliance tooling launch.",
  "inputs": {
    "companyProfile": {
      "name": "Akkuro",
      "positioning": "AI compliance copilots for regulated teams"
    },
    "toneOfVoice": ["confident", "supportive"],
    "contentBrief": "Launch announcement focused on risk reduction."
  },
  "policies": {
    "persona": "marketer",
    "variantCount": 2,
    "hitlRequiredFor": ["final_publish"]
  },
  "goal_condition": [
    {
      "facet": "handoff_summary",
      "path": "/status",
      "condition": {
        "dsl": "status == \"ready\"",
        "jsonLogic": {
          "==": [
            { "var": "status" },
            "ready"
          ]
        }
      }
    }
  ],
  "specialInstructions": [
    "Highlight the new real-time audit trail feature.",
    "Avoid claims about replacing human reviewers."
  ],
  "outputContract": {
    "schema": {
      "type": "object",
      "properties": {
        "copyVariants": {
          "type": "array",
          "minItems": 2,
          "items": {
            "type": "object",
            "properties": {
              "headline": { "type": "string" },
              "body": { "type": "string" },
              "callToAction": { "type": "string" }
            },
            "required": ["headline", "body", "callToAction"]
          }
        }
      },
      "required": ["copyVariants"]
    }
  }
}
```
