import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { STORE_DIR } from './config.js';
import { NewMessage, ScheduledTask, TaskRunLog } from './types.js';

let db: Database.Database;

export function initDatabase(): void {
  const dbPath = path.join(STORE_DIR, 'messages.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      jid TEXT PRIMARY KEY,
      name TEXT,
      last_message_time TEXT
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT,
      chat_jid TEXT,
      sender TEXT,
      sender_name TEXT,
      content TEXT,
      timestamp TEXT,
      is_from_me INTEGER,
      PRIMARY KEY (id, chat_jid),
      FOREIGN KEY (chat_jid) REFERENCES chats(jid)
    );
    CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp);

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      group_folder TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule_type TEXT NOT NULL,
      schedule_value TEXT NOT NULL,
      next_run TEXT,
      last_run TEXT,
      last_result TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_next_run ON scheduled_tasks(next_run);
    CREATE INDEX IF NOT EXISTS idx_status ON scheduled_tasks(status);

    CREATE TABLE IF NOT EXISTS task_run_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      run_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      result TEXT,
      error TEXT,
      FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
    );
    CREATE INDEX IF NOT EXISTS idx_task_run_logs ON task_run_logs(task_id, run_at);

    CREATE TABLE IF NOT EXISTS usage_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_folder TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      prompt_tokens INTEGER,
      response_tokens INTEGER,
      duration_ms INTEGER NOT NULL,
      model TEXT,
      is_scheduled_task INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_usage_stats_group ON usage_stats(group_folder);
    CREATE INDEX IF NOT EXISTS idx_usage_stats_timestamp ON usage_stats(timestamp);

    CREATE TABLE IF NOT EXISTS memory_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_folder TEXT NOT NULL UNIQUE,
      summary TEXT NOT NULL,
      messages_archived INTEGER NOT NULL,
      chars_archived INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_summaries_group ON memory_summaries(group_folder);
  `);

  // Add sender_name column if it doesn't exist (migration for existing DBs)
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN sender_name TEXT`);
  } catch {
    /* column already exists */
  }

  // Add context_mode column if it doesn't exist (migration for existing DBs)
  try {
    db.exec(
      `ALTER TABLE scheduled_tasks ADD COLUMN context_mode TEXT DEFAULT 'isolated'`,
    );
  } catch {
    /* column already exists */
  }
}

/**
 * Close the database connection gracefully.
 * Should be called during application shutdown.
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
  }
}

/**
 * Store chat metadata only (no message content).
 * Used for all chats to enable group discovery without storing sensitive content.
 */
export function storeChatMetadata(
  chatJid: string,
  timestamp: string,
  name?: string,
): void {
  if (name) {
    // Update with name, preserving existing timestamp if newer
    db.prepare(
      `
      INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        name = excluded.name,
        last_message_time = MAX(last_message_time, excluded.last_message_time)
    `,
    ).run(chatJid, name, timestamp);
  } else {
    // Update timestamp only, preserve existing name if any
    db.prepare(
      `
      INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
      ON CONFLICT(jid) DO UPDATE SET
        last_message_time = MAX(last_message_time, excluded.last_message_time)
    `,
    ).run(chatJid, chatJid, timestamp);
  }
}

/**
 * Update chat name without changing timestamp for existing chats.
 * New chats get the current time as their initial timestamp.
 * Used during group metadata sync.
 */
export function updateChatName(chatJid: string, name: string): void {
  db.prepare(
    `
    INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
    ON CONFLICT(jid) DO UPDATE SET name = excluded.name
  `,
  ).run(chatJid, name, new Date().toISOString());
}

export interface ChatInfo {
  jid: string;
  name: string;
  last_message_time: string;
}

/**
 * Get all known chats, ordered by most recent activity.
 */
export function getAllChats(): ChatInfo[] {
  return db
    .prepare(
      `
    SELECT jid, name, last_message_time
    FROM chats
    ORDER BY last_message_time DESC
  `,
    )
    .all() as ChatInfo[];
}

/**
 * Get timestamp of last group metadata sync.
 */
export function getLastGroupSync(): string | null {
  // Store sync time in a special chat entry
  const row = db
    .prepare(`SELECT last_message_time FROM chats WHERE jid = '__group_sync__'`)
    .get() as { last_message_time: string } | undefined;
  return row?.last_message_time || null;
}

