# Discovery Agent Sprint Plan

## Sprint 1 Focus (2 Weeks)

### Objectives
- Enable pilot clients to configure sources while ensuring discovery remains disabled elsewhere.
- Stand up ingestion + normalization so we can start tuning accuracy in Sprint 2.
- Prepare groundwork for dashboard and telemetry without blocking on downstream dependencies.

### Planned Stories
- **Client Source Configuration**: 2.1, 2.2, 2.3
- **Feature Flag & Pilot Enablement**: 7.1 (enforcement), 7.2 (admin toggle), 7.3 (pilot runbook draft)
- **Ingestion & Normalization**: 3.1 (scheduled fetch), 3.2 (normalization pipeline)
- **Telemetry & Reporting**: 6.1 (SSE endpoint)
- **Brief Management Dashboard**: 5.1 (listing with filters) — start once mock data available

### Sequencing & Owners
1. Feature flag enforcement (7.1) + admin toggle groundwork (7.2) — Platform owner.
2. Source configuration UI/API (2.1), keyword management (2.2) — Frontend/API owner; health status (2.3) follows after telemetry hooks.
3. Ingestion scheduling (3.1) and normalization (3.2) — Backend owner; coordinate with SSE implementation.
4. SSE endpoint (6.1) — Platform owner after ingestion events exist.
5. Dashboard listing (5.1) — Frontend owner with mock data until scoring available.
6. Runbook draft (7.3) — PM by end of sprint.

### Capacity Assumptions
- ~5 engineer-weeks available (2 backend, 2 frontend, 1 platform/support).
- Stories sized to fit with small buffer for unexpected tuning.

### Risks & Mitigations
- **Ingestion delays**: adjust scope of 3.2 to deliver minimal schema first.
- **SSE complexity**: fall back to polling for Sprint 1 if needed, complete SSE early Sprint 2.
- **Cross-team coordination**: schedule mid-sprint sync to align scoring inputs for Sprint 2.

## Sprint 2 Outlook
- Scoring & Dedup (4.1–4.3).
- Dashboard detail/promote + bulk actions (5.2, 5.3).
- Telemetry counts & retention (6.2, 6.3).
- Finalize pilot runbook and onboarding.

