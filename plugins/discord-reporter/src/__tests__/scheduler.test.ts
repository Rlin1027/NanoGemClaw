/**
 * Tests for discord-reporter/scheduler.ts
 * ~28 tests covering sendToDiscord, tick, debounced
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock fs so loadConfig/saveConfig don't touch disk
// ---------------------------------------------------------------------------

const mockFsReadFileSync = vi.hoisted(() =>
  vi.fn().mockImplementation(() => { throw new Error('ENOENT'); }),
);
const mockFsWriteFileSync = vi.hoisted(() => vi.fn());
const mockFsMkdirSync = vi.hoisted(() => vi.fn());
const mockFsExistsSync = vi.hoisted(() => vi.fn().mockReturnValue(false));
const mockFsUnlinkSync = vi.hoisted(() => vi.fn());

vi.mock('fs', () => {
  const mod = {
    readFileSync: mockFsReadFileSync,
    writeFileSync: mockFsWriteFileSync,
    mkdirSync: mockFsMkdirSync,
    existsSync: mockFsExistsSync,
    unlinkSync: mockFsUnlinkSync,
  };
  return { default: mod, ...mod };
});

import {
  sendToDiscord,
  debounced,
  startScheduler,
  stopScheduler,
  heartbeat,
  triggerReport,
  getSchedulerConfig,
  updateSchedulerConfig,
  loadConfig,
  saveConfig,
} from '../scheduler.js';
import { createMockPluginApi } from '../../../__tests__/helpers/plugin-api-mock.js';
import type { DiscordPayload } from '../embed-formatter.js';

// ============================================================================
// Shared fixture
// ============================================================================

const VALID_WEBHOOK = 'https://discord.com/api/webhooks/123456/abcdef';
const PAYLOAD: DiscordPayload = { embeds: [{ title: 'Test', color: 0, fields: [] }] };

function mockFetchOk(status = 200): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: vi.fn().mockResolvedValue(''),
  });
}

// ============================================================================
// sendToDiscord — URL validation
// ============================================================================

describe('sendToDiscord — URL validation', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetchOk());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts a valid https://discord.com/api/webhooks/... URL', async () => {
    await expect(sendToDiscord(VALID_WEBHOOK, PAYLOAD)).resolves.toBeUndefined();
  });

  it('accepts discordapp.com webhook URLs', async () => {
    const url = 'https://discordapp.com/api/webhooks/123/abc';
    await expect(sendToDiscord(url, PAYLOAD)).resolves.toBeUndefined();
  });

  it('accepts canary.discord.com webhook URLs', async () => {
    const url = 'https://canary.discord.com/api/webhooks/123/abc';
    await expect(sendToDiscord(url, PAYLOAD)).resolves.toBeUndefined();
  });

  it('rejects http:// URLs (non-HTTPS)', async () => {
    const url = 'http://discord.com/api/webhooks/123/abc';
    await expect(sendToDiscord(url, PAYLOAD)).rejects.toThrow('Invalid Discord webhook URL');
  });

  it('rejects non-Discord hostnames', async () => {
    const url = 'https://evil.com/api/webhooks/123/abc';
    await expect(sendToDiscord(url, PAYLOAD)).rejects.toThrow('Invalid Discord webhook URL');
  });

  it('rejects URLs with wrong path prefix', async () => {
    const url = 'https://discord.com/not-api/webhooks/123/abc';
    await expect(sendToDiscord(url, PAYLOAD)).rejects.toThrow('Invalid Discord webhook URL');
  });

  it('rejects malformed URLs', async () => {
    await expect(sendToDiscord('not-a-url', PAYLOAD)).rejects.toThrow('Invalid Discord webhook URL');
  });

  it('rejects empty string URL', async () => {
    await expect(sendToDiscord('', PAYLOAD)).rejects.toThrow('Invalid Discord webhook URL');
  });
});

// ============================================================================
// sendToDiscord — HTTP errors
// ============================================================================

describe('sendToDiscord — HTTP errors', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws on non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: vi.fn().mockResolvedValue('Too Many Requests'),
    }));
    await expect(sendToDiscord(VALID_WEBHOOK, PAYLOAD)).rejects.toThrow('429');
  });

  it('throws on 500 server error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('Internal Server Error'),
    }));
    await expect(sendToDiscord(VALID_WEBHOOK, PAYLOAD)).rejects.toThrow('500');
  });

  it('does not throw on 200 OK', async () => {
    vi.stubGlobal('fetch', mockFetchOk(200));
    await expect(sendToDiscord(VALID_WEBHOOK, PAYLOAD)).resolves.toBeUndefined();
  });

  it('does not throw on 204 No Content', async () => {
    vi.stubGlobal('fetch', mockFetchOk(204));
    await expect(sendToDiscord(VALID_WEBHOOK, PAYLOAD)).resolves.toBeUndefined();
  });
});

// ============================================================================
// sendToDiscord — rate limiting (30/min sliding window)
// ============================================================================

describe('sendToDiscord — rate limiting', () => {
  // Each test uses a different century so prior test timestamps are always
  // outside the 60-second sliding window.
  const BASE = [
    new Date('2097-01-01T00:00:00.000Z').getTime(),
    new Date('2098-01-01T00:00:00.000Z').getTime(),
    new Date('2099-01-01T00:00:00.000Z').getTime(),
  ];
  let baseIdx = 0;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE[baseIdx++]);
    vi.stubGlobal('fetch', mockFetchOk());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('allows up to 30 sends in one minute window', async () => {
    for (let i = 0; i < 30; i++) {
      await expect(sendToDiscord(VALID_WEBHOOK, PAYLOAD)).resolves.toBeUndefined();
    }
  });

  it('throws on the 31st send within 60 seconds', async () => {
    for (let i = 0; i < 30; i++) {
      await sendToDiscord(VALID_WEBHOOK, PAYLOAD);
    }
    await expect(sendToDiscord(VALID_WEBHOOK, PAYLOAD)).rejects.toThrow('rate limit');
  });

  it('allows sending again after the 60-second window elapses', async () => {
    // Fill the bucket
    for (let i = 0; i < 30; i++) {
      await sendToDiscord(VALID_WEBHOOK, PAYLOAD);
    }
    // Advance past the 60-second window
    vi.advanceTimersByTime(61_000);
    await expect(sendToDiscord(VALID_WEBHOOK, PAYLOAD)).resolves.toBeUndefined();
  });
});

// ============================================================================
// debounced
// ============================================================================

describe('debounced', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls the function after 500ms', async () => {
    const fn = vi.fn();
    debounced('key1', fn);
    expect(fn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('resets the timer on repeated calls within 500ms', async () => {
    const fn = vi.fn();
    debounced('key1', fn);
    await vi.advanceTimersByTimeAsync(300);
    debounced('key1', fn);
    await vi.advanceTimersByTimeAsync(300);
    // Still not fired — timer reset to 500ms from second call
    expect(fn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('treats different keys as independent timers', async () => {
    const fnA = vi.fn();
    const fnB = vi.fn();
    debounced('keyA', fnA);
    debounced('keyB', fnB);
    await vi.advanceTimersByTimeAsync(500);
    expect(fnA).toHaveBeenCalledTimes(1);
    expect(fnB).toHaveBeenCalledTimes(1);
  });

  it('calling with same key twice only fires once after the debounce delay', async () => {
    const fn = vi.fn();
    debounced('key1', fn);
    debounced('key1', fn);
    await vi.advanceTimersByTimeAsync(600);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// tick — scheduler timing (daily and weekly triggers)
// ============================================================================

describe('startScheduler / tick — daily trigger', () => {
  // Enabled config JSON with dailyTime matching the fake-timer test clock
  const ENABLED_CONFIG = JSON.stringify({
    webhookUrl: VALID_WEBHOOK,
    dailyTime: '09:00',
    weeklyDay: 1,
    weeklyTime: '09:00',
    enabled: true,
  });

  beforeEach(() => {
    // Make loadConfig() return an enabled config by providing it via the hoisted mock
    mockFsReadFileSync.mockReturnValue(ENABLED_CONFIG);
    vi.useFakeTimers();
    vi.stubGlobal('fetch', mockFetchOk());
  });

  afterEach(() => {
    stopScheduler();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    mockFsReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
  });

  it('fires the daily report at the configured HH:MM', async () => {
    // Build a local-time Date one minute before the configured dailyTime "09:00".
    // Using local-time string avoids timezone offset issues with getHours().
    const oneBefore = new Date('2026-02-28T08:59:00');  // local time 08:59
    vi.setSystemTime(oneBefore);

    const api = createMockPluginApi();
    const dailyReport = {
      generated_at: new Date().toISOString(),
      period: { start: '2026-02-27T00:00:00Z', end: '2026-02-27T23:59:59Z' },
      usage: { total_requests: 0, avg_duration_ms: 0, total_tokens: 0 },
      errors: { groups_with_errors: 0, total_failures: 0 },
      top_groups: [],
    };
    const generateDailyReport = vi.fn().mockReturnValue(dailyReport);

    startScheduler(api, '/tmp', generateDailyReport, undefined);

    // Advance 1 minute — tick fires at local 09:00 (matches dailyTime "09:00")
    await vi.advanceTimersByTimeAsync(60_000);

    expect(generateDailyReport).toHaveBeenCalled();
  });

  it('does not fire the daily report twice for the same date', async () => {
    vi.setSystemTime(new Date('2026-02-28T08:59:00'));  // local 08:59

    const api = createMockPluginApi();
    const dailyReport = {
      generated_at: new Date().toISOString(),
      period: { start: '2026-02-27T00:00:00Z', end: '2026-02-27T23:59:59Z' },
      usage: { total_requests: 0, avg_duration_ms: 0, total_tokens: 0 },
      errors: { groups_with_errors: 0, total_failures: 0 },
      top_groups: [],
    };
    const generateDailyReport = vi.fn().mockReturnValue(dailyReport);

    startScheduler(api, '/tmp', generateDailyReport, undefined);

    // Tick into local 09:00
    await vi.advanceTimersByTimeAsync(60_000);
    const firstCallCount = generateDailyReport.mock.calls.length;

    // Tick one more minute at 09:01 — should NOT fire again
    await vi.advanceTimersByTimeAsync(60_000);
    expect(generateDailyReport.mock.calls.length).toBe(firstCallCount);
  });
});

describe('startScheduler — scheduler does not trigger when disabled', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', mockFetchOk());
  });

  afterEach(() => {
    stopScheduler();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('does not send when config.enabled is false (default from missing config file)', async () => {
    vi.setSystemTime(new Date('2026-02-28T08:59:00.000Z'));
    const api = createMockPluginApi();
    const generateDailyReport = vi.fn().mockReturnValue({
      generated_at: new Date().toISOString(),
      period: { start: '2026-02-27T00:00:00Z', end: '2026-02-27T23:59:59Z' },
      usage: { total_requests: 0, avg_duration_ms: 0, total_tokens: 0 },
      errors: { groups_with_errors: 0, total_failures: 0 },
      top_groups: [],
    });

    // loadConfig will throw (fs mock), so config.enabled defaults to false
    startScheduler(api, '/tmp', generateDailyReport);

    await vi.advanceTimersByTimeAsync(60_000);

    // enabled=false means the tick is a no-op
    expect(generateDailyReport).not.toHaveBeenCalled();
  });
});

// ============================================================================
// 3a. Weekly trigger
// ============================================================================

describe('startScheduler / tick — weekly trigger', () => {
  // Monday 2026-03-02 at 08:59 local time — weeklyDay=1 (Monday), weeklyTime="09:00"
  const ENABLED_CONFIG = JSON.stringify({
    webhookUrl: VALID_WEBHOOK,
    dailyTime: '08:00',   // different from test clock so daily does NOT fire
    weeklyDay: 1,
    weeklyTime: '09:00',
    enabled: true,
  });

  function makeWeeklyReport() {
    const now = new Date();
    return {
      period: { start: new Date(now.getTime() - 7 * 86_400_000).toISOString(), end: now.toISOString() },
      totalRequests: 100,
      totalTokens: 5000,
      avgDailyRequests: 14,
      peakDay: 'Monday',
      peakDayRequests: 30,
      errorRate: 0,
      topGroups: [],
    };
  }

  beforeEach(() => {
    mockFsReadFileSync.mockReturnValue(ENABLED_CONFIG);
    vi.useFakeTimers();
    vi.stubGlobal('fetch', mockFetchOk());
  });

  afterEach(() => {
    stopScheduler();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    mockFsReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
  });

  it('fires the weekly report on the configured weekday at HH:MM', async () => {
    // 2026-03-02 is a Monday. Set clock to 08:59 local time.
    vi.setSystemTime(new Date('2026-03-02T08:59:00'));

    const api = createMockPluginApi();
    const generateDailyReport = vi.fn().mockReturnValue({
      generated_at: new Date().toISOString(),
      period: { start: '2026-03-01T00:00:00Z', end: '2026-03-01T23:59:59Z' },
      usage: { total_requests: 0, avg_duration_ms: 0, total_tokens: 0 },
      errors: { groups_with_errors: 0, total_failures: 0 },
      top_groups: [],
    });
    const generateWeeklyData = vi.fn().mockReturnValue(makeWeeklyReport());

    startScheduler(api, '/tmp', generateDailyReport, generateWeeklyData);

    // Advance 60s so tick fires at 09:00 Monday
    await vi.advanceTimersByTimeAsync(60_000);

    expect(generateWeeklyData).toHaveBeenCalled();
  });

  it('does not fire the weekly report twice for the same week', async () => {
    vi.setSystemTime(new Date('2026-03-02T08:59:00'));

    const api = createMockPluginApi();
    const generateDailyReport = vi.fn().mockReturnValue({
      generated_at: new Date().toISOString(),
      period: { start: '2026-03-01T00:00:00Z', end: '2026-03-01T23:59:59Z' },
      usage: { total_requests: 0, avg_duration_ms: 0, total_tokens: 0 },
      errors: { groups_with_errors: 0, total_failures: 0 },
      top_groups: [],
    });
    const generateWeeklyData = vi.fn().mockReturnValue(makeWeeklyReport());

    startScheduler(api, '/tmp', generateDailyReport, generateWeeklyData);

    // First tick at 09:00
    await vi.advanceTimersByTimeAsync(60_000);
    const firstCount = generateWeeklyData.mock.calls.length;

    // Second tick at 09:01 — same week, should NOT fire again
    await vi.advanceTimersByTimeAsync(60_000);
    expect(generateWeeklyData.mock.calls.length).toBe(firstCount);
  });
});

// ============================================================================
// 3b. heartbeat
// ============================================================================

describe('heartbeat', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns true when fetch returns ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const result = await heartbeat(VALID_WEBHOOK);
    expect(result).toBe(true);
  });

  it('returns false when fetch returns not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const result = await heartbeat(VALID_WEBHOOK);
    expect(result).toBe(false);
  });

  it('returns false for an invalid URL without calling fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await heartbeat('not-a-valid-url');
    expect(result).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ============================================================================
// 3c. triggerReport
// ============================================================================

describe('triggerReport', () => {
  const DAILY_REPORT = {
    generated_at: new Date().toISOString(),
    period: { start: '2026-03-01T00:00:00Z', end: '2026-03-01T23:59:59Z' },
    usage: { total_requests: 42, avg_duration_ms: 300, total_tokens: 2000 },
    errors: { groups_with_errors: 0, total_failures: 0 },
    top_groups: [],
  };

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetchOk());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('triggerReport("daily") calls sendToDiscord via fetch', async () => {
    const api = createMockPluginApi();
    const generateDailyReport = vi.fn().mockReturnValue(DAILY_REPORT);

    await triggerReport('daily', VALID_WEBHOOK, api, generateDailyReport);

    expect(generateDailyReport).toHaveBeenCalled();
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledWith(
      VALID_WEBHOOK,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('triggerReport("weekly") calls sendToDiscord with weekly embed via fetch', async () => {
    const api = createMockPluginApi();
    const generateDailyReport = vi.fn().mockReturnValue(DAILY_REPORT);

    await triggerReport('weekly', VALID_WEBHOOK, api, generateDailyReport);

    // generateDailyReport should NOT be called for weekly
    expect(generateDailyReport).not.toHaveBeenCalled();
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledWith(
      VALID_WEBHOOK,
      expect.objectContaining({ method: 'POST' }),
    );
    // Verify the body is a weekly embed (has "Weekly Report" in title)
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.embeds[0].title).toContain('Weekly');
  });
});

// ============================================================================
// 3d. Config accessors
// ============================================================================

describe('getSchedulerConfig / updateSchedulerConfig', () => {
  afterEach(() => {
    stopScheduler();
    mockFsReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
  });

  it('getSchedulerConfig returns null before startScheduler is called', () => {
    // Ensure no running scheduler
    stopScheduler();
    expect(getSchedulerConfig()).toBeNull();
  });

  it('getSchedulerConfig returns a copy of config after startScheduler', () => {
    const ENABLED_CONFIG = JSON.stringify({
      webhookUrl: VALID_WEBHOOK,
      dailyTime: '09:00',
      weeklyDay: 1,
      weeklyTime: '09:00',
      enabled: true,
    });
    mockFsReadFileSync.mockReturnValue(ENABLED_CONFIG);
    vi.useFakeTimers();

    const api = createMockPluginApi();
    const generateDailyReport = vi.fn();
    startScheduler(api, '/tmp', generateDailyReport);

    const cfg = getSchedulerConfig();
    expect(cfg).not.toBeNull();
    expect(cfg!.enabled).toBe(true);
    expect(cfg!.webhookUrl).toBe(VALID_WEBHOOK);

    vi.useRealTimers();
  });

  it('updateSchedulerConfig merges updates and calls saveConfig (fs write)', () => {
    mockFsReadFileSync.mockReturnValue(JSON.stringify({
      webhookUrl: VALID_WEBHOOK,
      dailyTime: '09:00',
      weeklyDay: 1,
      weeklyTime: '09:00',
      enabled: false,
    }));

    const updated = updateSchedulerConfig('/tmp', { enabled: true, dailyTime: '10:00' });

    expect(updated.enabled).toBe(true);
    expect(updated.dailyTime).toBe('10:00');
    expect(updated.webhookUrl).toBe(VALID_WEBHOOK);
    // saveConfig should have called mkdirSync + writeFileSync
    expect(mockFsMkdirSync).toHaveBeenCalled();
    expect(mockFsWriteFileSync).toHaveBeenCalled();
  });
});

// ============================================================================
// 3e. loadConfig / saveConfig direct tests
// ============================================================================

describe('loadConfig / saveConfig', () => {
  beforeEach(() => {
    mockFsReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFsWriteFileSync.mockReset();
    mockFsMkdirSync.mockReset();
  });

  it('loadConfig returns parsed config when file contains valid JSON', () => {
    const stored = {
      webhookUrl: VALID_WEBHOOK,
      dailyTime: '08:30',
      weeklyDay: 5,
      weeklyTime: '10:00',
      enabled: true,
    };
    mockFsReadFileSync.mockReturnValue(JSON.stringify(stored));

    const cfg = loadConfig('/some/data/dir');
    expect(cfg.webhookUrl).toBe(VALID_WEBHOOK);
    expect(cfg.dailyTime).toBe('08:30');
    expect(cfg.weeklyDay).toBe(5);
    expect(cfg.enabled).toBe(true);
  });

  it('saveConfig creates the directory and writes JSON to disk', () => {
    const cfg = {
      webhookUrl: VALID_WEBHOOK,
      dailyTime: '09:00',
      weeklyDay: 1,
      weeklyTime: '09:00',
      enabled: true,
    };

    saveConfig('/some/data/dir', cfg);

    expect(mockFsMkdirSync).toHaveBeenCalledWith('/some/data/dir', { recursive: true });
    expect(mockFsWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('discord-config.json'),
      expect.stringContaining('"enabled": true'),
      'utf-8',
    );
  });
});
