# Decisions & Follow-ups
1. **Ingestion trigger scale**: stick with per-client scheduling for MVP; revisit per-source cron only if ingestion latency becomes an issue.
2. **External notifications**: no additional channels needed—SSE updates satisfy MVP requirements.
3. **Dedup retention**: keep full duplicate records but persist only source references (URLs). If table growth becomes problematic, plan a later task to prune or roll up counts.
