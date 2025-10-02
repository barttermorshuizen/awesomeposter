# Functional Requirements
- Calculate normalized relevance score (0–1) for every ingested item, combining relevance, traction, and source-type weighting.
- Aggregate traction signals from indirect sources (RSS activity, YouTube metrics, duplicate counts, external mentions) with configurable weights and fallbacks.
- Flag duplicates and select a canonical record; link suppressed duplicates for traceability and expose duplicate frequency to scoring.
- Emit SSE events for scoring decisions and duplicate suppression, including component breakdown for telemetry.
- Provide admin endpoints or config files to tweak weights, traction sources, and thresholds.
