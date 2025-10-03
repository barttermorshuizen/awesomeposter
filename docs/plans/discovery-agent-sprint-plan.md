# Discovery Agent Sprint Plan

## Sprint 1 Focus (2 Weeks)

### Objectives
- Ship client-controlled source configuration behind the discovery feature flag for a single pilot cohort.
- Deliver dependable flag enforcement and admin toggle paths so discovery stays dark for non-pilot clients.
- Produce pilot-facing readiness materials (runbook draft, training prep) and baseline QA coverage for the new flows.

### Planned Stories
- **Client Source Configuration**: 2.1 (HTTP source CRUD), 2.2 (keyword management)
- **Feature Flag & Pilot Enablement**: 7.1 (flag enforcement), 7.2 (admin toggle plumbing), 7.3 (pilot runbook draft)
- **Telemetry & Reporting**: 6.1 (SSE endpoint) — optional stretch only if source CRUD stabilises early

### Sequencing & Owners
1. Feature flag enforcement (7.1) + admin toggle groundwork (7.2) — Platform owner; partner with PM for rollout criteria.
2. Source configuration UI/API (2.1) — Frontend/API owner; include API contract review with backend.
3. Keyword management (2.2) — Frontend/API owner once CRUD baseline passes QA smoke.
4. QA + telemetry hardening — shared effort to execute Section “Quality & Readiness Work”.
5. Pilot runbook draft (7.3) — PM; incorporate findings from QA and flag testing.
6. Stretch: SSE endpoint (6.1) — Platform owner if bandwidth remains after QA sign-off.

### Capacity Assumptions
- ~4.5 engineer-weeks available (1 backend, 1 frontend, 1 platform at ~1.5 weeks each) plus PM support for documentation.
- Reserve ≥0.5 engineer-week for QA/regression tasks before committing to stretch work.

### Quality & Readiness Work
- Integration tests for `/api/discovery/sources` and `/api/discovery/keywords` flows (backend owner) — ensure regression coverage before flag enablement.
- UI smoke + Playwright script for source/keyword forms with optimistic updates (frontend owner).
- Seed pilot test data and verify rollback/disable path documented in `docs/prd/epic-discovery-feature-flag-pilot/pilot-onboarding-runbook.md` (platform + PM).
- Pilot training collateral outline + scheduling checklist (PM) aligned with runbook requirements.
- UAT sign-off session with QA/support capturing issues in the pilot backlog.

### Risks & Mitigations
- **Source CRUD slips**: defer optional 6.1 stretch, keep focus on 2.x + 7.x scope.
- **Flag regressions**: dedicate QA owner to run regression checklist; block pilot enablement until pass.
- **Pilot materials lag**: schedule midpoint review of runbook/training drafts with support to avoid last-minute scrambles.

## Sprint 2 Outlook
- Ingestion & Normalization (3.1–3.2) plus health status surfacing (2.3).
- Scoring & Dedup (4.1–4.3).
- Dashboard detail/promote + bulk actions (5.2, 5.3).
- Telemetry counts & retention (6.2, 6.3) + optional SSE stretch carryover.
- Finalise pilot onboarding with live training and feedback loop adjustments.
