// src/knowledge.ts
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { GROUPS_DIR } from './config.js';

/**
 * Sanitize a user-provided query for safe use in FTS5 MATCH expressions.
 * Strips special FTS5 operators and wraps as a literal phrase.
 */
function sanitizeFTS5Query(query: string): string {
  const stripped = query.replace(/[*^{}():\-+]/g, '');
  if (!stripped.trim()) return '""';
  return `"${stripped.replace(/"/g, '""')}"`;
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
 * Searches and concatenates matching documents up to maxChars limit.
 */
export function getRelevantKnowledge(
  db: Database.Database,
  query: string,
  groupFolder: string,
  maxChars = 50000,
): string {
  const sanitizedQuery = `"${query.replace(/"/g, '""')}"`;

  // Single query: JOIN full document content with FTS results
  const results = db
    .prepare(
      `
    SELECT
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
    title: string;
    content: string;
  }>;

  if (results.length === 0) {
    return '';
  }

  const chunks: string[] = [];
  let totalChars = 0;

  for (const doc of results) {
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
