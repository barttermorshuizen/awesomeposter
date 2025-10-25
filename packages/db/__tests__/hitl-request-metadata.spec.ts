import { describe, it, expect } from 'vitest'
import { hitlRequests } from '../src/schema'

describe('hitl_requests schema metadata columns', () => {
  it('includes pending node, contract summary, and operator prompt fields', () => {
    expect(hitlRequests.pendingNodeId.name).toBe('pending_node_id')
    expect(hitlRequests.contractSummaryJson.name).toBe('contract_summary_json')
    expect(hitlRequests.operatorPrompt.name).toBe('operator_prompt')
  })
})
