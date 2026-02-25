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
  getMemorySummary,
  upsertMemorySummary,
} from '../db.js';
import { resetDatabase, cleanupTestDir } from './helpers/db-test-setup.js';

describe('db/preferences', () => {
  beforeAll(() => {
    initDatabase();
  });

  afterAll(() => {
    closeDatabase();
    cleanupTestDir(TEST_STORE_DIR);
  });

  describe('Memory Summaries', () => {
    beforeEach(() => resetDatabase(TEST_STORE_DIR));

    it('should return null for non-existent summary', () => {
      const summary = getMemorySummary('nonexistent');
      // better-sqlite3's .get() returns undefined when no row is found
      expect(summary).toBeUndefined();
    });

    it('should upsert memory summary', () => {
      upsertMemorySummary('group1', 'Summary of conversations', 10, 5000);

      const summary = getMemorySummary('group1');
      expect(summary).toBeDefined();
      expect(summary?.summary).toBe('Summary of conversations');
      expect(summary?.messages_archived).toBe(10);
      expect(summary?.chars_archived).toBe(5000);
    });

    it('should update existing summary and accumulate counts', () => {
      upsertMemorySummary('group2', 'First summary', 5, 2000);
      upsertMemorySummary('group2', 'Updated summary', 3, 1500);

      const summary = getMemorySummary('group2');
      expect(summary?.summary).toBe('Updated summary');
      expect(summary?.messages_archived).toBe(8); // Accumulated
      expect(summary?.chars_archived).toBe(3500); // Accumulated
    });

    it('should track created_at and updated_at timestamps', async () => {
      upsertMemorySummary('group3', 'Initial', 1, 100);
      const first = getMemorySummary('group3');

      await new Promise((resolve) => setTimeout(resolve, 10));
      upsertMemorySummary('group3', 'Updated', 1, 100);
      const updated = getMemorySummary('group3');

      expect(updated?.created_at).toBe(first?.created_at);
      expect(updated?.updated_at).not.toBe(first?.updated_at);
    });
  });
});
