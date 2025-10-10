import type { AgentRunRequest, AgentEvent } from '@awesomeposter/shared';
import { AgentRuntime } from './agent-runtime';
import { getAgents } from './agents-container';
import { runOrchestratorEngine } from './orchestrator-engine';

export class OrchestratorAgent {
  constructor(private runtime: AgentRuntime) {}

  async run(
    req: AgentRunRequest,
    onEvent: (e: AgentEvent) => void,
    correlationId?: string
  ): Promise<{ final: any; metrics?: any }> {
    return runOrchestratorEngine(this.runtime, req, onEvent, correlationId);
  }
}

export function getOrchestrator() {
  const { runtime } = getAgents();
  return new OrchestratorAgent(runtime);
}
