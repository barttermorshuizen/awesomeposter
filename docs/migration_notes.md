# Migration Notes — Orchestrator MVP

- Final output is now a FinalBundle: result, quality, acceptance-report.
- Streaming adds plan_update; delta only during generation/qa; emits run_report before complete.
- Use threadId to resume runs; omit to start fresh.
- Orchestrator performs handoffs only; specialists own tool calls.
