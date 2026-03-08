// src/knowledge.ts
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { GROUPS_DIR, HYBRID_SEARCH } from './config.js';
import {
  chunkText,
  embedText,
  embeddingToBlob,
  blobToEmbedding,
  cosineSimilarity,
} from './embeddings.js';
import { logger } from './logger.js';

/**
 * Sanitize a user-provided query for safe use in FTS5 MATCH expressions.
 * Strips special FTS5 operators, splits into tokens, and joins with OR
 * for better recall with the trigram tokenizer.
 */
function sanitizeFTS5Query(query: string): string {
  const stripped = query.replace(/[*^{}():\-+]/g, '');
  const tokens = stripped.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return '""';
  if (tokens.length === 1) return `"${tokens[0].replace(/"/g, '""')}"`;
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
}

// ============================================================================
// Types
// ============================================================================

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

/** Abstract interface for future embedding/vector replacement */
export interface KnowledgeSearcher {
  search(
    query: string,
    groupFolder: string,
    limit?: number,
  ): KnowledgeSearchResult[];
  index(doc: KnowledgeDoc): void;
  remove(docId: number): void;
}

// ============================================================================
// Constants
// ============================================================================

const SAFE_FILENAME_RE = /^[a-zA-Z0-9_-]+\.md$/;

// ============================================================================
// FTS5 Index Management
// ============================================================================

/**
 * Initialize FTS5 virtual table for full-text search.
 * Creates the table if missing and populates from existing docs.
 */
