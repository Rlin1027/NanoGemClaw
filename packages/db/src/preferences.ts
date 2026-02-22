import { getDatabase } from './connection.js';

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
  const db = getDatabase();
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
  const db = getDatabase();
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

// ============================================================================
// User Preferences
// ============================================================================

/**
 * Get all preferences for a group as a key-value object
 */
export function getPreferences(groupFolder: string): Record<string, string> {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT key, value FROM preferences WHERE group_folder = ?')
    .all(groupFolder) as { key: string; value: string }[];

  const prefs: Record<string, string> = {};
  for (const row of rows) {
    prefs[row.key] = row.value;
  }
  return prefs;
}

/**
 * Set a single preference for a group
 */
export function setPreference(groupFolder: string, key: string, value: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO preferences (group_folder, key, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(group_folder, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(groupFolder, key, value, now);
}

/**
 * Get a single preference value for a group (convenience wrapper)
 */
export function getUserPreference(groupFolder: string, key: string): string | null {
  const prefs = getPreferences(groupFolder);
  return prefs[key] || null;
}

/**
 * Set a single preference for a group (convenience wrapper)
 */
export function setUserPreference(groupFolder: string, key: string, value: string): void {
  setPreference(groupFolder, key, value);
}
