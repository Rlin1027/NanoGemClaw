/**
 * Memory Metrics — Quantitative feedback for memory quality and retrieval.
 *
 * Tracks:
 *   - Compression quality scores after each compaction
 *   - RAG retrieval hit rates for knowledge search queries
 *   - Context utilization (how much of the 4000-char budget is used)
 */

import { getDatabase } from './db/connection.js';
import { logger } from './logger.js';

// ============================================================================
// Types
// ============================================================================

export type MetricType =
  | 'compression_quality'
  | 'search_hit'
  | 'search_miss'
  | 'context_utilization';

export interface MemoryMetric {
  id: number;
  group_folder: string;
  metric_type: MetricType;
  value: number;
  metadata_json: string | null;
  created_at: string;
}

export interface CompressionScore {
  /** Ratio of output length to input length (lower = more compressed) */
  compressionRatio: number;
  /** Estimated fraction of key entities preserved (0–1) */
  entityPreservationRate: number;
  /** Combined quality score (0–1, higher = better) */
  qualityScore: number;
  inputChars: number;
  outputChars: number;
  layer: string;
}

export interface SearchMetrics {
  totalQueries: number;
  hits: number;
  misses: number;
  hitRate: number;
}

export interface ContextUtilizationMetrics {
  avgUtilization: number;
  maxUtilization: number;
  minUtilization: number;
  samples: number;
}

export interface MemoryMetricsReport {
  groupFolder: string;
  compression: CompressionScore[];
  search: SearchMetrics;
  contextUtilization: ContextUtilizationMetrics;
}

// ============================================================================
// Database Init
// ============================================================================

/**
 * Initialize the memory_metrics table (called from initDatabase migration).
 * Safe to call multiple times — uses CREATE TABLE IF NOT EXISTS.
 */
export function initMemoryMetricsTable(): void {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_folder TEXT NOT NULL,
      metric_type TEXT NOT NULL,
      value REAL NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_metrics_group ON memory_metrics(group_folder);
    CREATE INDEX IF NOT EXISTS idx_memory_metrics_type ON memory_metrics(group_folder, metric_type);
    CREATE INDEX IF NOT EXISTS idx_memory_metrics_created ON memory_metrics(created_at);
  `);
}

// ============================================================================
// Helpers
// ============================================================================

/** Word-boundary-aware match. Falls back to includes() for CJK characters. */
function containsWord(word: string, text: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // CJK characters don't have word boundaries — match directly
  if (/[\u4E00-\u9FFF\u3400-\u4DBF]/.test(word)) {
    return text.includes(word);
  }
  return new RegExp(`\\b${escaped}\\b`).test(text);
}

// ============================================================================
// Recording Functions
// ============================================================================

function recordMetric(
  groupFolder: string,
  metricType: MetricType,
  value: number,
  metadata?: Record<string, unknown>,
): void {
  try {
    const db = getDatabase();
    const now = new Date().toISOString();
    const metaStr = metadata ? JSON.stringify(metadata) : null;
    db.prepare(
      `INSERT INTO memory_metrics (group_folder, metric_type, value, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(groupFolder, metricType, value, metaStr, now);
  } catch (err) {
    logger.debug(
      {
        groupFolder,
        metricType,
        err: err instanceof Error ? err.message : String(err),
      },
      'Failed to record memory metric',
    );
  }
}

/**
 * Score compression quality and persist the metric.
 * Called after each compaction (short→medium or medium→long).
 *
 * Quality score heuristic:
 *   - Ideal compression ratio: 0.3–0.7 (too low loses info, too high means no compression)
 *   - Entity preservation is estimated from keyword overlap between input and output
 */
export function recordCompressionScore(
  groupFolder: string,
  layer: 'medium' | 'long',
  inputContent: string,
  outputContent: string,
): CompressionScore {
  const inputChars = inputContent.length;
  const outputChars = outputContent.length;

  const compressionRatio = inputChars > 0 ? outputChars / inputChars : 1;

  // Estimate entity preservation: fraction of 4+ char words from input found in output
  const inputWords = new Set(
    inputContent
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length >= 4),
  );
  const outputLower = outputContent.toLowerCase();
  let preserved = 0;
  for (const word of inputWords) {
    if (containsWord(word, outputLower)) preserved++;
  }
  const entityPreservationRate =
    inputWords.size > 0 ? preserved / inputWords.size : 1;

  // Quality score: penalize extreme ratios, reward high entity preservation
  const ratioScore =
    compressionRatio < 0.1
      ? compressionRatio * 5 // too compressed
      : compressionRatio > 1.0
        ? Math.max(0, 2 - compressionRatio) // expanded, penalize
        : 1 - Math.abs(compressionRatio - 0.5) * 0.8; // ideal range ~0.3–0.7

  const qualityScore = Math.min(
    1,
    Math.max(0, ratioScore * 0.4 + entityPreservationRate * 0.6),
  );

  const score: CompressionScore = {
    compressionRatio,
    entityPreservationRate,
    qualityScore,
    inputChars,
    outputChars,
    layer,
  };

  recordMetric(groupFolder, 'compression_quality', qualityScore, {
    layer,
    compressionRatio,
    entityPreservationRate,
    inputChars,
    outputChars,
  });

  logger.debug(
    {
      groupFolder,
      layer,
      qualityScore: qualityScore.toFixed(3),
      compressionRatio: compressionRatio.toFixed(3),
    },
    'Compression quality scored',
  );

  return score;
}

