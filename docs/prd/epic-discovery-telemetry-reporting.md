# Epic: Telemetry & Reporting

## Epic Goal
Instrument the discovery agent with real-time event streaming and lightweight reporting so operators understand source activity and pipeline performance without a full analytics suite.

## Problem Statement
- Without telemetry, teams cannot judge accuracy or volume, undermining trust in the discovery agent.
- UI needs live feedback (SSE) to reflect ingestion and scoring events as they happen.

## Objectives & Success Metrics
- Provide daily/weekly counts for source hits, nuggets considered, and promotions directly in-app.
- Maintain SSE stream uptime ≥99% for connected sessions.
- Ensure telemetry data persists for future analytics backfills.

## Scope (In)
- SSE endpoint emitting events for ingestion start, item scored, duplicate suppressed, brief created, and status change.
- Lightweight reporting view or widgets summarizing key counts with date filters.
- Storage of telemetry events in a structured log for later analysis (no advanced dashboards yet).

## Scope (Out)
- External alerting/notifications (Slack, email).
- Advanced analytics (engagement rates, dashboards) beyond count summaries.
- Third-party BI integrations during MVP.

## Functional Requirements
- SSE payload includes event type, timestamp, client identifier, schema version, and relevant entity IDs.
- Reporting UI displays aggregates (daily/weekly totals) and allows export of raw counts as CSV.
- Telemetry pipeline handles retries and backpressure without data loss.

## Non-Functional Requirements
- SSE latency under 2 seconds from event generation to client receipt under normal load.
- Telemetry storage must scale to 180 days of events without manual intervention.
- Secure access: only authenticated sessions can subscribe to client-specific streams.

## Dependencies & Assumptions
- Relies on ingestion, scoring, and dashboard epics to generate events.
- Uses existing logging/metrics infrastructure or extends it minimally.
- Frontend supports EventSource connections and gracefully handles reconnects.

## Risks & Mitigations
- Event schema drift breaking clients → version payloads and provide compatibility layer.
- Excess telemetry volume → sample or aggregate as needed; monitor storage consumption.

## Definition of Done
- Operators can monitor event streams in the UI and view basic counts.
- SSE endpoints documented and covered by automated tests.
- Telemetry data available for support/analytics requests without additional engineering.
