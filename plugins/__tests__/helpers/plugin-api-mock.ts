/**
 * Shared mock factory for PluginApi — used by all plugin tests.
 */
import { vi } from 'vitest';
import type { PluginApi, PluginLogger } from '@nanogemclaw/plugin-api';

export function createMockLogger(): PluginLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

export function createMockPluginApi(
  overrides?: Partial<PluginApi>,
): PluginApi {
  return {
    getDatabase: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    getGroups: vi.fn().mockReturnValue({}),
    logger: createMockLogger(),
    config: {},
    dataDir: '/tmp/test-plugin-data',
    ...overrides,
  };
}
