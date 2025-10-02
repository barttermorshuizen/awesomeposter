# Decisions & Follow-ups
1. Telemetry widgets will ship with numeric counts only for MVP (no charts needed).
2. Server and client will use `page` + `pageSize` pagination; no cursor support required for MVP.
3. Track a story to specify the audit logging contract for bulk actions (fields, retention, UI surfacing) so API + UI can implement consistently.
