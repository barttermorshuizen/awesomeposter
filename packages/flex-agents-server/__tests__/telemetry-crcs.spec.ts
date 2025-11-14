// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import { getTelemetryService, __resetTelemetryServiceForTest } from '../src/services/telemetry-service'

describe('TelemetryService CRCS metrics', () => {
  beforeEach(() => {
    __resetTelemetryServiceForTest()
  })

  it('records histogram samples for CRCS snapshots', () => {
    const telemetry = getTelemetryService()
    telemetry.recordPlannerCrcsStats({
      totalRows: 5,
      mrcsSize: 2,
      reasonCounts: {
        path: 2,
        policy_reference: 3
      },
      rowCap: 50,
      missingPinnedCapabilities: 1
    })

    const snapshot = telemetry.getMetricsSnapshot()
    expect(snapshot.histograms['flex.planner.crcs.rows|rowCap=50']?.sum).toBe(5)
    expect(snapshot.histograms['flex.planner.crcs.mrcs']?.sum).toBe(2)
    expect(snapshot.histograms['flex.planner.crcs.reason|reason=path']?.sum).toBe(2)
    expect(snapshot.histograms['flex.planner.crcs.reason|reason=policy_reference']?.sum).toBe(3)
    expect(snapshot.histograms['flex.planner.crcs.missing_pinned']?.sum).toBe(1)
  })
})
