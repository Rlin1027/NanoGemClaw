import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { escapeFts5Query } from '@nanogemclaw/core';

import { GROUPS_DIR, HYBRID_SEARCH } from './config.js';
import {
  chunkText,
  embedBatch,
  embedText,
  embeddingToBlob,
} from './embeddings.js';
import { logger } from './logger.js';
import { trackSearchQuery } from './memory-metrics.js';
import { getDatabase } from './db/connection.js';
import type { Fact } from './db/facts.js';
import { getEventBus } from '@nanogemclaw/event-bus';

export interface KnowledgeDoc {
  id: number;
  group_folder: string;
  filename: string;
  title: string;
  content: string;
  size_chars: number;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeSearchResult {
  id: number;
  group_folder: string;
  filename: string;
  title: string;
  snippet: string;
  rank: number;
}

export interface KnowledgeSearcher {
  search(
    query: string,
    groupFolder: string,
    limit?: number,
  ): KnowledgeSearchResult[];
  index(doc: KnowledgeDoc): void;
  remove(docId: number): void;
}

/** Cosine similarity between a number[] query and a Float32Array doc embedding (zero-copy). */
function cosineSimilarityF32(a: number[], b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

const SAFE_FILENAME_RE = /^[a-zA-Z0-9_-]+\.md$/;

export function initKnowledgeIndex(db: Database.Database): void {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
      doc_id UNINDEXED,
      group_folder,
      title,
      content,
      tokenize='trigram'
    );
  `);

  const { count } = db
    .prepare('SELECT COUNT(*) as count FROM knowledge_fts')
    .get() as { count: number };

  if (count > 0) return; // Already indexed from a previous run

  const existingDocs = db
    .prepare('SELECT id, group_folder, title, content FROM knowledge_docs')
    .all() as Array<{
    id: number;
    group_folder: string;
    title: string;
    content: string;
  }>;

  const insertFts = db.prepare(`
    INSERT INTO knowledge_fts (doc_id, group_folder, title, content)
    VALUES (?, ?, ?, ?)
  `);

  const insertAll = db.transaction(() => {
    for (const doc of existingDocs) {
      insertFts.run(doc.id, doc.group_folder, doc.title, doc.content);
    }
  });

  insertAll();
}

export function addKnowledgeDoc(
  db: Database.Database,
  groupFolder: string,
  filename: string,
  title: string,
  content: string,
): KnowledgeDoc {
  if (!SAFE_FILENAME_RE.test(filename)) {
    throw new Error(
      'Invalid filename. Only alphanumeric, dash, underscore, and .md extension allowed.',
    );
  }

  const now = new Date().toISOString();
  const sizeChars = content.length;

  const knowledgeDir = path.join(GROUPS_DIR, groupFolder, 'knowledge');
  fs.mkdirSync(knowledgeDir, { recursive: true });

  const filePath = path.join(knowledgeDir, filename);
  fs.writeFileSync(filePath, content, 'utf-8');

  const result = db
    .prepare(
      `
    INSERT INTO knowledge_docs (group_folder, filename, title, content, size_chars, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(groupFolder, filename, title, content, sizeChars, now, now);

  const docId = result.lastInsertRowid as number;

  db.prepare(
    `
    INSERT INTO knowledge_fts (doc_id, group_folder, title, content)
    VALUES (?, ?, ?, ?)
  `,
  ).run(docId, groupFolder, title, content);

  if (HYBRID_SEARCH.ENABLED) {
    void generateAndStoreEmbeddings(db, docId, content).catch((err) => {
      logger.debug(
        { docId, err: err instanceof Error ? err.message : String(err) },
        'Failed to generate embeddings for new doc',
      );
    });
  }

  return {
    id: docId,
    group_folder: groupFolder,
    filename,
    title,
    content,
    size_chars: sizeChars,
    created_at: now,
    updated_at: now,
  };
}

export function updateKnowledgeDoc(
  db: Database.Database,
  docId: number,
  title: string,
  content: string,
): KnowledgeDoc | null {
  const existing = db
    .prepare('SELECT * FROM knowledge_docs WHERE id = ?')
    .get(docId) as KnowledgeDoc | undefined;
  if (!existing) {
    return null;
  }

  const now = new Date().toISOString();
  const sizeChars = content.length;

  db.prepare(
    `
    UPDATE knowledge_docs
    SET title = ?, content = ?, size_chars = ?, updated_at = ?
    WHERE id = ?
  `,
  ).run(title, content, sizeChars, now, docId);

  db.prepare(
    `
    UPDATE knowledge_fts
    SET title = ?, content = ?
    WHERE doc_id = ?
  `,
  ).run(title, content, docId);

  const filePath = path.join(
    GROUPS_DIR,
    existing.group_folder,
    'knowledge',
    existing.filename,
  );
  fs.writeFileSync(filePath, content, 'utf-8');

  if (HYBRID_SEARCH.ENABLED) {
    void generateAndStoreEmbeddings(db, docId, content, true).catch((err) => {
      logger.debug(
        { docId, err: err instanceof Error ? err.message : String(err) },
        'Failed to regenerate embeddings for updated doc',
      );
    });
  }

  return {
    ...existing,
    title,
    content,
    size_chars: sizeChars,
    updated_at: now,
  };
}

export function deleteKnowledgeDoc(
  db: Database.Database,
  docId: number,
): boolean {
  const doc = db
    .prepare('SELECT * FROM knowledge_docs WHERE id = ?')
    .get(docId) as KnowledgeDoc | undefined;
  if (!doc) {
    return false;
  }

  db.prepare('DELETE FROM knowledge_fts WHERE doc_id = ?').run(docId);
  db.prepare('DELETE FROM knowledge_embeddings WHERE doc_id = ?').run(docId);
  db.prepare('DELETE FROM knowledge_docs WHERE id = ?').run(docId);

  const filePath = path.join(
    GROUPS_DIR,
    doc.group_folder,
    'knowledge',
    doc.filename,
  );
  try {
    fs.unlinkSync(filePath);
  } catch {
    // File may not exist
  }

  return true;
}

export function getKnowledgeDocs(
  db: Database.Database,
  groupFolder: string,
): KnowledgeDoc[] {
  return db
    .prepare(
      `
    SELECT * FROM knowledge_docs
    WHERE group_folder = ?
    ORDER BY updated_at DESC
  `,
    )
    .all(groupFolder) as KnowledgeDoc[];
}

export function getKnowledgeDocsPaginated(
  db: Database.Database,
  groupFolder: string,
  limit: number,
  offset: number,
): { rows: KnowledgeDoc[]; total: number } {
  const rows = db
    .prepare(
      `
    SELECT * FROM knowledge_docs
    WHERE group_folder = ?
    ORDER BY updated_at DESC
    LIMIT ? OFFSET ?
  `,
    )
    .all(groupFolder, limit, offset) as KnowledgeDoc[];
  const { total } = db
    .prepare(
      'SELECT COUNT(*) as total FROM knowledge_docs WHERE group_folder = ?',
    )
    .get(groupFolder) as { total: number };
  return { rows, total };
}

export function getKnowledgeDoc(
  db: Database.Database,
  docId: number,
): KnowledgeDoc | null {
  const doc = db
    .prepare('SELECT * FROM knowledge_docs WHERE id = ?')
    .get(docId) as KnowledgeDoc | undefined;
  return doc || null;
}

export function searchKnowledge(
  db: Database.Database,
  query: string,
  groupFolder: string,
  limit = 10,
): KnowledgeSearchResult[] {
  const sanitizedQuery = escapeFts5Query(query);

  return db
    .prepare(
      `
    SELECT
      d.id,
      d.group_folder,
      d.filename,
      d.title,
      snippet(knowledge_fts, 3, '<mark>', '</mark>', '...', 64) as snippet,
      fts.rank
    FROM knowledge_fts fts
    JOIN knowledge_docs d ON d.id = fts.doc_id
    WHERE fts.group_folder = ? AND knowledge_fts MATCH ?
    ORDER BY fts.rank
    LIMIT ?
  `,
    )
    .all(groupFolder, sanitizedQuery, limit) as KnowledgeSearchResult[];
}

export async function getRelevantKnowledge(
  db: Database.Database,
  query: string,
  groupFolder: string,
  maxChars = 50000,
): Promise<string> {
  const sanitizedQuery = escapeFts5Query(query);

  const ftsResults = db
    .prepare(
      `
    SELECT
      d.id,
      d.title,
      d.content
    FROM knowledge_fts fts
    JOIN knowledge_docs d ON d.id = fts.doc_id
    WHERE fts.group_folder = ? AND knowledge_fts MATCH ?
    ORDER BY fts.rank
    LIMIT 20
  `,
    )
    .all(groupFolder, sanitizedQuery) as Array<{
    id: number;
    title: string;
    content: string;
  }>;

  let rankedResults = ftsResults;
  if (HYBRID_SEARCH.ENABLED) {
    const embeddingResults = await searchByEmbedding(
      db,
      query,
      groupFolder,
      20,
    );
    rankedResults = mergeWithRRF(ftsResults, embeddingResults, db);
  }

  if (rankedResults.length === 0) {
    trackSearchQuery(groupFolder, query, 0, false);
    return '';
  }

  const chunks: string[] = [];
  let totalChars = 0;

  for (const doc of rankedResults) {
    const header = `\n# ${doc.title}\n\n`;
    const chunkSize = header.length + doc.content.length;

    if (totalChars + chunkSize > maxChars) {
      const remaining = maxChars - totalChars - header.length;
      if (remaining > 200) {
        chunks.push(header + doc.content.substring(0, remaining) + '\n...');
      }
      break;
    }

    chunks.push(header + doc.content);
    totalChars += chunkSize;
  }

  trackSearchQuery(groupFolder, query, rankedResults.length, chunks.length > 0);
  return chunks.join('\n');
}

async function searchByEmbedding(
  db: Database.Database,
  query: string,
  groupFolder: string,
  limit: number,
): Promise<Array<{ docId: number; score: number }>> {
  const rows = db
    .prepare(
      `
    SELECT ke.doc_id, ke.embedding
    FROM knowledge_embeddings ke
    JOIN knowledge_docs d ON d.id = ke.doc_id
    WHERE d.group_folder = ?
    LIMIT ?
  `,
    )
    .all(groupFolder, HYBRID_SEARCH.MAX_EMBEDDING_SCAN) as Array<{
    doc_id: number;
    embedding: Buffer;
  }>;

  if (rows.length === 0) {
    return [];
  }

  const queryEmbedding = await embedText(query);
  if (!queryEmbedding) {
    return [];
  }

  const minSim = HYBRID_SEARCH.MIN_SIMILARITY;
  const docScores = new Map<number, number>();
  for (const row of rows) {
    const emb = new Float32Array(
      row.embedding.buffer,
      row.embedding.byteOffset,
      row.embedding.byteLength / 4,
    );
    const score = cosineSimilarityF32(queryEmbedding, emb);
    if (score < minSim) continue;
    const existing = docScores.get(row.doc_id) || 0;
    if (score > existing) {
      docScores.set(row.doc_id, score);
    }
  }

  return Array.from(docScores.entries())
    .map(([docId, score]) => ({ docId, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function mergeWithRRF(
  ftsResults: Array<{ id: number; title: string; content: string }>,
  embeddingResults: Array<{ docId: number; score: number }>,
  db: Database.Database,
): Array<{ id: number; title: string; content: string }> {
  const k = HYBRID_SEARCH.RRF_K;
  const rrfScores = new Map<number, number>();

  for (let i = 0; i < ftsResults.length; i++) {
    const docId = ftsResults[i].id;
    rrfScores.set(docId, (rrfScores.get(docId) || 0) + 1 / (k + i + 1));
  }

  for (let i = 0; i < embeddingResults.length; i++) {
    const docId = embeddingResults[i].docId;
    rrfScores.set(docId, (rrfScores.get(docId) || 0) + 1 / (k + i + 1));
  }

  const sortedIds = Array.from(rrfScores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  const ftsMap = new Map(ftsResults.map((r) => [r.id, r]));
  const results: Array<{ id: number; title: string; content: string }> = [];

  for (const docId of sortedIds) {
    const fromFts = ftsMap.get(docId);
    if (fromFts) {
      results.push(fromFts);
      continue;
    }

    const doc = db
      .prepare('SELECT id, title, content FROM knowledge_docs WHERE id = ?')
      .get(docId) as { id: number; title: string; content: string } | undefined;
    if (doc) {
      results.push(doc);
    }
  }

  return results;
}

export async function generateAndStoreEmbeddings(
  db: Database.Database,
  docId: number,
  content: string,
  replaceExisting = false,
): Promise<void> {
  const chunks = chunkText(content);
  if (chunks.length === 0) return;

  const embeddings = await embedBatch(chunks.map((chunk) => chunk.text));
  const now = new Date().toISOString();

  // Atomic: delete old + insert new in a single transaction to avoid query gap
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO knowledge_embeddings (doc_id, chunk_index, chunk_text, embedding, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const writeAll = db.transaction(() => {
    if (replaceExisting) {
      db.prepare('DELETE FROM knowledge_embeddings WHERE doc_id = ?').run(
        docId,
      );
    }
    for (let i = 0; i < chunks.length; i++) {
      const embedding = embeddings[i];
      if (!embedding) continue;
      insertStmt.run(docId, i, chunks[i].text, embeddingToBlob(embedding), now);
    }
  });

  writeAll();
}

export async function reindexAllEmbeddings(
  db: Database.Database,
): Promise<{ indexed: number; failed: number }> {
  const docs = db
    .prepare('SELECT id, content FROM knowledge_docs')
    .all() as Array<{ id: number; content: string }>;

  let indexed = 0;
  let failed = 0;

  for (const doc of docs) {
    try {
      db.prepare('DELETE FROM knowledge_embeddings WHERE doc_id = ?').run(
        doc.id,
      );
      await generateAndStoreEmbeddings(db, doc.id, doc.content);
      indexed++;
    } catch (err) {
      logger.debug(
        {
          docId: doc.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'Failed to index embeddings for doc',
      );
      failed++;
    }
  }

  return { indexed, failed };
}

// ============================================================================
// Fact Conflict Detection
// ============================================================================

export interface ConflictResolution {
  hasConflict: boolean;
  existingFact?: Fact;
  resolution: 'superseded' | 'merged' | 'kept';
}

/**
 * Detect if a new fact conflicts with an existing stored fact for the same key.
 *
 * Resolution strategy:
 *   - Same key with different value → newer fact wins (existing marked 'superseded')
 *   - Same key with identical value → 'kept' (no conflict, idempotent)
 *   - No existing fact → 'kept' (nothing to conflict with)
 *
 * Heuristic for contradicting values:
 *   - Different string value for the same key is treated as a conflict
 *   - Opposing sentiment words (yes/no, true/false, like/dislike) also conflict
 */
export function detectFactConflict(
  groupFolder: string,
  newFact: { key: string; value: string },
): ConflictResolution {
  const db = getDatabase();

  const existing = db
    .prepare('SELECT * FROM facts WHERE group_folder = ? AND key = ?')
    .get(groupFolder, newFact.key) as Fact | undefined;

  if (!existing) {
    return { hasConflict: false, resolution: 'kept' };
  }

  // Normalize for comparison
  const existingVal = existing.value.trim().toLowerCase();
  const newVal = newFact.value.trim().toLowerCase();

  if (existingVal === newVal) {
    return { hasConflict: false, existingFact: existing, resolution: 'kept' };
  }

  // Values differ — newer wins, existing will be superseded
  return {
    hasConflict: true,
    existingFact: existing,
    resolution: 'superseded',
  };
}

/**
 * Store a fact with conflict detection.
 * If an existing fact for the same key has a different value, it is marked
 * as superseded in its metadata before the new value is written.
 *
 * Returns the conflict resolution result for logging/auditing.
 */
export function storeFactWithConflictCheck(
  groupFolder: string,
  key: string,
  value: string,
  source = 'extracted',
  confidence = 0.8,
): ConflictResolution {
  const conflict = detectFactConflict(groupFolder, { key, value });

  if (conflict.hasConflict && conflict.existingFact) {
    // Mark old fact as superseded in metadata before overwriting
    const db = getDatabase();
    const now = new Date().toISOString();
    const prevMeta = conflict.existingFact.source;
    db.prepare(
      `UPDATE facts
       SET source = ?, updated_at = ?
       WHERE group_folder = ? AND key = ?`,
    ).run(
      `superseded:${prevMeta}:${now}`,
      now,
      groupFolder,
      key,
    );

    logger.debug(
      {
        groupFolder,
        key,
        oldValue: conflict.existingFact.value,
        newValue: value,
      },
      'Fact conflict: existing value superseded by newer fact',
    );

    // Emit conflict event for cross-plugin awareness
    try {
      const bus = getEventBus();
      bus.emit('memory:fact-conflict', {
        groupFolder,
        key,
        resolution: conflict.resolution,
      });
    } catch {
      // Event bus may not be initialized in tests
    }
  }

  // Write the new fact (upsert)
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO facts (group_folder, key, value, source, confidence, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(group_folder, key) DO UPDATE SET
       value = excluded.value,
       source = excluded.source,
       confidence = excluded.confidence,
       updated_at = excluded.updated_at`,
  ).run(groupFolder, key, value, source, confidence, now, now);

  return conflict;
}
