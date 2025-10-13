// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { scheduleCapabilitySelfRegistration } from '../src/services/capability-registration'
import { STRATEGY_CAPABILITY } from '../src/agents/strategy-manager'
import * as loggerModule from '../src/services/logger'

const originalFetch = global.fetch

describe('scheduleCapabilitySelfRegistration', () => {
  beforeEach(() => {
    Object.assign(process.env, {
      NODE_ENV: 'development',
      FLEX_CAPABILITY_REGISTER_URL: 'http://flex.local/register',
      FLEX_CAPABILITY_SELF_REGISTER_RETRY_DELAY_MS: '10',
      FLEX_CAPABILITY_SELF_REGISTER_REFRESH_MS: '50',
      FLEX_CAPABILITY_SELF_REGISTER_INITIAL_DELAY_MS: '0'
    })
  })

  afterEach(() => {
    if (originalFetch) {
      global.fetch = originalFetch
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (global as any).fetch
    }
    delete process.env.FLEX_CAPABILITY_REGISTER_URL
    delete process.env.FLEX_CAPABILITY_SELF_REGISTER_RETRY_DELAY_MS
    delete process.env.FLEX_CAPABILITY_SELF_REGISTER_REFRESH_MS
    delete process.env.FLEX_CAPABILITY_SELF_REGISTER_INITIAL_DELAY_MS
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('posts capability metadata to the registration endpoint and schedules refresh', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, statusText: 'OK', text: () => Promise.resolve(''), json: () => Promise.resolve({}) })
    global.fetch = fetchMock as any

    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    vi.spyOn(loggerModule, 'getLogger').mockReturnValue(logger as any)

    scheduleCapabilitySelfRegistration(STRATEGY_CAPABILITY)

    // Execute the immediate attempt
    await vi.runOnlyPendingTimersAsync()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('http://flex.local/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(STRATEGY_CAPABILITY)
    })
    expect(logger.info).toHaveBeenCalledWith(
      'flex_capability_self_registered',
      expect.objectContaining({ capabilityId: STRATEGY_CAPABILITY.capabilityId, attempt: 1 })
    )

    // Fast-forward to the refresh interval and ensure the call repeats
    await vi.advanceTimersByTimeAsync(50)
    await vi.runOnlyPendingTimersAsync()
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('retries when the endpoint fails and eventually logs success', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'ERR', text: () => Promise.resolve('boom') })
      .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK', text: () => Promise.resolve(''), json: () => Promise.resolve({}) })
    global.fetch = fetchMock as any

    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    vi.spyOn(loggerModule, 'getLogger').mockReturnValue(logger as any)

    scheduleCapabilitySelfRegistration(STRATEGY_CAPABILITY)

    // First attempt (failure)
    await vi.runOnlyPendingTimersAsync()
    expect(logger.warn).toHaveBeenCalledWith(
      'flex_capability_self_register_failed',
      expect.objectContaining({ capabilityId: STRATEGY_CAPABILITY.capabilityId, attempt: 1 })
    )

    // Retry attempt
    await vi.runOnlyPendingTimersAsync()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(logger.info).toHaveBeenCalledWith(
      'flex_capability_self_registered',
      expect.objectContaining({ capabilityId: STRATEGY_CAPABILITY.capabilityId, attempt: 2 })
    )
  })
})
