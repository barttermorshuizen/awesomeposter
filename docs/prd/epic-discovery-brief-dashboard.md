# Epic: Brief Management Dashboard

## Epic Goal
Provide reviewers with a focused workspace to inspect `Spotted` briefs, filter and search nuggets, capture notes, and promote items to `Approved` for downstream agents.

## Problem Statement
- Without a dedicated dashboard, reviewers must stitch together data from multiple tools, slowing response times.
- Daily review cadence demands a quick view into the most relevant nuggets and their histories.

## Objectives & Success Metrics
- Reduce reviewer time-to-decision for each nugget to under 2 minutes on average.
- Ensure 100% of status changes capture a note and actor attribution.
- Track adoption: at least 80% of pilot reviewers actively use the dashboard each week.

## Scope (In)
- Brief listing with filters (source, topic, date range, status) and keyword search.
- Detail view displaying metadata, scoring rationale, duplicate links, and notes.
- Status transitions from `Spotted` to `Approved`, including required note input.
- Bulk actions (promote, archive) with undo window.
- Inline status history visible per brief.

## Scope (Out)
- Integration with external workflow or publishing tools.
- Role-based access controls; all authenticated users share the same capabilities for MVP.
- Advanced analytics or visualization within the dashboard.

## Functional Requirements
- Filters must be combinable and shareable via URL parameters.
- Pagination or infinite scroll to manage large result sets.
- Status change UI enforces note entry and triggers SSE updates.
- Notes support plain text (ASCII) with timestamp and user attribution.

## Non-Functional Requirements
- Page loads should render first meaningful content within 1 second on broadband connections.
- Dashboard must gracefully handle SSE disconnects and auto-reconnect.
- Accessibility: follow existing UI standards (keyboard navigation, contrast ratios).

## Dependencies & Assumptions
- Relies on scored briefs from scoring/deduplication epic.
- Uses existing frontend stack (Vue 3 + Vite + Vuetify) and auth sessions.
- Status updates persisted in database shared with other agents.

## Risks & Mitigations
- Information overload on list view → provide sensible default filters (recent `Spotted`, high score).
- Promotion errors due to conflicting edits → implement optimistic updates with server confirmation and conflict messaging.

## Definition of Done
- Reviewers can discover, inspect, and act on briefs fully within the dashboard.
- Status history and notes are persisted and visible for every brief.
- Usability validated via pilot feedback sessions; issues triaged for follow-up.
