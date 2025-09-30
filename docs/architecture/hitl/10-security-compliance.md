# 10. Security & Compliance
- Restrict Nitro HITL routes to internal operators via API bearer auth (`requireApiAuth`).
- Validate operator identity in payload and persist to `runnerMetadata.auditLog` for traceability.
- Store freeform responses in `hitl_responses.freeform_text`; ensure PII is handled per policy (mask in logs).
- UI should prevent accidental disclosure by only exposing HITL panel to authenticated internal users (same gating as create-post popup).
