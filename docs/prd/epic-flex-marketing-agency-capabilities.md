# Flex Marketing Agency Capabilities - Brownfield Enhancement

## Epic Goal
Deliver a curated set of flex server capabilities and facets tailored for marketing agency workflows while leveraging the existing flex sandbox, so account teams can orchestrate campaigns without introducing net-new platform features.

## Epic Description

**Existing System Context:**
- Current relevant functionality: Flex agents server executes orchestrated workflows using registered capabilities streamed through the flex sandbox; marketing teams currently rely on generic content-generation paths.
- Technology stack: TypeScript workspace with Nitro-based agents server, OpenAI Agents SDK, shared `@awesomeposter/*` packages, Postgres via Drizzle, Vue SPA consuming SSE streams.
- Integration points: Capabilities registry in flex sandbox, shared contract types in `@awesomeposter/shared`, SSE consumers within Vue HITL tooling, existing logging and observability hooks.

**Enhancement Details:**
- What's being added/changed: Introduce marketing-agency-specific capability definitions, curated facets, and configuration presets inside the flex sandbox so planners can compose campaigns using industry-aligned building blocks.
- How it integrates: Capabilities register through the existing flex server envelope with no changes to transport; SPA and downstream services reuse the same contracts while selecting the new facets by ID.
- Success criteria: Marketing agency scenarios can be orchestrated end-to-end using only the new capability set, with no regressions to legacy flex flows and without requiring server or UI feature toggles.

## Stories
1. **Story 1:** Define marketing-agency capability taxonomy and facet metadata within the flex sandbox following existing envelope contracts.
2. **Story 2:** Rip and replace the existing flex sandbox capability catalog with the curated marketing-agency set, wiring configuration presets so planners immediately discover the new baseline.
3. **Story 3:** Validate campaign orchestration paths using the marketing capability set, documenting coverage and capturing any defects surfaced during sandbox runs.

## Compatibility Requirements
- [x] Existing APIs remain unchanged
- [x] Database schema changes are backward compatible
- [x] UI changes follow existing patterns
- [x] Performance impact is minimal

## Risk Mitigation
- **Primary Risk:** Encountering latent bugs in the flex sandbox or capability registry that slow delivery.
- **Mitigation:** Stage capability rollout through sandbox verification, log defects with reproduction steps, and keep fallback to legacy capability paths ready.
- **Rollback Plan:** Remove or disable the marketing capability registrations while leaving legacy capability catalog intact; rely on existing generic flows until fixes land.

## Open Risks & Assumptions (Story 11.1)
- Dynamic replanning feedback loop may require additional engineering before launch; current orchestration retries are brittle when planner feedback escalates, so Story 11.2 must budget time for instrumentation and failure-handling tweaks.
- Introducing the marketing capability taxonomy could expose latent sandbox defects because the system will execute unfamiliar capability IDs and task envelopes; validation needs broader scenario coverage to flush out compatibility gaps.
- `strategist.Positioning` may demand new supporting tools (web search integrations, embeddings-file accessors, or lightweight statistical analysis helpers); scope increases should be tracked so Story 11.2 can plan sequencing or guardrails.

## Definition of Done
- [ ] All stories completed with acceptance criteria met
- [ ] Existing functionality verified through testing
- [ ] Integration points working correctly
- [ ] Documentation updated appropriately
- [ ] No regression in existing features

---

**Story Manager Handoff:**

"Please develop detailed user stories for this brownfield epic. Key considerations:

- This enhancement targets the flex agents server and relies on the existing flex sandbox using the established TypeScript/Nitro/OpenAI stack.
- Integration points: flex sandbox capability registry, shared TypeScript contracts, SSE events consumed by the Vue HITL tooling, and existing logging/telemetry.
- Existing patterns to follow: current capability registration flow, sandbox-driven validation, and documentation formatting for capability metadata.
- Critical compatibility requirements: no new endpoints or UI feature toggles, maintain current SSE envelopes, and preserve legacy capability behavior.
- Each story must include verification passes within the flex sandbox to confirm marketing agency workflows run cleanly.

The epic should maintain system integrity while delivering marketing-aligned flex capabilities." 
