# Social Strategist Agent Intelligence - Brownfield Enhancement

## Epic Goal
Equip the social strategist flex agent with contextual knowledge, analytics-driven guidance, and asset awareness so it consistently proposes high-performing, on-brand social content without relying solely on a static prompt.

## Epic Description

**Existing System Context**
- `strategist-social-posting` agent currently relies on a monolithic prompt with no retrieval-augmented context, heuristic library, or tooling integration.
- Flex agents server already provides capability registration, orchestrated tool usage, and planner integration for marketing agents.
- Organizations maintain external knowledge about brand heuristics, campaign performance, and creative assets that are not yet exposed in agent workflows.

**Enhancement Details**
- Introduce a curated reference corpus (RAG) covering social media best practices, brand heuristics, and past campaign exemplars the agent can query during planning.
- Wire analytical tools that surface channel- and company-specific performance signals (e.g., engagement benchmarks, audience resonance indicators) for each content brief.
- Expose catalog tooling that enumerates available creative assets and formats so the strategist recommends feasible post types aligned with inventory.
- Update the agent prompt scaffolding to blend retrieved references, analytics, and asset context while preserving existing planner orchestration contracts.

**Integration Considerations**
- Leverage existing flex agents server infrastructure for tool registration, capability metadata, and execution without changes to other services.
- Store reference corpora and analytics connectors within existing knowledge store/config patterns used by other flex marketing agents.
- Ensure asset catalog tooling can read from current storage descriptors (e.g., R2-backed manifests or shared metadata services) without modifying upstream pipelines.
- Maintain existing agent API surface so downstream planners and evaluation harnesses remain compatible.

**Success Criteria**
- Social strategist outputs demonstrably incorporate retrieved best practices, relevant performance insights, and available asset references.
- Planner runs continue to execute without changes to dependent agents or orchestrations when the enhanced strategist is invoked.
- Tool usage, retrieval calls, and resulting recommendations are observable through existing logging and telemetry surfaces.
- Stakeholders confirm improved relevance and actionability of generated social content briefs across target company profiles.

## Stories
1. Enrich the social strategist agent with a retrieval pipeline and curated knowledge base covering social heuristics, tone guides, and exemplar briefs.
2. Integrate analytics tooling that surfaces channel/company performance insights and feed those signals into the agent decision flow.
3. Register an asset inventory tool and update the agent prompt scaffold to align recommendations with feasible creative formats, including instrumentation for observability.

## Compatibility Requirements
- [ ] Flex agents API contracts remain unchanged for existing consumers.
- [ ] Agent orchestration continues to function for other marketing agents without additional configuration.
- [ ] No database schema or cross-service changes required outside `packages/flex-agents-server`.

## Risk Mitigation
- **Knowledge Drift:** Establish a lightweight refresh procedure for the reference corpus so outdated heuristics do not bias outputs.
- **Analytics Signal Quality:** Validate analytics tool responses with sample companies and fallback gracefully when metrics are incomplete.
- **Asset Catalog Gaps:** Provide clear messaging when asset inventories are missing or stale to prevent infeasible content recommendations.

## Definition of Done
- [ ] All stories refined with acceptance criteria and testing expectations.
- [ ] Retrieval corpus, analytics tooling, and asset inventory integrations are operational behind the social strategist capability.
- [ ] Updated prompt scaffold produces briefs that reference retrieved knowledge, analytics insights, and assets in validation scenarios.
- [ ] Telemetry and logging confirm tool invocations and retrieved context for auditability.
- [ ] Documentation updated for agent capability usage, configuration, and maintenance workflows.

---

**Story Manager Handoff:**

"Please develop detailed user stories for this brownfield epic. Key considerations:

- This enhances the `strategist-social-posting` flex agent within the existing flex agents server stack (TypeScript, OpenAI Agents orchestration).
- Integration points: RAG knowledge base registration, analytics insight tooling, and asset inventory enumeration tools within `packages/flex-agents-server`.
- Existing patterns to follow: flex agent capability registration, tool adapter conventions, and planner/telemetry contracts.
- Critical compatibility requirements: no changes to external APIs, keep enhancements self-contained to the agent, ensure togglable rollout via tool configuration.
- Each story must include verification that baseline social strategist behavior remains stable when enhanced tooling is unavailable or disabled."
