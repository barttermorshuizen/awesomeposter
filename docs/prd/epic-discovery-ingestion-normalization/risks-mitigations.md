# Risks & Mitigations
- Source blocking or API quotas due to aggressive crawling → respect robots.txt, YouTube quota, and configurable rate limits with caching/backoff.
- HTML/feed schema changes breaking extraction → modular extractor with graceful degradation and alerts.
