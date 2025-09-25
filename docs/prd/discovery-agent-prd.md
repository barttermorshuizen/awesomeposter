# Discovery Agent Program Overview

This overview links the six epics that comprise the Discovery Agent MVP. Each epic has its own PRD describing scope and requirements in detail.

## Epic Directory
1. [Client Source Configuration](epic-discovery-client-source-config.md)
2. [Ingestion & Normalization](epic-discovery-ingestion-normalization.md)
3. [Scoring & Deduplication](epic-discovery-scoring-dedup.md)
4. [Brief Management Dashboard](epic-discovery-brief-dashboard.md)
5. [Telemetry & Reporting](epic-discovery-telemetry-reporting.md)
6. [Feature Flag & Pilot Enablement](epic-discovery-feature-flag-pilot.md)

## Program Goals
- Surface high-signal news nuggets for B2B tech marketing teams with ≥95% accuracy.
- Provide daily workflows for reviewers to promote `Spotted` briefs to `Approved` for downstream strategist/content writer agents.
- Maintain operational control via telemetry, feature flags, and pilot gating while we tune accuracy.

## Key Assumptions
- Review cadence is offline (daily/twice daily); notifications are future scope.
- All sources are client-configured HTTP web feeds; no default fintech bundle.
- English-only content handling at launch; compliance handled manually.

Refer to each epic PRD for detailed scope, requirements, and risks.
