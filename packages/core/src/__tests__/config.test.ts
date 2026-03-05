import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('packages/core/config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset module registry so each test gets fresh module state
    vi.resetModules();
    process.env = { ...originalEnv };
    // Remove GEMINI_MODEL so defaults kick in
    delete process.env.GEMINI_MODEL;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetModules();
  });

  describe('createConfig', () => {
    it('should return correct defaults', async () => {
      const { createConfig } = await import('../config.js');
      const config = createConfig();

      expect(config.geminiModel).toBe('gemini-3-flash-preview');
      expect(config.assistantName).toBe('Andy');
      expect(config.pollInterval).toBe(2000);
      expect(config.schedulerPollInterval).toBe(60000);
      expect(config.mainGroupFolder).toBe('main');
      expect(config.telegram.maxMessageLength).toBe(4096);
      expect(config.memory.summarizeThresholdChars).toBe(50000);
      expect(config.fastPath.enabled).toBe(true);
    });

    it('should apply geminiModel override', async () => {
      const { createConfig } = await import('../config.js');
      const config = createConfig({ geminiModel: 'gemini-pro' });

      expect(config.geminiModel).toBe('gemini-pro');
      // other defaults still intact
      expect(config.assistantName).toBe('Andy');
    });

    it('should apply multiple overrides', async () => {
      const { createConfig } = await import('../config.js');
      const config = createConfig({
        assistantName: 'TestBot',
        pollInterval: 5000,
      });

      expect(config.assistantName).toBe('TestBot');
      expect(config.pollInterval).toBe(5000);
      expect(config.geminiModel).toBe('gemini-3-flash-preview');
    });

    it('should read GEMINI_MODEL from env when set', async () => {
      // TELEGRAM_BOT_TOKEN is required for envSchema.safeParse to succeed
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      process.env.GEMINI_MODEL = 'gemini-env-model';
      const { createConfig } = await import('../config.js');
      const config = createConfig();

      expect(config.geminiModel).toBe('gemini-env-model');
    });
  });

  describe('getDefaultModel', () => {
    it('should return hardcoded fallback when no env or resolved model is set', async () => {
      const { getDefaultModel } = await import('../config.js');
      const model = getDefaultModel();

      expect(model).toBe('gemini-3-flash-preview');
    });

    it('should return env GEMINI_MODEL when set', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      process.env.GEMINI_MODEL = 'gemini-from-env';
      const { getDefaultModel } = await import('../config.js');
      const model = getDefaultModel();

      expect(model).toBe('gemini-from-env');
    });
  });

  describe('setResolvedDefaultModel', () => {
    it('should return the resolved model after setting it', async () => {
      const { setResolvedDefaultModel, getDefaultModel } = await import('../config.js');

      setResolvedDefaultModel('gemini-resolved-model');
      const model = getDefaultModel();

      expect(model).toBe('gemini-resolved-model');
    });

    it('should be overridden by GEMINI_MODEL env var', async () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-token';
      process.env.GEMINI_MODEL = 'gemini-env-priority';
      const { setResolvedDefaultModel, getDefaultModel } = await import('../config.js');

      setResolvedDefaultModel('gemini-resolved-model');
      const model = getDefaultModel();

      // Env var takes priority over resolved model
      expect(model).toBe('gemini-env-priority');
    });
  });
});
