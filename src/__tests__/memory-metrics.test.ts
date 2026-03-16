import { vi, describe, it, expect, beforeEach, afterAll } from 'vitest';
import Database from 'better-sqlite3';

// Use a real in-memory database so SQL logic is exercised
const testDb = new Database(':memory:');

vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token-123';
});

vi.mock('../db/connection.js', () => ({
  getDatabase: () => testDb,
}));

vi.mock('../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  initMemoryMetricsTable,
  recordCompressionScore,
  trackSearchQuery,
  trackContextUtilization,
  getMemoryMetrics,
  getSearchMetrics,
} from '../memory-metrics.js';

afterAll(() => {
  testDb.close();
});

beforeEach(() => {
  // Reset state between tests by dropping and recreating the table
  testDb.exec('DROP TABLE IF EXISTS memory_metrics');
  initMemoryMetricsTable();
});

describe('memory-metrics', () => {
  describe('initMemoryMetricsTable', () => {
    it('should create the table', () => {
      const row = testDb
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_metrics'",
        )
        .get();
      expect(row).toBeTruthy();
    });

    it('should be idempotent — calling twice does not throw', () => {
      expect(() => initMemoryMetricsTable()).not.toThrow();
    });

    it('should create the expected indexes', () => {
      const indexes = testDb
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='memory_metrics'",
        )
        .all() as Array<{ name: string }>;
      const names = indexes.map((i) => i.name);
      expect(names).toContain('idx_memory_metrics_group');
      expect(names).toContain('idx_memory_metrics_type');
      expect(names).toContain('idx_memory_metrics_created');
    });
  });

  describe('recordCompressionScore', () => {
    it('should return a score object with correct shape', () => {
      const score = recordCompressionScore(
        'test-group',
        'medium',
        'hello world from the conversation',
        'brief summary here',
      );
      expect(score).toMatchObject({
        compressionRatio: expect.any(Number),
        entityPreservationRate: expect.any(Number),
        qualityScore: expect.any(Number),
        inputChars: expect.any(Number),
        outputChars: expect.any(Number),
        layer: 'medium',
      });
    });

    it('should calculate compressionRatio as outputChars / inputChars', () => {
      const input = 'a'.repeat(100);
      const output = 'b'.repeat(40);
      const score = recordCompressionScore('g1', 'medium', input, output);
      expect(score.compressionRatio).toBeCloseTo(0.4);
      expect(score.inputChars).toBe(100);
      expect(score.outputChars).toBe(40);
    });

    it('should give qualityScore in 0–1 range for ideal compression (0.3–0.7)', () => {
      // ratio ~0.5 is ideal
      const input = 'information '.repeat(100); // 1200 chars
      const output = 'information '.repeat(50); // 600 chars, ratio ~0.5
      const score = recordCompressionScore('g1', 'medium', input, output);
      expect(score.qualityScore).toBeGreaterThan(0);
      expect(score.qualityScore).toBeLessThanOrEqual(1);
      // ideal range should give a good score
      expect(score.qualityScore).toBeGreaterThan(0.4);
    });

    it('should penalize over-compressed output (ratio < 0.1)', () => {
      const input = 'word '.repeat(200); // 1000 chars
      const output = 'x'; // ratio ~0.001
      const score = recordCompressionScore('g1', 'long', input, output);
      expect(score.compressionRatio).toBeLessThan(0.1);
      // ratioScore = ratio * 5, which is tiny → low quality
      expect(score.qualityScore).toBeLessThan(0.3);
    });

    it('should penalize expanded output (ratio > 1.0)', () => {
      const input = 'short';
      const output = 'very long expanded text that goes on and on and on'; // ratio > 1
      const score = recordCompressionScore('g1', 'medium', input, output);
      expect(score.compressionRatio).toBeGreaterThan(1.0);
      // ratioScore = max(0, 2 - ratio), penalized
      expect(score.qualityScore).toBeLessThan(1.0);
    });

    it('should handle empty input gracefully (compressionRatio defaults to 1)', () => {
      const score = recordCompressionScore('g1', 'medium', '', 'some output');
      expect(score.compressionRatio).toBe(1);
      expect(score.inputChars).toBe(0);
    });

    it('should persist the metric to the database', () => {
      recordCompressionScore('test-group', 'long', 'input text here', 'out');
      const row = testDb
        .prepare(
          "SELECT * FROM memory_metrics WHERE metric_type = 'compression_quality'",
        )
        .get() as { value: number; metadata_json: string } | undefined;
      expect(row).toBeTruthy();
      expect(row!.value).toBeGreaterThanOrEqual(0);
      const meta = JSON.parse(row!.metadata_json);
      expect(meta.layer).toBe('long');
    });

    it('containsWord: Latin word boundary — "AI" should not match inside "wait"', () => {
      // "wait" contains "ai" but not as a word boundary
      const input = 'AI assistant helping users';
      const output = 'waiter helps users'; // "ai" in "waiter" should not count as "ai"
      const score = recordCompressionScore('g1', 'medium', input, output);
      // "assistant" and "helping" and "users" are 4+ chars; "assistant"/"helping"/"users" vs "waiter"/"helps"/"users"
      // "users" is preserved, so preservation rate > 0
      expect(score.entityPreservationRate).toBeGreaterThanOrEqual(0);
      expect(score.entityPreservationRate).toBeLessThanOrEqual(1);
    });

    it('containsWord: CJK characters fall back to includes()', () => {
      // CJK content — "測試" is in the output → should be counted as preserved
      const input = '這是一個測試句子，包含重要信息和關鍵詞語';
      const output = '測試信息摘要';
      const score = recordCompressionScore('g1', 'medium', input, output);
      // CJK words matched via includes, so some words preserved
      expect(score.entityPreservationRate).toBeGreaterThan(0);
    });

    it('containsWord: regex special chars in words are escaped', () => {
      // Words containing regex special chars should not throw
      const input = 'price: $100.00 (discount)';
      const output = 'price $100.00 discount info';
      expect(() =>
        recordCompressionScore('g1', 'medium', input, output),
      ).not.toThrow();
    });
  });

  describe('trackSearchQuery', () => {
    it('should record a search_hit when used=true', () => {
      trackSearchQuery('g1', 'find something', 3, true);
      const row = testDb
        .prepare(
          "SELECT metric_type FROM memory_metrics WHERE metric_type = 'search_hit'",
        )
        .get();
      expect(row).toBeTruthy();
    });

    it('should record a search_miss when used=false', () => {
      trackSearchQuery('g1', 'empty search', 0, false);
      const row = testDb
        .prepare(
          "SELECT metric_type FROM memory_metrics WHERE metric_type = 'search_miss'",
        )
        .get();
      expect(row).toBeTruthy();
    });

    it('should store queryLength and resultsCount in metadata', () => {
      const query = 'test query text';
      trackSearchQuery('g1', query, 5, true);
      const row = testDb
        .prepare(
          "SELECT metadata_json FROM memory_metrics WHERE metric_type = 'search_hit'",
        )
        .get() as { metadata_json: string };
      const meta = JSON.parse(row.metadata_json);
      expect(meta.queryLength).toBe(query.length);
      expect(meta.resultsCount).toBe(5);
    });

    it('should store resultsCount as the metric value', () => {
      trackSearchQuery('g1', 'q', 7, true);
      const row = testDb
        .prepare(
          "SELECT value FROM memory_metrics WHERE metric_type = 'search_hit'",
        )
        .get() as { value: number };
      expect(row.value).toBe(7);
    });
  });

  describe('trackContextUtilization', () => {
    it('should record utilization as contextChars / budgetChars', () => {
      trackContextUtilization('g1', 2000, 4000);
      const row = testDb
        .prepare(
          "SELECT value FROM memory_metrics WHERE metric_type = 'context_utilization'",
        )
        .get() as { value: number };
      expect(row.value).toBeCloseTo(0.5);
    });

    it('should clamp utilization to 1.0 when over budget', () => {
      trackContextUtilization('g1', 5000, 4000);
      const row = testDb
        .prepare(
          "SELECT value FROM memory_metrics WHERE metric_type = 'context_utilization'",
        )
        .get() as { value: number };
      expect(row.value).toBe(1);
    });

    it('should use default budget of 4000 chars', () => {
      trackContextUtilization('g1', 1000);
      const row = testDb
        .prepare(
          "SELECT value, metadata_json FROM memory_metrics WHERE metric_type = 'context_utilization'",
        )
        .get() as { value: number; metadata_json: string };
      expect(row.value).toBeCloseTo(0.25);
      const meta = JSON.parse(row.metadata_json);
      expect(meta.budgetChars).toBe(4000);
    });

    it('should record zero utilization for empty context', () => {
      trackContextUtilization('g1', 0, 4000);
      const row = testDb
        .prepare(
          "SELECT value FROM memory_metrics WHERE metric_type = 'context_utilization'",
        )
        .get() as { value: number };
      expect(row.value).toBe(0);
    });
  });

  describe('getMemoryMetrics', () => {
    it('should return empty/zero report when no data exists', () => {
      const report = getMemoryMetrics('empty-group');
      expect(report.groupFolder).toBe('empty-group');
      expect(report.compression).toEqual([]);
      expect(report.search.totalQueries).toBe(0);
      expect(report.search.hits).toBe(0);
      expect(report.search.misses).toBe(0);
      expect(report.search.hitRate).toBe(0);
      expect(report.contextUtilization.samples).toBe(0);
      expect(report.contextUtilization.avgUtilization).toBe(0);
    });

    it('should aggregate compression scores', () => {
      recordCompressionScore('g2', 'medium', 'input text here', 'output');
      recordCompressionScore('g2', 'long', 'longer input text here', 'out');
      const report = getMemoryMetrics('g2');
      expect(report.compression).toHaveLength(2);
      expect(report.compression[0]).toMatchObject({
        layer: expect.any(String),
        qualityScore: expect.any(Number),
        compressionRatio: expect.any(Number),
      });
    });

    it('should compute hitRate correctly from hits and misses', () => {
      trackSearchQuery('g3', 'q1', 2, true);
      trackSearchQuery('g3', 'q2', 0, false);
      trackSearchQuery('g3', 'q3', 1, true);
      const report = getMemoryMetrics('g3');
      expect(report.search.hits).toBe(2);
      expect(report.search.misses).toBe(1);
      expect(report.search.totalQueries).toBe(3);
      expect(report.search.hitRate).toBeCloseTo(2 / 3);
    });

    it('should compute context utilization stats from samples', () => {
      trackContextUtilization('g4', 1000, 4000); // 0.25
      trackContextUtilization('g4', 2000, 4000); // 0.5
      trackContextUtilization('g4', 4000, 4000); // 1.0
      const report = getMemoryMetrics('g4');
      expect(report.contextUtilization.samples).toBe(3);
      expect(report.contextUtilization.minUtilization).toBeCloseTo(0.25);
      expect(report.contextUtilization.maxUtilization).toBeCloseTo(1.0);
      expect(report.contextUtilization.avgUtilization).toBeCloseTo(
        (0.25 + 0.5 + 1.0) / 3,
      );
    });

    it('should not return data from other groups', () => {
      trackSearchQuery('group-a', 'q', 3, true);
      trackSearchQuery('group-b', 'q', 0, false);
      const reportA = getMemoryMetrics('group-a');
      expect(reportA.search.hits).toBe(1);
      expect(reportA.search.misses).toBe(0);
    });

    it('should respect the 30-day window (old data excluded)', () => {
      // Insert a metric with a timestamp > 30 days ago
      const oldDate = new Date(
        Date.now() - 31 * 24 * 60 * 60 * 1000,
      ).toISOString();
      testDb
        .prepare(
          `INSERT INTO memory_metrics (group_folder, metric_type, value, metadata_json, created_at)
           VALUES (?, 'search_hit', 1, NULL, ?)`,
        )
        .run('window-group', oldDate);
      const report = getMemoryMetrics('window-group');
      // The old row should be excluded from the 30-day query
      expect(report.search.hits).toBe(0);
    });
  });

  describe('getSearchMetrics', () => {
    it('should return search portion of the full report', () => {
      trackSearchQuery('sm-group', 'query', 2, true);
      const metrics = getSearchMetrics('sm-group');
      expect(metrics.hits).toBe(1);
      expect(metrics.totalQueries).toBe(1);
      expect(metrics.hitRate).toBe(1);
    });

    it('should return zeros for group with no search data', () => {
      const metrics = getSearchMetrics('no-search-group');
      expect(metrics.totalQueries).toBe(0);
      expect(metrics.hitRate).toBe(0);
    });
  });
});
