# Epic: Scoring & Deduplication

## Epic Goal
Implement a scoring engine that evaluates normalized items for relevance, timeliness, and credibility while suppressing duplicates to meet the 95% accuracy mandate.

## Problem Statement
- Raw ingestion contains noise and repeats; without scoring, reviewers face overload and miss valuable nuggets.
- The business requires ≥95% accuracy in surfacing correctly scoped, timely, relevant briefs.

## Objectives & Success Metrics
- Deliver scored items with precision ≥95% based on reviewer validation.
- Reduce duplicate briefs by at least 90% compared to raw ingestion volume.
- Enable rapid threshold adjustments per client without redeployments.

## Scope (In)
- Scoring model incorporating keyword match, recency decay, and source weighting.
- Configurable thresholds per client; runtime adjustments through configuration service.
- Duplicate detection using URL hash, title similarity, and content fingerprinting.
- Metadata tagging (score, reasoning, duplicate status) persisted with each item.

## Scope (Out)
- Advanced ML models or NLP classification beyond rule-based heuristics for MVP.
- Automated feedback loops; reviewer input captured manually for now.

## Functional Requirements
- Calculate normalized relevance score (0–1) for every ingested item.
- Flag duplicates and select a canonical record; link suppressed duplicates for traceability.
- Emit SSE events for scoring decisions and duplicate suppression.
- Provide admin endpoints or config files to tweak weights and thresholds.

## Non-Functional Requirements
- Scoring should complete within 30 seconds of item ingestion under expected load.
- System must be observable: log scoring inputs, outputs, and decisions for auditing.
- High availability: scoring service recoverable without data loss after restarts.

## Dependencies & Assumptions
- Consumes normalized items from ingestion pipeline.
- Persists to shared brief datastore before dashboard consumption.
- Reviewers provide feedback separately to inform tuning.

## Risks & Mitigations
- Threshold drift reducing accuracy → schedule periodic calibration reviews and maintain sandbox for testing.
- Duplicate logic missing near-identical content → combine multiple similarity checks and allow manual override flags.

## Definition of Done
- Scored items populate the brief queue with metadata accessible in UI.
- Accuracy validated via pilot reviewer sampling achieving ≥95% precision.
- Documentation outlines tuning process and default weights per client segment.