/**
 * Track a search query result — call with used=true if the results were
 * incorporated into the response, false if results were empty or discarded.
 */
export function trackSearchQuery(
  groupFolder: string,
  query: string,
  resultsCount: number,
  used: boolean,
): void {
  const metricType: MetricType = used ? 'search_hit' : 'search_miss';
  recordMetric(groupFolder, metricType, resultsCount, {
    queryLength: query.length,
    resultsCount,
  });
}

/**
 * Track context utilization: what fraction of the 4000-char budget was used.
 */
export function trackContextUtilization(
  groupFolder: string,
  contextChars: number,
  budgetChars = 4000,
): void {
  const utilization = Math.min(1, contextChars / budgetChars);
  recordMetric(groupFolder, 'context_utilization', utilization, {
    contextChars,
    budgetChars,
  });
}

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Get aggregated memory metrics for a group.
 * Returns compression scores, search hit rate, and context utilization.
 */
export function getMemoryMetrics(groupFolder: string): MemoryMetricsReport {
  const db = getDatabase();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Compression scores (last 30 days)
  const compressionRows = db
    .prepare(
      `SELECT value, metadata_json FROM memory_metrics
       WHERE group_folder = ? AND metric_type = 'compression_quality' AND created_at > ?
       ORDER BY created_at DESC LIMIT 50`,
    )
    .all(groupFolder, since) as Array<{
    value: number;
    metadata_json: string | null;
  }>;

  const compression: CompressionScore[] = compressionRows.map((row) => {
    const meta = row.metadata_json
      ? (JSON.parse(row.metadata_json) as Record<string, unknown>)
      : {};
    return {
      qualityScore: row.value,
      layer: (meta['layer'] as string) || 'unknown',
      compressionRatio: (meta['compressionRatio'] as number) || 0,
      entityPreservationRate: (meta['entityPreservationRate'] as number) || 0,
      inputChars: (meta['inputChars'] as number) || 0,
      outputChars: (meta['outputChars'] as number) || 0,
    };
  });

  // Search hit rate
  const { hits } = db
    .prepare(
      `SELECT COUNT(*) as hits FROM memory_metrics
       WHERE group_folder = ? AND metric_type = 'search_hit' AND created_at > ?`,
    )
    .get(groupFolder, since) as { hits: number };

  const { misses } = db
    .prepare(
      `SELECT COUNT(*) as misses FROM memory_metrics
       WHERE group_folder = ? AND metric_type = 'search_miss' AND created_at > ?`,
    )
    .get(groupFolder, since) as { misses: number };

  const totalQueries = hits + misses;
  const search: SearchMetrics = {
    totalQueries,
    hits,
    misses,
    hitRate: totalQueries > 0 ? hits / totalQueries : 0,
  };

  // Context utilization
  const utilizationRows = db
    .prepare(
      `SELECT value FROM memory_metrics
       WHERE group_folder = ? AND metric_type = 'context_utilization' AND created_at > ?
       ORDER BY created_at DESC LIMIT 100`,
    )
    .all(groupFolder, since) as Array<{ value: number }>;

  let contextUtilization: ContextUtilizationMetrics;
  if (utilizationRows.length === 0) {
    contextUtilization = {
      avgUtilization: 0,
      maxUtilization: 0,
      minUtilization: 0,
      samples: 0,
    };
  } else {
    const vals = utilizationRows.map((r) => r.value);
    contextUtilization = {
      avgUtilization: vals.reduce((a, b) => a + b, 0) / vals.length,
      maxUtilization: Math.max(...vals),
      minUtilization: Math.min(...vals),
      samples: vals.length,
    };
  }

  return { groupFolder, compression, search, contextUtilization };
}

/**
 * Get search metrics only (lightweight query).
 */
export function getSearchMetrics(groupFolder: string): SearchMetrics {
  return getMemoryMetrics(groupFolder).search;
}
