# Epic: Scoring & Deduplication

## Epic Goal
Implement a scoring engine that evaluates normalized items for relevance, traction, timeliness, and credibility while suppressing duplicates to meet the 95% accuracy mandate.

## Problem Statement
- Raw ingestion contains noise and repeats; without scoring, reviewers face overload and miss valuable nuggets.
- The business requires ≥95% accuracy in surfacing correctly scoped, timely, relevant discovery items that reviewers can confidently promote into briefs.

## Objectives & Success Metrics
- Deliver scored discovery items with precision ≥95% based on reviewer validation.
- Reduce duplicate discovery items by at least 90% compared to raw ingestion volume before promotion.
- Enable rapid threshold adjustments per client without redeployments.

## Scope (In)
- Scoring model incorporating keyword match, recency decay, source weighting, and configurable traction signals (RSS activity, YouTube metrics, social/news mentions, duplicate density).
- Configurable thresholds per client; runtime adjustments through configuration service.
- Duplicate detection using URL hash, title similarity, and content fingerprinting that feeds traction metrics.
- Metadata tagging (score, component breakdown, duplicate status) persisted with each item.

## Scope (Out)
- Advanced ML models or NLP classification beyond rule-based heuristics for MVP.
- Automated feedback loops; reviewer input captured manually for now.

## Functional Requirements
- Calculate normalized relevance score (0–1) for every ingested item, combining relevance, traction, and source-type weighting.
- Aggregate traction signals from indirect sources (RSS activity, YouTube metrics, duplicate counts, external mentions) with configurable weights and fallbacks.
- Flag duplicates and select a canonical record; link suppressed duplicates for traceability and expose duplicate frequency to scoring.
- Emit SSE events for scoring decisions and duplicate suppression, including component breakdown for telemetry.
- Provide admin endpoints or config files to tweak weights, traction sources, and thresholds.

## Non-Functional Requirements
- Scoring should complete within 30 seconds of item ingestion under expected load.
- System must be observable: log scoring inputs, outputs, and decisions for auditing.
- High availability: scoring service recoverable without data loss after restarts.

## Dependencies & Assumptions
- Consumes normalized items (with source-type metadata) from ingestion pipeline.
- Requires configuration service to expose source weights and traction toggles per client.
- Persists discovery items (including score metadata) to the shared datastore consumed by the review dashboard; briefs are only created once reviewers promote an item.
- Reviewers provide feedback separately to inform tuning.

## Risks & Mitigations
- Threshold drift reducing accuracy → schedule periodic calibration reviews and maintain sandbox for testing.
- Duplicate logic missing near-identical content → combine multiple similarity checks and allow manual override flags.
- External traction providers exceeding rate limits or failing → use configurable rate limiter, caching, and graceful fallback to relevance-only scoring.

## Definition of Done
- Scored items populate the discovery item review queue with metadata accessible in UI.
- Accuracy validated via pilot reviewer sampling achieving ≥95% precision.
- Documentation outlines tuning process and default weights per client segment.
