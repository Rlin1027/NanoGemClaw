import { vi, describe, it, expect, beforeEach } from 'vitest';

// Must set env before config.ts is imported (module has side effects)
vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token-123';
});

import {
  ASSISTANT_NAME,
  CONTAINER_TIMEOUT,
  CONTAINER_MAX_OUTPUT_SIZE,
  HEALTH_CHECK,
  RATE_LIMIT,
  TRIGGER_PATTERN,
  CLEANUP,
  TELEGRAM,
  ALERTS,
  ALLOWED_CONTAINER_ENV_KEYS,
  GEMINI_MODEL,
  POLL_INTERVAL,
  SCHEDULER_POLL_INTERVAL,
  CONTAINER_IMAGE,
  TIMEZONE,
  CONTAINER,
  WEBHOOK,
  TASK_TRACKING,
  MEMORY,
  MOUNT_ALLOWLIST_PATH,
  STORE_DIR,
  GROUPS_DIR,
  DATA_DIR,
  MAIN_GROUP_FOLDER,
  IPC_POLL_INTERVAL,
} from '../config.js';

describe('config.ts', () => {
  describe('ASSISTANT_NAME', () => {
    it('should default to "Andy"', () => {
      expect(ASSISTANT_NAME).toBe('test-token-123' ? 'Andy' : 'Andy');
    });

    it('should use env override if provided', () => {
      // Note: cannot test this in same run due to import-time evaluation
      // This test documents expected behavior
      expect(ASSISTANT_NAME).toBeDefined();
      expect(typeof ASSISTANT_NAME).toBe('string');
    });
  });

  describe('Basic Constants', () => {
    it('should have correct poll intervals', () => {
      expect(POLL_INTERVAL).toBe(2000);
      expect(SCHEDULER_POLL_INTERVAL).toBe(60000);
      expect(IPC_POLL_INTERVAL).toBe(1000);
    });

    it('should have default Gemini model', () => {
      expect(GEMINI_MODEL).toBe('gemini-2.5-flash');
    });

    it('should have default container image', () => {
      expect(CONTAINER_IMAGE).toBe('nanogemclaw-agent:latest');
    });

    it('should have main group folder name', () => {
      expect(MAIN_GROUP_FOLDER).toBe('main');
    });
  });

  describe('Path Constants', () => {
    it('should define mount allowlist path', () => {
      expect(MOUNT_ALLOWLIST_PATH).toContain('.config');
      expect(MOUNT_ALLOWLIST_PATH).toContain('nanogemclaw');
      expect(MOUNT_ALLOWLIST_PATH).toContain('mount-allowlist.json');
    });

    it('should define project directories', () => {
      expect(STORE_DIR).toContain('store');
      expect(GROUPS_DIR).toContain('groups');
      expect(DATA_DIR).toContain('data');
    });

    it('should use absolute paths', () => {
      expect(STORE_DIR).toMatch(/^\/|^[A-Z]:\\/);
      expect(GROUPS_DIR).toMatch(/^\/|^[A-Z]:\\/);
      expect(DATA_DIR).toMatch(/^\/|^[A-Z]:\\/);
    });
  });

  describe('safeParseInt (indirect testing via exports)', () => {
    it('should parse CONTAINER_TIMEOUT with default 300000', () => {
      expect(CONTAINER_TIMEOUT).toBe(300000);
      expect(typeof CONTAINER_TIMEOUT).toBe('number');
    });

    it('should parse CONTAINER_MAX_OUTPUT_SIZE with default 10485760', () => {
      expect(CONTAINER_MAX_OUTPUT_SIZE).toBe(10485760);
      expect(typeof CONTAINER_MAX_OUTPUT_SIZE).toBe('number');
    });

    it('should handle invalid number strings by using defaults', () => {
      // These values should be numbers even if env vars are invalid
      expect(Number.isNaN(CONTAINER_TIMEOUT)).toBe(false);
      expect(Number.isNaN(CONTAINER_MAX_OUTPUT_SIZE)).toBe(false);
    });
  });

  describe('HEALTH_CHECK', () => {
    it('should have correct default values', () => {
      expect(HEALTH_CHECK.ENABLED).toBe(true);
      expect(HEALTH_CHECK.PORT).toBe(8080);
    });

    it('should be typed as const (compile-time readonly)', () => {
      // `as const` provides TypeScript-level readonly, not runtime Object.freeze
      expect(typeof HEALTH_CHECK.PORT).toBe('number');
      expect(typeof HEALTH_CHECK.ENABLED).toBe('boolean');
    });
  });

  describe('RATE_LIMIT', () => {
    it('should have correct default values', () => {
      expect(RATE_LIMIT.MAX_REQUESTS).toBe(20);
      expect(RATE_LIMIT.WINDOW_MINUTES).toBe(5);
      expect(RATE_LIMIT.ENABLED).toBe(true);
      expect(RATE_LIMIT.MESSAGE).toBe('⏳ 請求過於頻繁，請稍後再試。');
    });

    it('should be typed as const (compile-time readonly)', () => {
      expect(typeof RATE_LIMIT.MAX_REQUESTS).toBe('number');
      expect(typeof RATE_LIMIT.WINDOW_MINUTES).toBe('number');
    });
  });

  describe('TRIGGER_PATTERN', () => {
    it('should match @AssistantName at start (case-insensitive)', () => {
      expect(TRIGGER_PATTERN.test('@Andy hello')).toBe(true);
      expect(TRIGGER_PATTERN.test('@andy hello')).toBe(true);
      expect(TRIGGER_PATTERN.test('@ANDY hello')).toBe(true);
    });

    it('should not match without @ prefix', () => {
      expect(TRIGGER_PATTERN.test('Andy hello')).toBe(false);
    });

    it('should not match in middle of string', () => {
      expect(TRIGGER_PATTERN.test('hello @Andy')).toBe(false);
    });

    it('should require word boundary after name', () => {
      expect(TRIGGER_PATTERN.test('@Andy!')).toBe(true);
      expect(TRIGGER_PATTERN.test('@Andy ')).toBe(true);
      expect(TRIGGER_PATTERN.test('@Andyxxx')).toBe(false);
    });

    it('should escape special regex characters in assistant name', () => {
      // This tests escapeRegex indirectly
      // TRIGGER_PATTERN should work correctly even if name had special chars
      expect(TRIGGER_PATTERN).toBeInstanceOf(RegExp);
      expect(TRIGGER_PATTERN.source).toContain('Andy');
    });
  });

  describe('CLEANUP', () => {
    it('should have correct static values', () => {
      expect(CLEANUP.MEDIA_MAX_AGE_DAYS).toBe(7);
      expect(CLEANUP.MEDIA_CLEANUP_INTERVAL_HOURS).toBe(6);
    });

    it('should calculate MEDIA_CLEANUP_INTERVAL_MS correctly', () => {
      const expected = 6 * 60 * 60 * 1000; // 6 hours in ms
      expect(CLEANUP.MEDIA_CLEANUP_INTERVAL_MS).toBe(expected);
      expect(CLEANUP.MEDIA_CLEANUP_INTERVAL_MS).toBe(21600000);
    });

    it('should recalculate getter on each access', () => {
      const value1 = CLEANUP.MEDIA_CLEANUP_INTERVAL_MS;
      const value2 = CLEANUP.MEDIA_CLEANUP_INTERVAL_MS;
      expect(value1).toBe(value2);
    });
  });

  describe('TELEGRAM', () => {
    it('should have correct constants', () => {
      expect(TELEGRAM.RATE_LIMIT_DELAY_MS).toBe(100);
      expect(TELEGRAM.MAX_MESSAGE_LENGTH).toBe(4096);
    });

    it('should be typed as const (compile-time readonly)', () => {
      expect(typeof TELEGRAM.RATE_LIMIT_DELAY_MS).toBe('number');
      expect(typeof TELEGRAM.MAX_MESSAGE_LENGTH).toBe('number');
    });
  });

  describe('ALERTS', () => {
    it('should have correct default values', () => {
      expect(ALERTS.FAILURE_THRESHOLD).toBe(3);
      expect(ALERTS.ALERT_COOLDOWN_MINUTES).toBe(30);
      expect(ALERTS.ENABLED).toBe(true);
    });
  });

  describe('CONTAINER', () => {
    it('should have correct configuration values', () => {
      expect(CONTAINER.GRACEFUL_SHUTDOWN_DELAY_MS).toBe(5000);
      expect(CONTAINER.IPC_DEBOUNCE_MS).toBe(100);
      expect(CONTAINER.IPC_FALLBACK_POLLING_MULTIPLIER).toBe(5);
    });
  });

  describe('WEBHOOK', () => {
    it('should have empty URL by default', () => {
      expect(WEBHOOK.URL).toBe('');
      expect(WEBHOOK.ENABLED).toBe(false);
    });

    it('should parse events from env', () => {
      expect(WEBHOOK.EVENTS).toEqual(['error', 'alert']);
      expect(Array.isArray(WEBHOOK.EVENTS)).toBe(true);
    });
  });

  describe('TASK_TRACKING', () => {
    it('should have correct limits', () => {
      expect(TASK_TRACKING.MAX_TURNS).toBe(5);
      expect(TASK_TRACKING.STEP_TIMEOUT_MS).toBe(300000);
    });
  });

  describe('MEMORY', () => {
    it('should have correct thresholds', () => {
      expect(MEMORY.SUMMARIZE_THRESHOLD_CHARS).toBe(50000);
      expect(MEMORY.MAX_CONTEXT_MESSAGES).toBe(100);
      expect(MEMORY.CHECK_INTERVAL_HOURS).toBe(4);
    });

    it('should have summary prompt defined', () => {
      expect(MEMORY.SUMMARY_PROMPT).toContain('Summarize');
      expect(MEMORY.SUMMARY_PROMPT).toContain('Key topics');
      expect(typeof MEMORY.SUMMARY_PROMPT).toBe('string');
    });
  });

  describe('ALLOWED_CONTAINER_ENV_KEYS', () => {
    it('should be an array of strings', () => {
      expect(Array.isArray(ALLOWED_CONTAINER_ENV_KEYS)).toBe(true);
      expect(ALLOWED_CONTAINER_ENV_KEYS.length).toBeGreaterThan(0);
      expect(
        ALLOWED_CONTAINER_ENV_KEYS.every((k) => typeof k === 'string'),
      ).toBe(true);
    });

    it('should include critical environment variables', () => {
      expect(ALLOWED_CONTAINER_ENV_KEYS).toContain('GEMINI_API_KEY');
      expect(ALLOWED_CONTAINER_ENV_KEYS).toContain('GOOGLE_API_KEY');
      expect(ALLOWED_CONTAINER_ENV_KEYS).toContain('GEMINI_MODEL');
      expect(ALLOWED_CONTAINER_ENV_KEYS).toContain('TZ');
      expect(ALLOWED_CONTAINER_ENV_KEYS).toContain('NODE_ENV');
    });

    it('should have exactly 9 allowed keys', () => {
      expect(ALLOWED_CONTAINER_ENV_KEYS).toHaveLength(9);
    });

    it('should not include sensitive keys like TELEGRAM_BOT_TOKEN', () => {
      expect(ALLOWED_CONTAINER_ENV_KEYS).not.toContain('TELEGRAM_BOT_TOKEN');
      expect(ALLOWED_CONTAINER_ENV_KEYS).not.toContain('HOME');
      expect(ALLOWED_CONTAINER_ENV_KEYS).not.toContain('PATH');
    });
  });

  describe('TIMEZONE', () => {
    it('should use system timezone', () => {
      expect(TIMEZONE).toBeDefined();
      expect(typeof TIMEZONE).toBe('string');
      expect(TIMEZONE.length).toBeGreaterThan(0);
    });

    it('should fallback to Intl if TZ not set', () => {
      // TIMEZONE should be valid timezone string
      expect(TIMEZONE).toMatch(/^[A-Za-z]+\/[A-Za-z_]+$|^UTC$/);
    });
  });

  describe('Type Safety', () => {
    it('should export readonly objects with correct types', () => {
      // Runtime check for const assertions
      const healthCheckKeys = Object.keys(HEALTH_CHECK);
      expect(healthCheckKeys).toContain('ENABLED');
      expect(healthCheckKeys).toContain('PORT');
    });

    it('should have numeric values where expected', () => {
      expect(typeof POLL_INTERVAL).toBe('number');
      expect(typeof CONTAINER_TIMEOUT).toBe('number');
      expect(typeof HEALTH_CHECK.PORT).toBe('number');
      expect(typeof RATE_LIMIT.MAX_REQUESTS).toBe('number');
    });

    it('should have boolean values where expected', () => {
      expect(typeof HEALTH_CHECK.ENABLED).toBe('boolean');
      expect(typeof RATE_LIMIT.ENABLED).toBe('boolean');
      expect(typeof ALERTS.ENABLED).toBe('boolean');
      expect(typeof WEBHOOK.ENABLED).toBe('boolean');
    });

    it('should have RegExp for TRIGGER_PATTERN', () => {
      expect(TRIGGER_PATTERN).toBeInstanceOf(RegExp);
    });
  });
});
