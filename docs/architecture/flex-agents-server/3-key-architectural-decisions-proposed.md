# 3. Key Architectural Decisions (Proposed)
- Clone `packages/agents-server/` into `packages/flex-agents-server/`, retaining the Nitro runtime, shared utilities, and deployment footprint.
- Expose a new SSE endpoint `POST /api/v1/flex/run.stream` that accepts a `TaskEnvelope` containing objectives, constraints, and a client-supplied JSON Schema contract.
- Rely on the `TaskEnvelope` to carry all runtime policies (client-specific variants, brand safety directives, etc.); the orchestrator remains stateless with no separate preference lookup layer.
- Represent agent abilities in a `CapabilityRegistry` (static metadata plus optional embeddings) so the planner can map requested outcomes to available agents/tools.
- Use `Zod + Ajv` validation to enforce the client schema before emitting final responses, returning structured validation errors over the stream if expectations are not met.
- Keep persistence and HITL semantics compatible with the existing schema, extending tables where necessary rather than starting a separate database.
