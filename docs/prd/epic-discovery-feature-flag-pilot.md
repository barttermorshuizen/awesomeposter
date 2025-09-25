# Epic: Feature Flag & Pilot Enablement

## Epic Goal
Control rollout of the discovery agent through feature flags and pilot onboarding so teams can test and tune accuracy with low risk.

## Problem Statement
- Launching to all clients before hitting accuracy targets risks trust and operational churn.
- We need a controlled mechanism to enable/disable the agent per client and documented steps for onboarding pilots.

## Objectives & Success Metrics
- Enable discovery agent for pilot clients via configuration without redeployments.
- Provide clear activation/deactivation pathways with audit trail.
- Deliver onboarding materials so pilot users can self-serve setup within one business day.

## Scope (In)
- Feature flagging at client level controlling backend ingestion, scoring, and dashboard visibility.
- Admin tooling or config scripts to toggle flags and verify status.
- Pilot runbook covering configuration steps, success metrics tracking, and feedback loops.
- Monitoring to ensure disabled clients incur zero ingestion workload.

## Scope (Out)
- Dynamic pricing or billing integrations tied to flags.
- Automated onboarding flows; manual support is acceptable for MVP.
- Long-term GA rollout playbooks (post-pilot).

## Functional Requirements
- Feature flag checked across backend services before processing client data.
- Dashboard/UI hides discovery features when flag disabled, with messaging for unsupported clients.
- Logging of flag changes (who, when, client) for traceability.
- Runbook stored in shared documentation with checklist for activation.

## Non-Functional Requirements
- Flag changes propagate within minutes across services (cache invalidation strategy defined).
- System must fail safe: if flag state unknown, default to disabled.
- Administrative interface requires authentication and respects least privilege.

## Dependencies & Assumptions
- Uses existing feature flag infrastructure or extends it minimally.
- Relies on telemetry epic for monitoring pilot performance.
- Onboarding runbook maintained by PM and support teams.

## Risks & Mitigations
- Flag drift between services → centralize flag evaluation or add consistency checks.
- Pilot confusion due to unclear steps → provide checklist and contact points in runbook.

## Definition of Done
- Discovery agent can be toggled per client with observable results across ingestion, scoring, and UI.
- Pilot clients onboarded using documented process; feedback loop established.
- Deactivation path verified to leave no residual workloads.
