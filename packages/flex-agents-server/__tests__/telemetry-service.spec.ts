// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import type { FlexTelemetryEvent } from '../src/services/telemetry-service'
import { getTelemetryService, __resetTelemetryServiceForTest } from '../src/services/telemetry-service'

const nowIso = () => new Date().toISOString()

describe('TelemetryService', () => {
  beforeEach(() => {
    __resetTelemetryServiceForTest()
  })

  it('enriches events with correlation, plan version, and facet provenance while updating metrics', async () => {
    const telemetry = getTelemetryService()
    const received: FlexTelemetryEvent[] = []
    const emit = telemetry.createRunEmitter(
      { runId: 'flex_demo', correlationId: 'cid-123' },
      async (event) => {
        received.push(event)
      }
    )

    await emit({
      type: 'plan_requested',
      timestamp: nowIso(),
      payload: { phase: 'initial', attempt: 1 }
    })
    await emit({
      type: 'plan_generated',
      timestamp: nowIso(),
      planVersion: 3,
      payload: { plan: { version: 3 } }
    })
    await emit({
      type: 'node_complete',
      timestamp: nowIso(),
      nodeId: 'node-1',
      payload: { capabilityId: 'writer', durationMs: 120 },
      facetProvenance: {
        output: [
          {
            facet: 'copyVariants',
            title: 'Copy Variants',
            direction: 'output',
            pointer: '#/copyVariants'
          }
        ]
      }
    })
    await emit({
      type: 'validation_error',
      timestamp: nowIso(),
      nodeId: 'node-1',
      payload: { scope: 'capability_output', errors: [] }
    })

    expect(received).toHaveLength(4)
    const nodeEvent = received.find((evt) => evt.type === 'node_complete')
    expect(nodeEvent?.planVersion).toBe(3)
    expect(nodeEvent?.correlationId).toBe('cid-123')
    expect(nodeEvent?.facetProvenance?.output?.[0]?.facet).toBe('copyVariants')

    const metrics = telemetry.getMetricsSnapshot()
    expect(metrics.counters['flex.planner.requests|phase=initial']).toBe(1)
    expect(metrics.counters['flex.planner.generated']).toBe(1)
    expect(metrics.counters['flex.validation.retries|scope=capability_output']).toBe(1)
    const histogramKey = 'flex.node.duration_ms|capabilityId=writer'
    expect(metrics.histograms[histogramKey]?.count).toBe(1)
    expect(metrics.histograms[histogramKey]?.sum).toBe(120)
  })

  it('streams lifecycle events to subscribers', async () => {
    const telemetry = getTelemetryService()
    const captured: FlexTelemetryEvent[] = []
    const emit = telemetry.createRunEmitter(
      { runId: 'flex_demo', correlationId: 'cid-456' },
      async () => {}
    )
    const unsubscribe = telemetry.subscribeToLifecycle((event) => {
      captured.push(event)
    })

    await emit({
      type: 'plan_requested',
      timestamp: nowIso(),
      payload: { phase: 'initial', attempt: 1 }
    })
    await emit({
      type: 'plan_rejected',
      timestamp: nowIso(),
      payload: { diagnostics: [] }
    })
    await emit({
      type: 'node_start',
      timestamp: nowIso(),
      payload: { capabilityId: 'writer', startedAt: nowIso() }
    })

    unsubscribe()

    expect(captured.map((evt) => evt.type)).toEqual(['plan_requested', 'plan_rejected'])
  })

  it('records goal condition metrics for complete events', async () => {
    const telemetry = getTelemetryService()
    const emit = telemetry.createRunEmitter(
      { runId: 'flex_goal_run', correlationId: 'cid-goal' },
      async () => {}
    )

    await emit({
      type: 'complete',
      timestamp: nowIso(),
      payload: {
        status: 'completed',
        goal_condition_results: [
          { facet: 'post_copy', path: '/', expression: 'status == "ready"', satisfied: true },
          { facet: 'post_visual', path: '/', expression: 'status == "approved"', satisfied: false },
          {
            facet: 'feedback',
            path: '/',
            expression: 'remaining == 0',
            satisfied: false,
            error: 'Path "/value" missing'
          }
        ]
      }
    })

    const metrics = telemetry.getMetricsSnapshot()
    expect(metrics.histograms['flex.goal_condition.total|status=completed']?.sum).toBe(3)
    expect(metrics.histograms['flex.goal_condition.satisfied|status=completed']?.sum).toBe(1)
    expect(metrics.histograms['flex.goal_condition.failed|status=completed']?.sum).toBe(1)
    expect(metrics.histograms['flex.goal_condition.errors|status=completed']?.sum).toBe(1)
  })
})
