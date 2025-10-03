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

## Sprint 2 Plan (2 Weeks)

### Objectives
- Complete ingestion scheduling/normalization (3.1, 3.2) and expose client health status (2.3).
- Ship scoring relevance/dedup tuning (4.1–4.3) to support Discovery quality goals.
- Deliver dashboard promote/bulk actions UX (5.2, 5.3) with end-to-end coverage.
- Land telemetry counts/retention improvements (6.2, 6.3) and harden pilot enablement collateral.

### Sequencing & Owners
1. Platform kicks off 3.1 ingestion scheduling, handing schema outputs to backend for 3.2 normalization completion.
2. Backend/front-end pair on 2.3 health status UI once ingestion APIs are stable.
3. Data science + platform collaborate on 4.1 relevance modelling, transition to 4.2 duplicate suppression, then 4.3 threshold tuning.
4. Front-end leads 5.2 dashboard detail/promote and 5.3 bulk actions with backend API support.
5. Telemetry squad (platform + front-end) implements 6.2 counts UI before backend finalises 6.3 retention/backfill scripts.
6. PM wraps pilot training/runbook updates leveraging new telemetry outputs and scoring metrics.

### Capacity & Assumptions
- Same ~4.5 engineer-weeks (backend, frontend, platform at ~1.5 each) plus 1.0 data-science week dedicated to scoring work and 0.5 PM week for enablement collateral.
- Reserve ≥0.5 engineer-week for regression/QA burn-down, especially around scoring and telemetry changes.

### Quality & Readiness Work
- Expand Playwright suite to cover ingestion → dashboard promote/bulk flow.
- Add contract tests for scoring APIs and schema normalization invariants.
- Run feature-flag regression checklist after telemetry retention deploy.
- Stage telemetry backfill scripts with rollback validation for 6.3.
- Capture scoring KPIs and ingestion health dashboards in the QA runbook ahead of pilot check-ins.

### Risks & Mitigations
- `3.x` ingestion delay blocks 2.3 health status; mitigate via mid-sprint checkpoint on normalization deliverables.
- Scoring model drift could stall QA sign-off; schedule DS/platform pairing sessions and baseline metric dashboards early.
- Telemetry retention touches production data; run shadow migrations and verify rollback steps.
- Bulk actions depend on 5.1 listing stability; hold go/no-go review before front-end commits to promote/bulk scope.
- Pilot feedback loop must stay active; maintain weekly sync to triage discoveries and adjust backlog.

## Sprint 3 Outlook
- Focus on resilience/observability to prep GA: restart/recovery controls (1.4), brief-action HITL refinements (1.5), telemetry throttling (6.4), dashboard audit log (5.4), ingestion retry health (3.3), scoring traction signal (4.4).
- Sequence resilience first (1.4/1.5) before telemetry throttling and audit log, then close with traction signal experiments and ingestion retry improvements.
- Dependencies: Sprint 2 scoring outputs feed 4.4; telemetry retention learnings set throttling limits; dashboard bulk/promote stability required before audit log.
- Risks: throttling may impact pilot traffic—plan shadow mode rollout; retry health requires monitoring coverage—ensure observability tasks scoped; coordinate GA gate reviews with QA/PO for release readiness.
