# Non-Functional Requirements
- Pipeline must handle at least 100 sources per client without major latency increases.
- Robustness against flaky sources via exponential backoff and capped retries.
- Logging at each stage to support debugging and accuracy audits.
