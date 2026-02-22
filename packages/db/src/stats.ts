import { getDatabase } from './connection.js';

// ============================================================================
// Usage Analytics
// ============================================================================

export interface UsageEntry {
  group_folder: string;
  timestamp: string;
  prompt_tokens?: number;
  response_tokens?: number;
  duration_ms: number;
  model?: string;
  is_scheduled_task?: boolean;
}

export function logUsage(entry: UsageEntry): void {
  const db = getDatabase();
  db.prepare(
    `INSERT INTO usage_stats (group_folder, timestamp, prompt_tokens, response_tokens, duration_ms, model, is_scheduled_task)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.group_folder,
    entry.timestamp,
    entry.prompt_tokens ?? null,
    entry.response_tokens ?? null,
    entry.duration_ms,
    entry.model ?? null,
    entry.is_scheduled_task ? 1 : 0,
  );
}

export interface UsageStats {
  total_requests: number;
  total_duration_ms: number;
  avg_duration_ms: number;
  total_prompt_tokens: number;
  total_response_tokens: number;
}

export function getUsageStats(
  groupFolder?: string,
  since?: string,
): UsageStats {
  const db = getDatabase();
  let query = `
    SELECT
      COUNT(*) as total_requests,
      COALESCE(SUM(duration_ms), 0) as total_duration_ms,
      COALESCE(AVG(duration_ms), 0) as avg_duration_ms,
      COALESCE(SUM(prompt_tokens), 0) as total_prompt_tokens,
      COALESCE(SUM(response_tokens), 0) as total_response_tokens
    FROM usage_stats
    WHERE 1=1
  `;

  const params: (string | undefined)[] = [];

  if (groupFolder) {
    query += ' AND group_folder = ?';
    params.push(groupFolder);
  }

  if (since) {
    query += ' AND timestamp > ?';
    params.push(since);
  }

  return db.prepare(query).get(...params) as UsageStats;
}

export function getRecentUsage(limit = 20): UsageEntry[] {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT group_folder, timestamp, prompt_tokens, response_tokens, duration_ms, model, is_scheduled_task
       FROM usage_stats ORDER BY timestamp DESC LIMIT ?`,
    )
    .all(limit) as UsageEntry[];
}

export interface UsageTimeseriesEntry {
  bucket: string;
  requests: number;
  prompt_tokens: number;
  response_tokens: number;
  avg_duration_ms: number;
}

export function getUsageTimeseries(
  period: string = '7d',
  granularity: string = 'day',
  groupFolder?: string,
): UsageTimeseriesEntry[] {
  const db = getDatabase();
  // Calculate the since date from period (e.g., '7d' = 7 days ago, '30d' = 30 days ago, '1d' = today)
  const days = parseInt(period) || 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // Determine strftime format based on granularity
  const fmt = granularity === 'hour' ? '%Y-%m-%d %H:00' : '%Y-%m-%d';

  let query = `
    SELECT strftime('${fmt}', timestamp) as bucket,
           COUNT(*) as requests,
           COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
           COALESCE(SUM(response_tokens), 0) as response_tokens,
           COALESCE(AVG(duration_ms), 0) as avg_duration_ms
    FROM usage_stats
    WHERE timestamp > ?
  `;
  const params: string[] = [since];

  if (groupFolder) {
    query += ' AND group_folder = ?';
    params.push(groupFolder);
  }

  query += ` GROUP BY bucket ORDER BY bucket`;

  return db.prepare(query).all(...params) as UsageTimeseriesEntry[];
}

export interface UsageByGroupEntry {
  group_folder: string;
  requests: number;
  prompt_tokens: number;
  response_tokens: number;
  avg_duration_ms: number;
}

export function getUsageByGroup(since?: string): UsageByGroupEntry[] {
  const db = getDatabase();
  let query = `
    SELECT group_folder,
           COUNT(*) as requests,
           COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
           COALESCE(SUM(response_tokens), 0) as response_tokens,
           COALESCE(AVG(duration_ms), 0) as avg_duration_ms
    FROM usage_stats
  `;
  const params: string[] = [];

  if (since) {
    query += ' WHERE timestamp > ?';
    params.push(since);
  }

  query += ' GROUP BY group_folder ORDER BY requests DESC';

  return db.prepare(query).all(...params) as UsageByGroupEntry[];
}

/** Get usage timeseries data for charts (daily aggregation) */
export function getUsageTimeseriesDaily(days: number = 30): Array<{
  date: string;
  request_count: number;
  total_tokens: number;
  avg_response_ms: number;
}> {
  const db = getDatabase();
  return db.prepare(`
    SELECT
      date(timestamp) as date,
      COUNT(*) as request_count,
      COALESCE(SUM(prompt_tokens + response_tokens), 0) as total_tokens,
      COALESCE(AVG(duration_ms), 0) as avg_response_ms
    FROM usage_stats
    WHERE timestamp >= datetime('now', ?)
    GROUP BY date(timestamp)
    ORDER BY date ASC
  `).all(`-${days} days`) as any[];
}

/** Get per-group token consumption ranking */
export function getGroupTokenRanking(limit: number = 10): Array<{
  group_folder: string;
  total_tokens: number;
  request_count: number;
  avg_tokens_per_request: number;
}> {
  const db = getDatabase();
  return db.prepare(`
    SELECT
      group_folder,
      COALESCE(SUM(prompt_tokens + response_tokens), 0) as total_tokens,
      COUNT(*) as request_count,
      COALESCE(AVG(prompt_tokens + response_tokens), 0) as avg_tokens_per_request
    FROM usage_stats
    GROUP BY group_folder
    ORDER BY total_tokens DESC
    LIMIT ?
  `).all(limit) as any[];
}

