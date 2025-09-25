# Epic: Client Source Configuration

## Epic Goal
Give marketing operators per-client control over which HTTP web sources and topic keywords feed the discovery agent, ensuring configuration is fast, safe, and auditable.

## Problem Statement
- Today operators lack a structured way to register sources, leading to ad-hoc ingestion lists and accuracy issues.
- The discovery agent’s 95% relevance target relies on precise source and keyword calibration per client.

## Objectives & Success Metrics
- Enable operators to configure sources and keywords without engineering support.
- Maintain clean, validated configuration data across clients.
- Diagnostic KPIs: number of configured sources per client, configuration error rate (<5%).

## Scope (In)
- UI flows for adding, editing, and removing HTTP web sources tied to a client.
- Keyword/topic management with duplication prevention and input guidance.
- Validation of source reachability and URL format during configuration.
- Immediate persistence of configuration changes with optimistic UI feedback.

## Scope (Out)
- Non-HTTP sources (e.g., social APIs, PDF uploads).
- Automated source recommendations or discovery.
- Role-based access control (all authenticated users can edit for MVP).

## Functional Requirements
- Source form accepts HTTP/HTTPS URLs only; reject other protocols with clear error messages.
- Deduplicate sources and keywords on save; highlight conflicts inline.
- Provide status indicators for last successful fetch per source once ingestion runs.
- Configuration changes emit SSE events for the dashboard to refresh.

## Non-Functional Requirements
- Changes must be stored atomically to avoid partial updates.
- UI should respond within 300 ms for add/remove actions (optimistic updates permitted).
- Client isolation: configurations must remain scoped to the authenticated client context.

## Dependencies & Assumptions
- Reuses existing auth/session management to identify client context.
- Persists to shared datastore modeled alongside briefs.
- Ingestion service consumes configuration instantly or on next scheduled run.

## Risks & Mitigations
- Invalid URLs slipping through → enforce server-side validation and scheduled health checks.
- Configuration thrash causing ingestion instability → queue changes and apply with idempotent updates.

## Definition of Done
- Operators can manage sources/keywords end to end with validation and persistence.
- Configuration updates reflected in ingestion runs and telemetry.
- Documentation updated in runbook for onboarding pilot clients.
