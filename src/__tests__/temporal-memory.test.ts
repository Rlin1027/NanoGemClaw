import {
  vi,
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from 'vitest';

const { TEST_STORE_DIR } = vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  const _os = require('os') as typeof import('os');
  const _path = require('path') as typeof import('path');
  const TEST_STORE_DIR = _path.join(
    _os.tmpdir(),
    `nanogemclaw-test-temporal-${Date.now()}`,
  );
  return { TEST_STORE_DIR };
});

vi.mock('../config.js', () => ({
  STORE_DIR: TEST_STORE_DIR,
}));

vi.mock('@nanogemclaw/event-bus', () => ({
  getEventBus: () => ({ emit: vi.fn() }),
}));

import { initDatabase, closeDatabase, getDatabase } from '../db/connection.js';
import {
  upsertTemporalMemory,
  getTemporalMemory,
  getAllTemporalMemories,
  cleanExpiredTemporalMemories,
  deleteTemporalMemoriesByGroup,
  getTemporalContext,
} from '../db/temporal-memory.js';
import { cleanupTestDir } from './helpers/db-test-setup.js';

describe('db/temporal-memory', () => {
  beforeAll(() => {
    initDatabase();
  });

  afterAll(() => {
    closeDatabase();
    cleanupTestDir(TEST_STORE_DIR);
  });

  beforeEach(() => {
    const db = getDatabase();
    db.prepare('DELETE FROM memory_temporal').run();
  });

  describe('upsertTemporalMemory', () => {
    it('should insert a new temporal memory', () => {
      upsertTemporalMemory('main', 'short', 'recent topics');
      const row = getTemporalMemory('main', 'short');
      expect(row).not.toBeNull();
      expect(row!.group_folder).toBe('main');
      expect(row!.layer).toBe('short');
      expect(row!.content).toBe('recent topics');
      expect(row!.metadata).toBeNull();
    });

    it('should update existing memory on conflict (UPSERT)', () => {
      upsertTemporalMemory('main', 'short', 'version 1');
      upsertTemporalMemory('main', 'short', 'version 2');
      const row = getTemporalMemory('main', 'short');
      expect(row!.content).toBe('version 2');
    });

    it('should store metadata as JSON', () => {
      upsertTemporalMemory('main', 'medium', 'patterns', {
        model: 'gemini-3-flash-preview',
        compactedFrom: 'short',
      });
      const row = getTemporalMemory('main', 'medium');
      expect(row!.metadata).not.toBeNull();
      const meta = JSON.parse(row!.metadata!);
      expect(meta.model).toBe('gemini-3-flash-preview');
      expect(meta.compactedFrom).toBe('short');
    });

    it('should set created_at and updated_at timestamps', () => {
      upsertTemporalMemory('main', 'long', 'profile');
      const row = getTemporalMemory('main', 'long');
      expect(row!.created_at).toBeDefined();
      expect(row!.updated_at).toBeDefined();
    });

    it('should update updated_at on UPSERT but keep created_at', () => {
      upsertTemporalMemory('main', 'short', 'v1');
      const first = getTemporalMemory('main', 'short');

      // Small delay to ensure different timestamp
      vi.useFakeTimers();
      vi.advanceTimersByTime(1000);
      vi.useRealTimers();

      upsertTemporalMemory('main', 'short', 'v2');
      const second = getTemporalMemory('main', 'short');
      expect(second!.content).toBe('v2');
    });
  });

  describe('getTemporalMemory', () => {
    it('should return null for non-existent group', () => {
      expect(getTemporalMemory('nonexistent', 'short')).toBeNull();
    });

    it('should return null for non-existent layer', () => {
      upsertTemporalMemory('main', 'short', 'exists');
      expect(getTemporalMemory('main', 'medium')).toBeNull();
    });

    it('should return the correct layer for the group', () => {
      upsertTemporalMemory('group-a', 'short', 'a-short');
      upsertTemporalMemory('group-b', 'short', 'b-short');
      expect(getTemporalMemory('group-a', 'short')!.content).toBe('a-short');
      expect(getTemporalMemory('group-b', 'short')!.content).toBe('b-short');
    });
  });

  describe('getAllTemporalMemories', () => {
    it('should return empty array for group with no memories', () => {
      expect(getAllTemporalMemories('empty')).toEqual([]);
    });

    it('should return all layers sorted short → medium → long', () => {
      // Insert in reverse order to test sorting
      upsertTemporalMemory('main', 'long', 'profile');
      upsertTemporalMemory('main', 'short', 'recent');
      upsertTemporalMemory('main', 'medium', 'patterns');

      const layers = getAllTemporalMemories('main');
      expect(layers).toHaveLength(3);
      expect(layers[0].layer).toBe('short');
      expect(layers[1].layer).toBe('medium');
      expect(layers[2].layer).toBe('long');
    });

    it('should only return memories for the specified group', () => {
      upsertTemporalMemory('group-a', 'short', 'a');
      upsertTemporalMemory('group-b', 'short', 'b');
      const layers = getAllTemporalMemories('group-a');
      expect(layers).toHaveLength(1);
      expect(layers[0].content).toBe('a');
    });
  });

  describe('cleanExpiredTemporalMemories', () => {
    it('should delete short-term memories older than 7 days', () => {
      const db = getDatabase();
      const oldDate = new Date(
        Date.now() - 8 * 24 * 60 * 60 * 1000,
      ).toISOString();
      db.prepare(
        'INSERT INTO memory_temporal (group_folder, layer, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).run('main', 'short', 'old short', oldDate, oldDate);

      const cleaned = cleanExpiredTemporalMemories();
      expect(cleaned).toBe(1);
      expect(getTemporalMemory('main', 'short')).toBeNull();
    });

    it('should delete medium-term memories older than 30 days', () => {
      const db = getDatabase();
      const oldDate = new Date(
        Date.now() - 31 * 24 * 60 * 60 * 1000,
      ).toISOString();
      db.prepare(
        'INSERT INTO memory_temporal (group_folder, layer, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).run('main', 'medium', 'old medium', oldDate, oldDate);

      const cleaned = cleanExpiredTemporalMemories();
      expect(cleaned).toBe(1);
    });

    it('should never delete long-term memories', () => {
      const db = getDatabase();
      const veryOld = new Date(
        Date.now() - 365 * 24 * 60 * 60 * 1000,
      ).toISOString();
      db.prepare(
        'INSERT INTO memory_temporal (group_folder, layer, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).run('main', 'long', 'permanent', veryOld, veryOld);

      const cleaned = cleanExpiredTemporalMemories();
      expect(cleaned).toBe(0);
      expect(getTemporalMemory('main', 'long')!.content).toBe('permanent');
    });

    it('should keep recent short-term memories', () => {
      upsertTemporalMemory('main', 'short', 'recent');
      const cleaned = cleanExpiredTemporalMemories();
      expect(cleaned).toBe(0);
      expect(getTemporalMemory('main', 'short')).not.toBeNull();
    });
  });

  describe('deleteTemporalMemoriesByGroup', () => {
    it('should delete all layers for a group', () => {
      upsertTemporalMemory('main', 'short', 's');
      upsertTemporalMemory('main', 'medium', 'm');
      upsertTemporalMemory('main', 'long', 'l');

      const count = deleteTemporalMemoriesByGroup('main');
      expect(count).toBe(3);
      expect(getAllTemporalMemories('main')).toEqual([]);
    });

    it('should not affect other groups', () => {
      upsertTemporalMemory('group-a', 'short', 'a');
      upsertTemporalMemory('group-b', 'short', 'b');

      deleteTemporalMemoriesByGroup('group-a');
      expect(getTemporalMemory('group-b', 'short')!.content).toBe('b');
    });

    it('should return 0 for non-existent group', () => {
      expect(deleteTemporalMemoriesByGroup('nonexistent')).toBe(0);
    });
  });

  describe('getTemporalContext', () => {
    it('should return null when no memories exist', () => {
      expect(getTemporalContext('empty')).toBeNull();
    });

    it('should build formatted context with labels', () => {
      upsertTemporalMemory('main', 'short', 'recent stuff');
      const ctx = getTemporalContext('main');
      expect(ctx).toContain('[RECENT OBSERVATIONS]');
      expect(ctx).toContain('recent stuff');
      expect(ctx).toContain('[END RECENT OBSERVATIONS]');
    });

    it('should include all layers with correct labels', () => {
      upsertTemporalMemory('main', 'short', 'short content');
      upsertTemporalMemory('main', 'medium', 'medium content');
      upsertTemporalMemory('main', 'long', 'long content');

      const ctx = getTemporalContext('main')!;
      expect(ctx).toContain('[RECENT OBSERVATIONS]');
      expect(ctx).toContain('[BEHAVIORAL PATTERNS]');
      expect(ctx).toContain('[GROUP PROFILE]');
      expect(ctx).toContain('short content');
      expect(ctx).toContain('medium content');
      expect(ctx).toContain('long content');
    });

    it('should separate layers with double newlines', () => {
      upsertTemporalMemory('main', 'short', 's');
      upsertTemporalMemory('main', 'medium', 'm');
      const ctx = getTemporalContext('main')!;
      expect(ctx).toContain(
        '[END RECENT OBSERVATIONS]\n\n[BEHAVIORAL PATTERNS]',
      );
    });
  });
});
