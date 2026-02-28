/**
 * Facts CRUD — Structured knowledge extracted from conversations.
 *
 * Facts are key-value pairs per group, e.g. { key: 'user_name', value: '小明' }.
 * Sources: 'extracted' (regex), 'user_set' (via remember_fact tool), 'inferred'.
 */

import { getDatabase } from './connection.js';

export interface Fact {
  id: number;
  group_folder: string;
  key: string;
  value: string;
  source: string;
  confidence: number;
  created_at: string;
  updated_at: string;
}

/**
 * Insert or update a fact for a group.
 * Uses UPSERT (INSERT ... ON CONFLICT UPDATE) for idempotency.
 */
export function upsertFact(
  groupFolder: string,
  key: string,
  value: string,
  source: string = 'extracted',
  confidence: number = 0.8,
): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO facts (group_folder, key, value, source, confidence, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(group_folder, key) DO UPDATE SET
      value = excluded.value,
      source = excluded.source,
      confidence = excluded.confidence,
      updated_at = excluded.updated_at
  `,
  ).run(groupFolder, key, value, source, confidence, now, now);
}

/**
 * Get all facts for a group, ordered by key.
 */
export function getFacts(groupFolder: string): Fact[] {
  const db = getDatabase();
  return db
    .prepare('SELECT * FROM facts WHERE group_folder = ? ORDER BY key')
    .all(groupFolder) as Fact[];
}

/**
 * Delete a single fact by group + key.
 * Returns true if a row was deleted.
 */
export function deleteFact(groupFolder: string, key: string): boolean {
  const db = getDatabase();
  const result = db
    .prepare('DELETE FROM facts WHERE group_folder = ? AND key = ?')
    .run(groupFolder, key);
  return result.changes > 0;
}

/**
 * Delete all facts for a group.
 * Used during group unregistration cleanup.
 * Returns the number of facts deleted.
 */
export function deleteFactsByGroup(groupFolder: string): number {
  const db = getDatabase();
  const result = db
    .prepare('DELETE FROM facts WHERE group_folder = ?')
    .run(groupFolder);
  return result.changes;
}
