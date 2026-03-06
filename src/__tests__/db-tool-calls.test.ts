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
    `nanogemclaw-test-${Date.now()}`,
  );
  return { TEST_STORE_DIR };
});

vi.mock('../config.js', () => ({
  STORE_DIR: TEST_STORE_DIR,
}));

import {
  initDatabase,
  closeDatabase,
  insertToolCallLog,
  getToolCallLogs,
  getToolCallStats,
} from '../db.js';
import { resetDatabase, cleanupTestDir } from './helpers/db-test-setup.js';

describe('db/tool-calls', () => {
  beforeAll(() => {
    initDatabase();
  });

  afterAll(() => {
    closeDatabase();
    cleanupTestDir(TEST_STORE_DIR);
  });

  beforeEach(() => resetDatabase(TEST_STORE_DIR));

  describe('insertToolCallLog', () => {
    it('should insert a tool call log and return id', () => {
      const id = insertToolCallLog({
        group_folder: 'group1',
        chat_jid: '-1001234',
        tool_name: 'searchWeb',
        args_summary: '{"query":"test"}',
        result_status: 'success',
        duration_ms: 150,
        injection_detected: 0,
        injection_patterns: null,
        created_at: '2026-03-01T10:00:00Z',
      });
      expect(id).toBeGreaterThan(0);
    });

    it('should insert with injection detected', () => {
      const id = insertToolCallLog({
        group_folder: 'group1',
        chat_jid: '-1001234',
        tool_name: 'readFile',
        args_summary: '{"path":"../../etc/passwd"}',
        result_status: 'blocked',
        duration_ms: 5,
        injection_detected: 1,
        injection_patterns: 'path_traversal',
        created_at: '2026-03-01T10:01:00Z',
      });
      expect(id).toBeGreaterThan(0);
    });

    it('should insert with null optional fields', () => {
      const id = insertToolCallLog({
        group_folder: 'group1',
        chat_jid: '-1001234',
        tool_name: 'getWeather',
        args_summary: null,
        result_status: 'error',
        duration_ms: null,
        injection_detected: 0,
        injection_patterns: null,
        created_at: '2026-03-01T10:02:00Z',
      });
      expect(id).toBeGreaterThan(0);
    });
  });

  describe('getToolCallLogs', () => {
    it('should return paginated logs', () => {
      for (let i = 0; i < 5; i++) {
        insertToolCallLog({
          group_folder: 'group1',
          chat_jid: '-1001234',
          tool_name: `tool${i}`,
          args_summary: null,
          result_status: 'success',
          duration_ms: 100,
          injection_detected: 0,
          injection_patterns: null,
          created_at: `2026-03-01T10:0${i}:00Z`,
        });
      }

      const { rows, total } = getToolCallLogs(3, 0);
      expect(rows).toHaveLength(3);
      expect(total).toBe(5);
    });

    it('should return logs ordered by created_at DESC', () => {
      insertToolCallLog({
        group_folder: 'group1',
        chat_jid: '-1001234',
        tool_name: 'older',
        args_summary: null,
        result_status: 'success',
        duration_ms: 100,
        injection_detected: 0,
        injection_patterns: null,
        created_at: '2026-03-01T10:00:00Z',
      });
      insertToolCallLog({
        group_folder: 'group1',
        chat_jid: '-1001234',
        tool_name: 'newer',
        args_summary: null,
        result_status: 'success',
        duration_ms: 100,
        injection_detected: 0,
        injection_patterns: null,
        created_at: '2026-03-01T11:00:00Z',
      });

      const { rows } = getToolCallLogs(10, 0);
      expect(rows[0].tool_name).toBe('newer');
      expect(rows[1].tool_name).toBe('older');
    });

    it('should filter by group_folder', () => {
      insertToolCallLog({
        group_folder: 'group1',
        chat_jid: '-1001234',
        tool_name: 'tool1',
        args_summary: null,
        result_status: 'success',
        duration_ms: 100,
        injection_detected: 0,
        injection_patterns: null,
        created_at: '2026-03-01T10:00:00Z',
      });
      insertToolCallLog({
        group_folder: 'group2',
        chat_jid: '-1005678',
        tool_name: 'tool2',
        args_summary: null,
        result_status: 'success',
        duration_ms: 100,
        injection_detected: 0,
        injection_patterns: null,
        created_at: '2026-03-01T10:01:00Z',
      });

      const { rows, total } = getToolCallLogs(10, 0, 'group1');
      expect(rows).toHaveLength(1);
      expect(total).toBe(1);
      expect(rows[0].tool_name).toBe('tool1');
    });

    it('should support offset for pagination', () => {
      for (let i = 0; i < 5; i++) {
        insertToolCallLog({
          group_folder: 'group1',
          chat_jid: '-1001234',
          tool_name: `tool${i}`,
          args_summary: null,
          result_status: 'success',
          duration_ms: 100,
          injection_detected: 0,
          injection_patterns: null,
          created_at: `2026-03-01T10:0${i}:00Z`,
        });
      }

      const { rows } = getToolCallLogs(2, 2);
      expect(rows).toHaveLength(2);
    });
  });

  describe('getToolCallStats', () => {
    it('should return empty stats when no logs', () => {
      const stats = getToolCallStats(7);
      expect(stats.total_calls).toBe(0);
      expect(stats.unique_tools).toBe(0);
      expect(stats.injection_count).toBe(0);
      expect(stats.by_status).toHaveLength(0);
      expect(stats.by_tool).toHaveLength(0);
    });

    it('should calculate correct stats', () => {
      const now = new Date().toISOString();
      insertToolCallLog({
        group_folder: 'group1',
        chat_jid: '-1001234',
        tool_name: 'searchWeb',
        args_summary: null,
        result_status: 'success',
        duration_ms: 100,
        injection_detected: 0,
        injection_patterns: null,
        created_at: now,
      });
      insertToolCallLog({
        group_folder: 'group1',
        chat_jid: '-1001234',
        tool_name: 'readFile',
        args_summary: null,
        result_status: 'success',
        duration_ms: 200,
        injection_detected: 0,
        injection_patterns: null,
        created_at: now,
      });
      insertToolCallLog({
        group_folder: 'group1',
        chat_jid: '-1001234',
        tool_name: 'searchWeb',
        args_summary: null,
        result_status: 'error',
        duration_ms: 50,
        injection_detected: 1,
        injection_patterns: 'xss',
        created_at: now,
      });

      const stats = getToolCallStats(7);
      expect(stats.total_calls).toBe(3);
      expect(stats.unique_tools).toBe(2);
      expect(stats.avg_duration_ms).toBe(117); // Math.round((100+200+50)/3)
      expect(stats.injection_count).toBe(1);
      expect(stats.by_status).toHaveLength(2);
      expect(stats.by_tool).toHaveLength(2);
    });

    it('should filter by group_folder', () => {
      const now = new Date().toISOString();
      insertToolCallLog({
        group_folder: 'group1',
        chat_jid: '-1001234',
        tool_name: 'tool1',
        args_summary: null,
        result_status: 'success',
        duration_ms: 100,
        injection_detected: 0,
        injection_patterns: null,
        created_at: now,
      });
      insertToolCallLog({
        group_folder: 'group2',
        chat_jid: '-1005678',
        tool_name: 'tool2',
        args_summary: null,
        result_status: 'success',
        duration_ms: 200,
        injection_detected: 0,
        injection_patterns: null,
        created_at: now,
      });

      const stats = getToolCallStats(7, 'group1');
      expect(stats.total_calls).toBe(1);
      expect(stats.by_tool[0].tool_name).toBe('tool1');
    });

    it('should exclude old logs outside the days window', () => {
      const now = new Date().toISOString();
      const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      insertToolCallLog({
        group_folder: 'group1',
        chat_jid: '-1001234',
        tool_name: 'recent',
        args_summary: null,
        result_status: 'success',
        duration_ms: 100,
        injection_detected: 0,
        injection_patterns: null,
        created_at: now,
      });
      insertToolCallLog({
        group_folder: 'group1',
        chat_jid: '-1001234',
        tool_name: 'old',
        args_summary: null,
        result_status: 'success',
        duration_ms: 100,
        injection_detected: 0,
        injection_patterns: null,
        created_at: old,
      });

      const stats = getToolCallStats(7);
      expect(stats.total_calls).toBe(1);
      expect(stats.by_tool[0].tool_name).toBe('recent');
    });
  });
});