/**
 * Record that group metadata was synced.
 */
export function setLastGroupSync(): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR REPLACE INTO chats (jid, name, last_message_time) VALUES ('__group_sync__', '__group_sync__', ?)`,
  ).run(now);
}

/**
 * Store a message with full content.
 * Only call this for registered groups where message history is needed.
 * Works with any messaging platform (Telegram, etc.)
 */
export function storeMessage(
  msgId: string,
  chatId: string,
  senderId: string,
  senderName: string,
  content: string,
  timestamp: string,
  isFromMe: boolean,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    msgId,
    chatId,
    senderId,
    senderName,
    content,
    timestamp,
    isFromMe ? 1 : 0,
  );
}

export function getNewMessages(
  jids: string[],
  lastTimestamp: string,
  botPrefix: string,
): { messages: NewMessage[]; newTimestamp: string } {
  if (jids.length === 0) return { messages: [], newTimestamp: lastTimestamp };

  const placeholders = jids.map(() => '?').join(',');
  // Filter out bot's own messages by checking content prefix (not is_from_me, since user shares the account)
  const sql = `
    SELECT id, chat_jid, sender, sender_name, content, timestamp
    FROM messages
    WHERE timestamp > ? AND chat_jid IN (${placeholders}) AND content NOT LIKE ?
    ORDER BY timestamp
  `;

  const rows = db
    .prepare(sql)
    .all(lastTimestamp, ...jids, `${botPrefix}:%`) as NewMessage[];

  let newTimestamp = lastTimestamp;
  for (const row of rows) {
    if (row.timestamp > newTimestamp) newTimestamp = row.timestamp;
  }

  return { messages: rows, newTimestamp };
}

export function getMessagesSince(
  chatJid: string,
  sinceTimestamp: string,
  botPrefix: string,
): NewMessage[] {
  // Filter out bot's own messages by checking content prefix
  const sql = `
    SELECT id, chat_jid, sender, sender_name, content, timestamp
    FROM messages
    WHERE chat_jid = ? AND timestamp > ? AND content NOT LIKE ?
    ORDER BY timestamp
  `;
  return db
    .prepare(sql)
    .all(chatJid, sinceTimestamp, `${botPrefix}:%`) as NewMessage[];
}

/**
 * Get a specific message by ID and chat JID.
 */
export function getMessageById(
  chatId: string,
  msgId: string,
): NewMessage | undefined {
  return db
    .prepare('SELECT * FROM messages WHERE chat_jid = ? AND id = ?')
    .get(chatId, msgId) as NewMessage | undefined;
}

export function createTask(
  task: Omit<ScheduledTask, 'last_run' | 'last_result'>,
): void {
  db.prepare(
    `
    INSERT INTO scheduled_tasks (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, context_mode, next_run, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    task.id,
    task.group_folder,
    task.chat_jid,
    task.prompt,
    task.schedule_type,
    task.schedule_value,
    task.context_mode || 'isolated',
    task.next_run,
    task.status,
    task.created_at,
  );
}

export function getTaskById(id: string): ScheduledTask | undefined {
  return db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as
    | ScheduledTask
    | undefined;
}

export function getTasksForGroup(groupFolder: string): ScheduledTask[] {
  return db
    .prepare(
      'SELECT * FROM scheduled_tasks WHERE group_folder = ? ORDER BY created_at DESC',
    )
    .all(groupFolder) as ScheduledTask[];
}

export function getAllTasks(): ScheduledTask[] {
  return db
    .prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC')
    .all() as ScheduledTask[];
}

export function updateTask(
  id: string,
  updates: Partial<
    Pick<
      ScheduledTask,
      'prompt' | 'schedule_type' | 'schedule_value' | 'next_run' | 'status'
    >
  >,
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.prompt !== undefined) {
    fields.push('prompt = ?');
    values.push(updates.prompt);
  }
  if (updates.schedule_type !== undefined) {
    fields.push('schedule_type = ?');
    values.push(updates.schedule_type);
  }
  if (updates.schedule_value !== undefined) {
    fields.push('schedule_value = ?');
    values.push(updates.schedule_value);
  }
  if (updates.next_run !== undefined) {
    fields.push('next_run = ?');
    values.push(updates.next_run);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }

  if (fields.length === 0) return;

  values.push(id);
  db.prepare(
    `UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = ?`,
  ).run(...values);
}

