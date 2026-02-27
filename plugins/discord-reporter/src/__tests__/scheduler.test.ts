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