export function initKnowledgeIndex(db: Database.Database): void {
  // Create FTS5 virtual table with trigram tokenizer (better for Chinese)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
      doc_id UNINDEXED,
      group_folder,
      title,
      content,
      tokenize='trigram'
    );
  `);

  // Populate FTS index from existing knowledge_docs rows
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

  for (const doc of existingDocs) {
    try {
      insertFts.run(doc.id, doc.group_folder, doc.title, doc.content);
    } catch {
      // Already indexed
    }
  }
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Add a new knowledge document.
 * Validates filename, writes to disk, inserts into DB and FTS index.
 */
export function addKnowledgeDoc(
  db: Database.Database,
  groupFolder: string,
  filename: string,
  title: string,
  content: string,
): KnowledgeDoc {
  // Validate filename
  if (!SAFE_FILENAME_RE.test(filename)) {
    throw new Error(
      'Invalid filename. Only alphanumeric, dash, underscore, and .md extension allowed.',
    );
  }

  const now = new Date().toISOString();
  const sizeChars = content.length;

  // Ensure knowledge directory exists
  const knowledgeDir = path.join(GROUPS_DIR, groupFolder, 'knowledge');
  fs.mkdirSync(knowledgeDir, { recursive: true });

  // Write markdown file to disk
  const filePath = path.join(knowledgeDir, filename);
  fs.writeFileSync(filePath, content, 'utf-8');

  // Insert into DB
  const result = db
    .prepare(
      `
    INSERT INTO knowledge_docs (group_folder, filename, title, content, size_chars, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(groupFolder, filename, title, content, sizeChars, now, now);

  const docId = result.lastInsertRowid as number;

  // Insert into FTS index
  db.prepare(
    `
    INSERT INTO knowledge_fts (doc_id, group_folder, title, content)
    VALUES (?, ?, ?, ?)
  `,
  ).run(docId, groupFolder, title, content);

  // Fire-and-forget embedding generation for hybrid search
  if (HYBRID_SEARCH.ENABLED) {
    generateAndStoreEmbeddings(db, docId, content).catch((err) => {
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

/**
 * Update an existing knowledge document.
 * Updates DB, FTS index, and disk file.
 */
export function updateKnowledgeDoc(
  db: Database.Database,
  docId: number,
  title: string,
  content: string,
): KnowledgeDoc | null {
  // Get existing doc to find file location
  const existing = db
    .prepare('SELECT * FROM knowledge_docs WHERE id = ?')
    .get(docId) as KnowledgeDoc | undefined;
  if (!existing) {
    return null;
  }

  const now = new Date().toISOString();
  const sizeChars = content.length;

  // Update DB
  db.prepare(
    `
    UPDATE knowledge_docs
    SET title = ?, content = ?, size_chars = ?, updated_at = ?
    WHERE id = ?
  `,
  ).run(title, content, sizeChars, now, docId);

  // Update FTS index
  db.prepare(
    `
    UPDATE knowledge_fts
    SET title = ?, content = ?
    WHERE doc_id = ?
  `,
  ).run(title, content, docId);

  // Update disk file
  const filePath = path.join(
    GROUPS_DIR,
    existing.group_folder,
    'knowledge',
    existing.filename,
  );
  fs.writeFileSync(filePath, content, 'utf-8');

  // Re-generate embeddings for hybrid search
  if (HYBRID_SEARCH.ENABLED) {
    db.prepare('DELETE FROM knowledge_embeddings WHERE doc_id = ?').run(docId);
    generateAndStoreEmbeddings(db, docId, content).catch((err) => {
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

/**
 * Delete a knowledge document.
 * Removes from DB, FTS index, and disk.
 */
export function deleteKnowledgeDoc(
  db: Database.Database,
  docId: number,
): boolean {
  // Get doc to find file location
  const doc = db
    .prepare('SELECT * FROM knowledge_docs WHERE id = ?')
    .get(docId) as KnowledgeDoc | undefined;
  if (!doc) {
    return false;
  }

  // Delete from FTS index
  db.prepare('DELETE FROM knowledge_fts WHERE doc_id = ?').run(docId);

  // Delete from DB
  db.prepare('DELETE FROM knowledge_docs WHERE id = ?').run(docId);

  // Delete from disk
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

/**
 * Get all knowledge documents for a group.
 */
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

/**
 * Get knowledge documents for a group with pagination.
 */
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

/**
 * Get a single knowledge document by ID.
 */
export function getKnowledgeDoc(
  db: Database.Database,
  docId: number,
): KnowledgeDoc | null {
  const doc = db
    .prepare('SELECT * FROM knowledge_docs WHERE id = ?')
    .get(docId) as KnowledgeDoc | undefined;
  return doc || null;
}

// ============================================================================
// Search & Retrieval
// ============================================================================

/**
 * Search knowledge documents using FTS5.
 * Returns results with snippets and relevance ranking.
 */
export function searchKnowledge(
  db: Database.Database,
  query: string,
  groupFolder: string,
  limit = 10,
): KnowledgeSearchResult[] {
  // Sanitize FTS5 query - wrap in quotes to treat as literal phrase
  const sanitizedQuery = sanitizeFTS5Query(query);

  const results = db
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

  return results;
}

/**
 * Get relevant knowledge for prompt injection.
 * When hybrid search is enabled, combines FTS5 and embedding results
 * using Reciprocal Rank Fusion (RRF). Otherwise, uses FTS5 only.
 */
export function getRelevantKnowledge(
  db: Database.Database,
  query: string,
  groupFolder: string,
  maxChars = 50000,
): string {
  const sanitizedQuery = sanitizeFTS5Query(query);

  // FTS5 search: get ranked doc IDs
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

  let rankedResults: Array<{ id: number; title: string; content: string }>;

  // If hybrid search is enabled and embeddings exist, merge with RRF
  if (HYBRID_SEARCH.ENABLED) {
    const embeddingResults = searchByEmbedding(db, query, groupFolder, 20);
    rankedResults = mergeWithRRF(ftsResults, embeddingResults, db);
  } else {
    rankedResults = ftsResults;
  }

  if (rankedResults.length === 0) {
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

  return chunks.join('\n');
}

// ============================================================================
// Hybrid Search: Embedding-based retrieval + RRF merging
// ============================================================================

/**
 * Search knowledge by embedding similarity.
 * Returns doc IDs ranked by cosine similarity to the query embedding.
 */
function searchByEmbedding(
  db: Database.Database,
  query: string,
  groupFolder: string,
  limit: number,
): Array<{ docId: number; score: number }> {
  // We need the query embedding — but embedText is async.
  // Since getRelevantKnowledge is sync, we check for a pre-computed embedding
  // passed via the embedding cache, or return empty if not available.
  // The actual embedding search is done asynchronously in the caller when possible.
  // For now, do a synchronous scan of stored embeddings.

  const allEmbeddings = db
    .prepare(
      `
    SELECT ke.doc_id, ke.embedding
    FROM knowledge_embeddings ke
    JOIN knowledge_docs d ON d.id = ke.doc_id
    WHERE d.group_folder = ?
  `,
    )
    .all(groupFolder) as Array<{ doc_id: number; embedding: Buffer }>;

  if (allEmbeddings.length === 0) return [];

  // We need a synchronous query embedding — use cached if available
  const queryEmbedding = getCachedQueryEmbedding(query);
  if (!queryEmbedding) return [];

  // Compute similarity and aggregate best score per doc
  const docScores = new Map<number, number>();
  for (const row of allEmbeddings) {
    const emb = blobToEmbedding(row.embedding);
    const score = cosineSimilarity(queryEmbedding, emb);
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

/**
 * Merge FTS5 and embedding results using Reciprocal Rank Fusion.
 * RRF score = 1/(k + rankFTS) + 1/(k + rankEmbed)
 */
function mergeWithRRF(
  ftsResults: Array<{ id: number; title: string; content: string }>,
  embeddingResults: Array<{ docId: number; score: number }>,
  db: Database.Database,
): Array<{ id: number; title: string; content: string }> {
  const k = HYBRID_SEARCH.RRF_K;
  const rrfScores = new Map<number, number>();

  // FTS ranks
  for (let i = 0; i < ftsResults.length; i++) {
    const docId = ftsResults[i].id;
    rrfScores.set(docId, (rrfScores.get(docId) || 0) + 1 / (k + i + 1));
  }

  // Embedding ranks
  for (let i = 0; i < embeddingResults.length; i++) {
    const docId = embeddingResults[i].docId;
    rrfScores.set(docId, (rrfScores.get(docId) || 0) + 1 / (k + i + 1));
  }

  // Sort by combined RRF score
  const sortedIds = Array.from(rrfScores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  // Build result with full doc content
  const ftsMap = new Map(ftsResults.map((r) => [r.id, r]));
  const results: Array<{ id: number; title: string; content: string }> = [];

  for (const docId of sortedIds) {
    const fromFts = ftsMap.get(docId);
    if (fromFts) {
      results.push(fromFts);
    } else {
      // Doc only found via embedding — fetch from DB
      const doc = db
        .prepare('SELECT id, title, content FROM knowledge_docs WHERE id = ?')
        .get(docId) as
        | { id: number; title: string; content: string }
        | undefined;
      if (doc) results.push(doc);
    }
  }

  return results;
}

// ============================================================================
// Embedding Generation & Caching
// ============================================================================

/** In-memory cache for query embeddings (async pre-computation) */
const queryEmbeddingCache = new Map<string, number[]>();

/** Cache a query embedding for synchronous retrieval in searchByEmbedding */
export function cacheQueryEmbedding(query: string, embedding: number[]): void {
  // Keep cache small
  if (queryEmbeddingCache.size >= 50) {
    const oldest = queryEmbeddingCache.keys().next().value!;
    queryEmbeddingCache.delete(oldest);
  }
  queryEmbeddingCache.set(query, embedding);
}

function getCachedQueryEmbedding(query: string): number[] | null {
  return queryEmbeddingCache.get(query) || null;
}

/**
 * Pre-compute and cache the query embedding for hybrid search.
 * Call this before getRelevantKnowledge() to enable embedding search.
 */
export async function precomputeQueryEmbedding(query: string): Promise<void> {
  if (!HYBRID_SEARCH.ENABLED) return;
  const embedding = await embedText(query);
  if (embedding) {
    cacheQueryEmbedding(query, embedding);
  }
}

/**
 * Generate embeddings for a document's chunks and store in DB.
 */
export async function generateAndStoreEmbeddings(
  db: Database.Database,
  docId: number,
  content: string,
): Promise<void> {
  const chunks = chunkText(content);
  const now = new Date().toISOString();

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO knowledge_embeddings (doc_id, chunk_index, chunk_text, embedding, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < chunks.length; i++) {
    const embedding = await embedText(chunks[i].text);
    if (embedding) {
      insertStmt.run(docId, i, chunks[i].text, embeddingToBlob(embedding), now);
    }
  }
}

/**
 * Re-index all existing knowledge documents with embeddings.
 * Useful for first-time enabling of hybrid search.
 */
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
      // Clear existing embeddings for this doc
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
