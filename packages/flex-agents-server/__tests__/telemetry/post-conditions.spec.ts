// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getTelemetryService, __resetTelemetryServiceForTest } from '../../src/services/telemetry-service'

const warnMock = vi.fn()
const infoMock = vi.fn()

vi.mock('../../src/services/logger', () => ({
  getLogger: () => ({
    warn: warnMock,
    info: infoMock
  })
}))

describe('TelemetryService post-condition metrics', () => {
  beforeEach(() => {
    __resetTelemetryServiceForTest()
    warnMock.mockReset()
    infoMock.mockReset()
  })

  it('records counters for failed and errored post-condition results', () => {
    const telemetry = getTelemetryService()
    telemetry.process({
      type: 'node_complete',
      timestamp: new Date().toISOString(),
      runId: 'run-1',
      nodeId: 'node-1',
      payload: {
        capabilityId: 'cap-1',
        postConditionResults: [
          { facet: 'output', path: '/title', expression: 'title != ""', satisfied: false },
          { facet: 'output', path: '/score', expression: 'score >= 0', satisfied: true },
          { facet: 'output', path: '/error', expression: 'score > 0', satisfied: false, error: 'invalid' }
        ]
      }
    } as any)

    const snapshot = telemetry.getMetricsSnapshot()
    const failureKey =
      'flex.capability_condition_failed|capabilityId=cap-1|facet=output|nodeId=node-1|path=/title'
    const errorKey =
      'flex.capability_condition_error|capabilityId=cap-1|facet=output|nodeId=node-1|path=/error'

    expect(snapshot.counters[failureKey]).toBe(1)
    expect(snapshot.counters[errorKey]).toBe(1)
    expect(Object.keys(snapshot.counters)).toContain(failureKey)
    expect(Object.keys(snapshot.counters)).toContain(errorKey)
    expect(warnMock).toHaveBeenCalled()
  })

  it('records aggregated post_condition_results from completion frames', () => {
    const telemetry = getTelemetryService()
    telemetry.process({
      type: 'complete',
      timestamp: new Date().toISOString(),
      runId: 'run-agg',
      payload: {
        status: 'completed',
        post_condition_results: [
          {
            nodeId: 'node-x',
            capabilityId: 'cap-x',
            results: [
              { facet: 'output', path: '/value', expression: 'value != ""', satisfied: false }
            ]
          }
        ]
      }
    } as any)

    const snapshot = telemetry.getMetricsSnapshot()
    const failureKey =
      'flex.capability_condition_failed|capabilityId=cap-x|facet=output|nodeId=node-x|path=/value'
    expect(snapshot.counters[failureKey]).toBe(1)
  })

  it('attaches attempt metadata when available', () => {
    const telemetry = getTelemetryService()
    telemetry.process({
      type: 'policy_triggered',
      timestamp: new Date().toISOString(),
      runId: 'run-retry',
      payload: {
        action: 'retry',
        attempt: 2,
        maxRetries: 3,
        postConditionResults: [
          { facet: 'output', path: '/headline', expression: 'headline != ""', satisfied: false }
        ],
        capabilityId: 'cap-retry',
        nodeId: 'node-retry'
      }
    } as any)

    const snapshot = telemetry.getMetricsSnapshot()
    const failureKey =
      'flex.capability_condition_failed|attempt=2|capabilityId=cap-retry|facet=output|maxRetries=3|nodeId=node-retry|path=/headline'
    expect(snapshot.counters[failureKey]).toBe(1)
  })
})
