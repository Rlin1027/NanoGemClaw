import {
  vi,
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from 'vitest';

// Use vi.hoisted so TEST_STORE_DIR is available inside vi.mock factory
// Note: vi.hoisted runs before all imports, so we must use require() for node builtins
const { TEST_STORE_DIR } = vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  const _os = require('os') as typeof import('os');
  const _path = require('path') as typeof import('path');
  const TEST_STORE_DIR = _path.join(
    _os.tmpdir(),
    `nanogemclaw-test-${Date.now()}`,
  );
  return { TEST_STORE_DIR };
});

// Mock config to use temporary directory
vi.mock('../config.js', () => ({
  STORE_DIR: TEST_STORE_DIR,
}));

// Import db functions after mocking
import {
  initDatabase,
  closeDatabase,
  logUsage,
  getUsageStats,
  getRecentUsage,
  recordError,
  resetErrors,
  getErrorState,
  markAlertSent,
  getAllErrorStates,
  checkRateLimit,
  getRateLimitStatus,
  clearRateLimits,
} from '../db.js';
import { resetDatabase, cleanupTestDir } from './helpers/db-test-setup.js';

describe('db/stats', () => {
  beforeAll(() => {
    initDatabase();
  });

  afterAll(() => {
    closeDatabase();
    cleanupTestDir(TEST_STORE_DIR);
  });

  describe('Usage Statistics', () => {
    beforeEach(() => resetDatabase(TEST_STORE_DIR));

    it('should log usage entry', () => {
      logUsage({
        group_folder: 'group1',
        timestamp: '2026-02-08T10:00:00Z',
        prompt_tokens: 100,
        response_tokens: 200,
        duration_ms: 1500,
        model: 'gemini-2.0-flash-exp',
        is_scheduled_task: false,
      });

      const recent = getRecentUsage(1);
      expect(recent).toHaveLength(1);
      expect(recent[0].group_folder).toBe('group1');
      expect(recent[0].prompt_tokens).toBe(100);
    });

    it('should log usage without optional fields', () => {
      logUsage({
        group_folder: 'group2',
        timestamp: '2026-02-08T11:00:00Z',
        duration_ms: 1000,
      });

      const recent = getRecentUsage(1);
      expect(recent[0].group_folder).toBe('group2');
    });

    it('should get usage stats for all groups', () => {
      logUsage({
        group_folder: 'group1',
        timestamp: '2026-02-08T10:00:00Z',
        prompt_tokens: 100,
        response_tokens: 200,
        duration_ms: 1500,
      });

      logUsage({
        group_folder: 'group2',
        timestamp: '2026-02-08T11:00:00Z',
        prompt_tokens: 150,
        response_tokens: 250,
        duration_ms: 2000,
      });

      const stats = getUsageStats();
      expect(stats.total_requests).toBeGreaterThanOrEqual(2);
      expect(stats.total_prompt_tokens).toBeGreaterThanOrEqual(250);
    });

    it('should get usage stats for specific group', () => {
      logUsage({
        group_folder: 'group3',
        timestamp: '2026-02-08T12:00:00Z',
        prompt_tokens: 50,
        response_tokens: 100,
        duration_ms: 800,
      });

      const stats = getUsageStats('group3');
      expect(stats.total_requests).toBeGreaterThanOrEqual(1);
      expect(stats.total_prompt_tokens).toBeGreaterThanOrEqual(50);
    });

    it('should get usage stats since timestamp', () => {
      const sinceTime = '2026-02-08T11:30:00Z';

      logUsage({
        group_folder: 'group4',
        timestamp: '2026-02-08T11:00:00Z',
        duration_ms: 1000,
      });

      logUsage({
        group_folder: 'group4',
        timestamp: '2026-02-08T12:00:00Z',
        duration_ms: 1000,
      });

      const stats = getUsageStats('group4', sinceTime);
      expect(stats.total_requests).toBe(1);
    });

    it('should get recent usage with limit', () => {
      for (let i = 0; i < 5; i++) {
        logUsage({
          group_folder: `group${i}`,
          timestamp: `2026-02-08T${String(10 + i).padStart(2, '0')}:00:00Z`,
          duration_ms: 1000,
        });
      }

      const recent = getRecentUsage(3);
      expect(recent).toHaveLength(3);
    });

    it('should return recent usage ordered by timestamp desc', () => {
      logUsage({
        group_folder: 'group_a',
        timestamp: '2026-02-08T10:00:00Z',
        duration_ms: 1000,
      });

      logUsage({
        group_folder: 'group_b',
        timestamp: '2026-02-08T12:00:00Z',
        duration_ms: 1000,
      });

      const recent = getRecentUsage(2);
      expect(recent[0].timestamp > recent[1].timestamp).toBe(true);
    });
  });

  describe('Error Tracking', () => {
    beforeEach(() => {
      // Reset in-memory state between tests
      const allStates = getAllErrorStates();
      allStates.forEach((s) => resetErrors(s.group));
    });

    it('should record error and increment counter', () => {
      recordError('group1', 'Test error');

      const state = getErrorState('group1');
      expect(state).toBeDefined();
      expect(state?.consecutiveFailures).toBe(1);
      expect(state?.lastError).toBe('Test error');
    });

    it('should increment consecutive failures', () => {
      recordError('group2', 'Error 1');
      recordError('group2', 'Error 2');
      recordError('group2', 'Error 3');

      const state = getErrorState('group2');
      expect(state?.consecutiveFailures).toBe(3);
      expect(state?.lastError).toBe('Error 3');
    });

    it('should reset error state', () => {
      recordError('group3', 'Test error');
      resetErrors('group3');

      const state = getErrorState('group3');
      expect(state?.consecutiveFailures).toBe(0);
      expect(state?.lastError).toBeNull();
    });

    it('should return null for non-existent error state', () => {
      const state = getErrorState('nonexistent');
      expect(state).toBeNull();
    });

    it('should mark alert sent', () => {
      recordError('group4', 'Error');
      markAlertSent('group4');

      const state = getErrorState('group4');
      expect(state?.lastAlertSent).toBeTruthy();
      expect(typeof state?.lastAlertSent).toBe('string');
    });

    it('should get all error states', () => {
      recordError('group_a', 'Error A');
      recordError('group_b', 'Error B');

      const allStates = getAllErrorStates();
      expect(allStates.length).toBeGreaterThanOrEqual(2);
      expect(allStates.some((s) => s.group === 'group_a')).toBe(true);
    });
  });

  describe('Rate Limiting', () => {
    beforeEach(() => clearRateLimits());

    it('should allow requests within limit', () => {
      const result = checkRateLimit('user1', 5, 60000);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });

    it('should block requests exceeding limit', () => {
      for (let i = 0; i < 3; i++) {
        checkRateLimit('user2', 3, 60000);
      }
      const result = checkRateLimit('user2', 3, 60000);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should provide reset time when blocked', () => {
      for (let i = 0; i < 3; i++) {
        checkRateLimit('user3', 3, 60000);
      }
      const result = checkRateLimit('user3', 3, 60000);
      expect(result.allowed).toBe(false);
      expect(result.resetInMs).toBeGreaterThan(0);
      expect(result.resetInMs).toBeLessThanOrEqual(60000);
    });

    it('should get rate limit status without incrementing', () => {
      checkRateLimit('user4', 5, 60000);
      checkRateLimit('user4', 5, 60000);

      const status = getRateLimitStatus('user4', 5, 60000);
      expect(status.count).toBe(2);
      expect(status.remaining).toBe(3);

      // Calling again should not change count
      const status2 = getRateLimitStatus('user4', 5, 60000);
      expect(status2.count).toBe(2);
    });

    it('should reset after window expires', () => {
      vi.useFakeTimers();
      try {
        checkRateLimit('user5', 2, 1000);
        checkRateLimit('user5', 2, 1000);

        const blocked = checkRateLimit('user5', 2, 1000);
        expect(blocked.allowed).toBe(false);

        // Advance past window
        vi.advanceTimersByTime(1001);

        const allowed = checkRateLimit('user5', 2, 1000);
        expect(allowed.allowed).toBe(true);
        expect(allowed.remaining).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should handle multiple keys independently', () => {
      checkRateLimit('keyA', 2, 60000);
      checkRateLimit('keyA', 2, 60000);

      const blockedA = checkRateLimit('keyA', 2, 60000);
      expect(blockedA.allowed).toBe(false);

      // keyB should still be allowed
      const allowedB = checkRateLimit('keyB', 2, 60000);
      expect(allowedB.allowed).toBe(true);
      expect(allowedB.remaining).toBe(1);
    });

    it('should track remaining count correctly', () => {
      const r1 = checkRateLimit('user6', 3, 60000);
      expect(r1.remaining).toBe(2);

      const r2 = checkRateLimit('user6', 3, 60000);
      expect(r2.remaining).toBe(1);

      const r3 = checkRateLimit('user6', 3, 60000);
      expect(r3.remaining).toBe(0);
    });
  });
});
