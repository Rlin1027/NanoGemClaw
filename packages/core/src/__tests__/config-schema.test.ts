import { describe, it, expect } from 'vitest';
import { envSchema } from '../config-schema.js';

const REQUIRED_BASE = {
  TELEGRAM_BOT_TOKEN: 'test-token-123',
};

describe('envSchema', () => {
  describe('required fields', () => {
    it('fails when TELEGRAM_BOT_TOKEN is missing', () => {
      const result = envSchema.safeParse({});
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path[0] === 'TELEGRAM_BOT_TOKEN')).toBe(true);
      }
    });

    it('fails when TELEGRAM_BOT_TOKEN is empty string', () => {
      const result = envSchema.safeParse({ TELEGRAM_BOT_TOKEN: '' });
      expect(result.success).toBe(false);
    });

    it('succeeds with just TELEGRAM_BOT_TOKEN', () => {
      const result = envSchema.safeParse(REQUIRED_BASE);
      expect(result.success).toBe(true);
    });
  });

  describe('defaults', () => {
    it('provides default ASSISTANT_NAME', () => {
      const result = envSchema.safeParse(REQUIRED_BASE);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.ASSISTANT_NAME).toBe('Andy');
    });

    it('provides default GEMINI_MODEL', () => {
      const result = envSchema.safeParse(REQUIRED_BASE);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.GEMINI_MODEL).toBe('gemini-3-flash-preview');
    });

    it('provides default CONTAINER_IMAGE', () => {
      const result = envSchema.safeParse(REQUIRED_BASE);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.CONTAINER_IMAGE).toBe('nanogemclaw-agent:latest');
    });

    it('provides default CONTAINER_TIMEOUT as number', () => {
      const result = envSchema.safeParse(REQUIRED_BASE);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.CONTAINER_TIMEOUT).toBe(300000);
    });

    it('provides default HEALTH_CHECK_PORT as number', () => {
      const result = envSchema.safeParse(REQUIRED_BASE);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.HEALTH_CHECK_PORT).toBe(8080);
    });

    it('defaults boolean flags to true', () => {
      const result = envSchema.safeParse(REQUIRED_BASE);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.HEALTH_CHECK_ENABLED).toBe(true);
        expect(result.data.RATE_LIMIT_ENABLED).toBe(true);
        expect(result.data.ALERTS_ENABLED).toBe(true);
        expect(result.data.FAST_PATH_ENABLED).toBe(true);
      }
    });
  });

  describe('integer parsing', () => {
    it('parses CONTAINER_TIMEOUT from string', () => {
      const result = envSchema.safeParse({ ...REQUIRED_BASE, CONTAINER_TIMEOUT: '60000' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.CONTAINER_TIMEOUT).toBe(60000);
    });

    it('falls back to default for invalid integer', () => {
      const result = envSchema.safeParse({ ...REQUIRED_BASE, CONTAINER_TIMEOUT: 'abc' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.CONTAINER_TIMEOUT).toBe(300000);
    });

    it('parses RATE_LIMIT_MAX from string', () => {
      const result = envSchema.safeParse({ ...REQUIRED_BASE, RATE_LIMIT_MAX: '50' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.RATE_LIMIT_MAX).toBe(50);
    });
  });

  describe('boolean parsing', () => {
    it('disables feature when env var is "false"', () => {
      const result = envSchema.safeParse({
        ...REQUIRED_BASE,
        HEALTH_CHECK_ENABLED: 'false',
        RATE_LIMIT_ENABLED: 'false',
        ALERTS_ENABLED: 'false',
        FAST_PATH_ENABLED: 'false',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.HEALTH_CHECK_ENABLED).toBe(false);
        expect(result.data.RATE_LIMIT_ENABLED).toBe(false);
        expect(result.data.ALERTS_ENABLED).toBe(false);
        expect(result.data.FAST_PATH_ENABLED).toBe(false);
      }
    });

    it('keeps feature enabled when env var is any other string', () => {
      const result = envSchema.safeParse({
        ...REQUIRED_BASE,
        HEALTH_CHECK_ENABLED: 'true',
        ALERTS_ENABLED: '1',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.HEALTH_CHECK_ENABLED).toBe(true);
        expect(result.data.ALERTS_ENABLED).toBe(true);
      }
    });
  });

  describe('optional fields', () => {
    it('accepts GEMINI_API_KEY when provided', () => {
      const result = envSchema.safeParse({ ...REQUIRED_BASE, GEMINI_API_KEY: 'my-key' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.GEMINI_API_KEY).toBe('my-key');
    });

    it('accepts TZ when provided', () => {
      const result = envSchema.safeParse({ ...REQUIRED_BASE, TZ: 'Asia/Taipei' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.TZ).toBe('Asia/Taipei');
    });

    it('defaults WEBHOOK_URL to empty string', () => {
      const result = envSchema.safeParse(REQUIRED_BASE);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.WEBHOOK_URL).toBe('');
    });

    it('defaults WEBHOOK_EVENTS to "error,alert"', () => {
      const result = envSchema.safeParse(REQUIRED_BASE);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.WEBHOOK_EVENTS).toBe('error,alert');
    });
  });

  describe('fast path settings', () => {
    it('uses defaults for CACHE_TTL_SECONDS', () => {
      const result = envSchema.safeParse(REQUIRED_BASE);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.CACHE_TTL_SECONDS).toBe(21600);
    });

    it('parses FAST_PATH_TIMEOUT_MS from string', () => {
      const result = envSchema.safeParse({ ...REQUIRED_BASE, FAST_PATH_TIMEOUT_MS: '90000' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.FAST_PATH_TIMEOUT_MS).toBe(90000);
    });
  });
});
