import type { AgentRunRequest, AgentEvent } from '@awesomeposter/shared';
import { AgentRuntime } from './agent-runtime';
import { getRuntime } from './agents-container';

export class OrchestratorAgent {
  constructor(private runtime: AgentRuntime) {}

  async run(
    req: AgentRunRequest,
    onEvent: (e: AgentEvent) => void,
    correlationId?: string
  ): Promise<{ final: any; metrics?: any }> {
    throw new Error('Legacy orchestrator removed; use FlexRunCoordinator instead.');
  }
}

export function getOrchestrator() {
  const runtime = getRuntime();
  return new OrchestratorAgent(runtime);
}
