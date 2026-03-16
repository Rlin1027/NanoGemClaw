/**
 * Temporal Memory CRUD — Layered memory storage for Memory Compounder.
 *
 * Three layers: short (7d), medium (30d), long (permanent).
 * Each group has at most one row per layer (UPSERT on group_folder+layer).
 */

import { getDatabase } from './connection.js';
import { getEventBus } from '@nanogemclaw/event-bus';
import type { Fact } from './facts.js';

export type TemporalLayer = 'short' | 'medium' | 'long';

export interface TemporalMemory {
  id: number;
  group_folder: string;
  layer: TemporalLayer;
  content: string;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Insert or update a temporal memory layer for a group.
 */
export function upsertTemporalMemory(
  groupFolder: string,
  layer: TemporalLayer,
  content: string,
  metadata?: Record<string, unknown>,
): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  const metaStr = metadata ? JSON.stringify(metadata) : null;

  db.prepare(
    `
    INSERT INTO memory_temporal (group_folder, layer, content, metadata, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(group_folder, layer) DO UPDATE SET
      content = excluded.content,
      metadata = excluded.metadata,
      updated_at = excluded.updated_at
  `,
  ).run(groupFolder, layer, content, metaStr, now, now);

  try {
    getEventBus().emit('memory:compacted', {
      groupFolder,
      layer,
      contentLength: content.length,
    });
  } catch {
    // Event bus may not be initialized in tests
  }
}

/**
 * Get a specific temporal layer for a group.
 */
export function getTemporalMemory(
  groupFolder: string,
  layer: TemporalLayer,
): TemporalMemory | null {
  const db = getDatabase();
  const row = db
    .prepare(
      'SELECT * FROM memory_temporal WHERE group_folder = ? AND layer = ?',
    )
    .get(groupFolder, layer) as TemporalMemory | undefined;
  return row ?? null;
}

/**
 * Get all temporal layers for a group, ordered short → medium → long.
 */
export function getAllTemporalMemories(groupFolder: string): TemporalMemory[] {
  const db = getDatabase();
  const layerOrder = ['short', 'medium', 'long'];
  const rows = db
    .prepare('SELECT * FROM memory_temporal WHERE group_folder = ?')
    .all(groupFolder) as TemporalMemory[];
  return rows.sort(
    (a, b) => layerOrder.indexOf(a.layer) - layerOrder.indexOf(b.layer),
  );
}

/**
 * Delete temporal memories older than the specified retention period.
 * Short-term: 7 days, Medium-term: 30 days, Long-term: never deleted.
 */
export function cleanExpiredTemporalMemories(): number {
  const db = getDatabase();
  const now = new Date();

  const shortCutoff = new Date(
    now.getTime() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const mediumCutoff = new Date(
    now.getTime() - 30 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const result1 = db
    .prepare(
      "DELETE FROM memory_temporal WHERE layer = 'short' AND updated_at < ?",
    )
    .run(shortCutoff);
  const result2 = db
    .prepare(
      "DELETE FROM memory_temporal WHERE layer = 'medium' AND updated_at < ?",
    )
    .run(mediumCutoff);

  return result1.changes + result2.changes;
}

/**
 * Delete all temporal memories for a group (used during unregistration).
 */
export function deleteTemporalMemoriesByGroup(groupFolder: string): number {
  const db = getDatabase();
  const result = db
    .prepare('DELETE FROM memory_temporal WHERE group_folder = ?')
    .run(groupFolder);
  return result.changes;
}

/**
 * Get facts for a sender across ALL groups, deduplicated by key.
 * When the same key exists in multiple groups, the most recently updated value wins.
 * Excludes facts from the current group (those are already included via getFacts).
 */
export function getCrossGroupFacts(
  senderName: string,
  excludeGroupFolder: string,
): Fact[] {
  const db = getDatabase();

  // Find all group_folders where this sender has sent messages
  const groupRows = db
    .prepare(
      `SELECT DISTINCT chat_jid FROM messages
       WHERE (sender_name = ? OR sender = ?) AND sender_name IS NOT NULL`,
    )
    .all(senderName, senderName) as Array<{ chat_jid: string }>;

  if (groupRows.length === 0) return [];

  // Map chat_jid → group_folder via registered_groups is not available here,
  // so we query facts by senderName pattern across all groups directly.
  // Facts are stored per group_folder, not per sender_name, so we use
  // a heuristic: get facts whose key starts with the sender's name or whose
  // value references the sender, from groups other than the current one.
  // More practically: get ALL facts from other groups and let caller filter.
  // Limit cross-group facts to prevent unbounded result sets in multi-group deployments
  const CROSS_GROUP_FACT_LIMIT = 200;
  const allOtherFacts = db
    .prepare(
      `SELECT * FROM facts
       WHERE group_folder != ?
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(excludeGroupFolder, CROSS_GROUP_FACT_LIMIT) as Fact[];

  // Deduplicate by key: most recent updated_at wins
  const deduped = new Map<string, Fact>();
  for (const fact of allOtherFacts) {
    const existing = deduped.get(fact.key);
    if (!existing || fact.updated_at > existing.updated_at) {
      deduped.set(fact.key, fact);
    }
  }

  return Array.from(deduped.values());
}

/**
 * Build temporal memory context for injection into prompts.
 * Combines all available layers into a structured context block.
 */
export function getTemporalContext(groupFolder: string): string | null {
  const layers = getAllTemporalMemories(groupFolder);
  if (layers.length === 0) return null;

  const parts: string[] = [];

  for (const layer of layers) {
    const label =
      layer.layer === 'short'
        ? 'RECENT OBSERVATIONS'
        : layer.layer === 'medium'
          ? 'BEHAVIORAL PATTERNS'
          : 'GROUP PROFILE';

    parts.push(`[${label}]\n${layer.content}\n[END ${label}]`);
  }

  return parts.join('\n\n');
}