/** Get response time percentiles (P50/P95) */
export function getResponseTimePercentiles(): {
  p50: number;
  p95: number;
  avg: number;
  count: number;
} {
  const db = getDatabase();
  const count = (db.prepare('SELECT COUNT(*) as cnt FROM usage_stats WHERE duration_ms IS NOT NULL').get() as any)?.cnt || 0;
  if (count === 0) return { p50: 0, p95: 0, avg: 0, count: 0 };

  const p50Idx = Math.floor(count * 0.5);
  const p95Idx = Math.floor(count * 0.95);

  const p50 = (db.prepare('SELECT duration_ms FROM usage_stats WHERE duration_ms IS NOT NULL ORDER BY duration_ms ASC LIMIT 1 OFFSET ?').get(p50Idx) as any)?.duration_ms || 0;
  const p95 = (db.prepare('SELECT duration_ms FROM usage_stats WHERE duration_ms IS NOT NULL ORDER BY duration_ms ASC LIMIT 1 OFFSET ?').get(p95Idx) as any)?.duration_ms || 0;
  const avg = (db.prepare('SELECT AVG(duration_ms) as avg FROM usage_stats WHERE duration_ms IS NOT NULL').get() as any)?.avg || 0;

  return { p50: Math.round(p50), p95: Math.round(p95), avg: Math.round(avg), count };
}

/** Get error rate timeseries */
export function getErrorRateTimeseries(days: number = 30): Array<{
  date: string;
  total: number;
  errors: number;
  error_rate: number;
}> {
  const db = getDatabase();
  // Note: usage_stats doesn't have a status column currently, so we'll create a placeholder structure
  // This will return data once the table schema is extended
  return db.prepare(`
    SELECT
      date(timestamp) as date,
      COUNT(*) as total,
      0 as errors,
      0.0 as error_rate
    FROM usage_stats
    WHERE timestamp >= datetime('now', ?)
    GROUP BY date(timestamp)
    ORDER BY date ASC
  `).all(`-${days} days`) as any[];
}

// ============================================================================
// Error Tracking
// ============================================================================

interface ErrorState {
  consecutiveFailures: number;
  lastAlertSent: string | null;
  lastError: string | null;
}

const errorStates = new Map<string, ErrorState>();

export function recordError(groupFolder: string, error: string): ErrorState {
  const state = errorStates.get(groupFolder) || {
    consecutiveFailures: 0,
    lastAlertSent: null,
    lastError: null,
  };

  state.consecutiveFailures++;
  state.lastError = error;
  errorStates.set(groupFolder, state);

  return state;
}

export function resetErrors(groupFolder: string): void {
  const state = errorStates.get(groupFolder);
  if (state) {
    state.consecutiveFailures = 0;
    state.lastError = null;
  }
}

export function getErrorState(groupFolder: string): ErrorState | null {
  return errorStates.get(groupFolder) || null;
}

export function markAlertSent(groupFolder: string): void {
  const state = errorStates.get(groupFolder);
  if (state) {
    state.lastAlertSent = new Date().toISOString();
  }
}

export function getAllErrorStates(): { group: string; state: ErrorState }[] {
  return Array.from(errorStates.entries()).map(([group, state]) => ({
    group,
    state,
  }));
}

// ============================================================================
// Rate Limiting (Sliding Window)
// ============================================================================

interface RateLimitWindow {
  timestamps: number[];
}

const rateLimitWindows = new Map<string, RateLimitWindow>();

/**
 * Check if a request is rate limited using sliding window algorithm.
 * Returns { allowed: boolean, remaining: number, resetIn: number }
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; remaining: number; resetInMs: number } {
  const now = Date.now();
  const windowStart = now - windowMs;

  let window = rateLimitWindows.get(key);
  if (!window) {
    window = { timestamps: [] };
    rateLimitWindows.set(key, window);
  }

  // Remove timestamps outside the window
  window.timestamps = window.timestamps.filter((ts) => ts > windowStart);

  // Clean up inactive keys with no recent timestamps
  if (window.timestamps.length === 0) {
    rateLimitWindows.delete(key);
    return { allowed: true, remaining: maxRequests, resetInMs: 0 };
  }

  // Check if limit exceeded
  if (window.timestamps.length >= maxRequests) {
    const oldestInWindow = window.timestamps[0];
    const resetInMs = oldestInWindow + windowMs - now;
    return {
      allowed: false,
      remaining: 0,
      resetInMs: Math.max(0, resetInMs),
    };
  }

  // Add current timestamp and allow
  window.timestamps.push(now);
  return {
    allowed: true,
    remaining: maxRequests - window.timestamps.length,
    resetInMs: windowMs,
  };
}

/**
 * Get rate limit status for a key without incrementing
 */
export function getRateLimitStatus(
  key: string,
  maxRequests: number,
  windowMs: number,
): { count: number; remaining: number; resetInMs: number } {
  const now = Date.now();
  const windowStart = now - windowMs;

  const window = rateLimitWindows.get(key);
  if (!window) {
    return { count: 0, remaining: maxRequests, resetInMs: windowMs };
  }

  const activeTimestamps = window.timestamps.filter((ts) => ts > windowStart);
  const count = activeTimestamps.length;

  const resetInMs =
    activeTimestamps.length > 0
      ? activeTimestamps[0] + windowMs - now
      : windowMs;

  return {
    count,
    remaining: Math.max(0, maxRequests - count),
    resetInMs: Math.max(0, resetInMs),
  };
}