export function deleteTask(id: string): void {
  // Delete child records first (FK constraint)
  const deleteTx = db.transaction((taskId: string) => {
    db.prepare('DELETE FROM task_run_logs WHERE task_id = ?').run(taskId);
    db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(taskId);
  });
  deleteTx(id);
}

export function getDueTasks(): ScheduledTask[] {
  const now = new Date().toISOString();
  return db
    .prepare(
      `
    SELECT * FROM scheduled_tasks
    WHERE status = 'active' AND next_run IS NOT NULL AND next_run <= ?
    ORDER BY next_run
  `,
    )
    .all(now) as ScheduledTask[];
}

export function updateTaskAfterRun(
  id: string,
  nextRun: string | null,
  lastResult: string,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE scheduled_tasks
    SET next_run = ?, last_run = ?, last_result = ?, status = CASE WHEN ? IS NULL THEN 'completed' ELSE status END
    WHERE id = ?
  `,
  ).run(nextRun, now, lastResult, nextRun, id);
}

export function logTaskRun(log: TaskRunLog): void {
  db.prepare(
    `
    INSERT INTO task_run_logs (task_id, run_at, duration_ms, status, result, error)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(
    log.task_id,
    log.run_at,
    log.duration_ms,
    log.status,
    log.result,
    log.error,
  );
}

export function getTaskRunLogs(taskId: string, limit = 10): TaskRunLog[] {
  return db
    .prepare(
      `
    SELECT task_id, run_at, duration_ms, status, result, error
    FROM task_run_logs
    WHERE task_id = ?
    ORDER BY run_at DESC
    LIMIT ?
  `,
    )
    .all(taskId, limit) as TaskRunLog[];
}

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

// ============================================================================
// Memory Summaries
// ============================================================================

export interface MemorySummary {
  group_folder: string;
  summary: string;
  messages_archived: number;
  chars_archived: number;
  created_at: string;
  updated_at: string;
}

export function getMemorySummary(groupFolder: string): MemorySummary | null {
  return db
    .prepare('SELECT * FROM memory_summaries WHERE group_folder = ?')
    .get(groupFolder) as MemorySummary | null;
}

export function upsertMemorySummary(
  groupFolder: string,
  summary: string,
  messagesArchived: number,
  charsArchived: number,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO memory_summaries (group_folder, summary, messages_archived, chars_archived, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(group_folder) DO UPDATE SET
      summary = excluded.summary,
      messages_archived = memory_summaries.messages_archived + excluded.messages_archived,
      chars_archived = memory_summaries.chars_archived + excluded.chars_archived,
      updated_at = excluded.updated_at
  `,
  ).run(groupFolder, summary, messagesArchived, charsArchived, now, now);
}

export interface GroupMessageStats {
  chat_jid: string;
  message_count: number;
  total_chars: number;
  oldest_timestamp: string;
  newest_timestamp: string;
}

export function getGroupMessageStats(
  chatJid: string,
): GroupMessageStats | null {
  return db
    .prepare(
      `
      SELECT 
        chat_jid,
        COUNT(*) as message_count,
        SUM(LENGTH(content)) as total_chars,
        MIN(timestamp) as oldest_timestamp,
        MAX(timestamp) as newest_timestamp
      FROM messages
      WHERE chat_jid = ?
      GROUP BY chat_jid
    `,
    )
    .get(chatJid) as GroupMessageStats | null;
}

export function getMessagesForSummary(
  chatJid: string,
  limit: number = 100,
): { sender_name: string; content: string; timestamp: string }[] {
  return db
    .prepare(
      `
      SELECT sender_name, content, timestamp
      FROM messages
      WHERE chat_jid = ?
      ORDER BY timestamp ASC
      LIMIT ?
    `,
    )
    .all(chatJid, limit) as {
    sender_name: string;
    content: string;
    timestamp: string;
  }[];
}

export function deleteOldMessages(
  chatJid: string,
  beforeTimestamp: string,
): number {
  const result = db
    .prepare('DELETE FROM messages WHERE chat_jid = ? AND timestamp < ?')
    .run(chatJid, beforeTimestamp);
  return result.changes;
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
