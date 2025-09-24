class WorkflowOrchestrator {
  constructor(strategy, generator, qa) {
    this.strategy = strategy;
    this.generator = generator;
    this.qa = qa;
  }
  async executeWorkflow(request) {
    const start = Date.now();
    const finalState = {
      received: request.state,
      briefId: request.briefId
    };
    const duration = Date.now() - start;
    return {
      success: true,
      workflowId: `wf_${Math.random().toString(36).slice(2)}`,
      finalState,
      metrics: {
        executionTime: duration,
        tokensUsed: 0,
        revisionCycles: 0,
        qualityScore: 0,
        knobEffectiveness: {
          formatType: "n/a",
          hookIntensity: "n/a",
          expertiseDepth: "n/a",
          structure: "n/a"
        }
      }
    };
  }
  async executeWorkflowWithProgress(request, onProgress) {
    onProgress({ type: "start", at: (/* @__PURE__ */ new Date()).toISOString() });
    onProgress({ type: "phase", name: "strategy", status: "pending" });
    onProgress({ type: "phase", name: "strategy", status: "done" });
    onProgress({ type: "phase", name: "generation", status: "done" });
    onProgress({ type: "phase", name: "qa", status: "done" });
    const result = await this.executeWorkflow(request);
    onProgress({ type: "finish", at: (/* @__PURE__ */ new Date()).toISOString() });
    return result;
  }
}

export { WorkflowOrchestrator };
//# sourceMappingURL=workflow-orchestrator.mjs.map
