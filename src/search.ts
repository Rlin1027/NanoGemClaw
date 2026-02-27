/**
 * Full-Text Search Module
 * Uses SQLite FTS5 with trigram tokenizer for Chinese/English search.
 */

import type Database from 'better-sqlite3';

/**
 * Initialize FTS5 search index.
 * Call this after initDatabase() in startup.
 * Uses trigram tokenizer for CJK language support.
 */
export function initSearchIndex(db: Database.Database): void {
  // Create FTS5 virtual table with trigram tokenizer
  // content='' means external content (we manage sync ourselves)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts
    USING fts5(content, tokenize='trigram');
  `);

  // Check if FTS table needs initial population
  const ftsCount = db
    .prepare('SELECT COUNT(*) as cnt FROM messages_fts')
    .get() as { cnt: number };
  const msgCount = db.prepare('SELECT COUNT(*) as cnt FROM messages').get() as {
    cnt: number;
  };

  if (ftsCount.cnt === 0 && msgCount.cnt > 0) {
    // Initial population from existing messages
    const insertFts = db.prepare(
      'INSERT INTO messages_fts(rowid, content) VALUES (?, ?)',
    );
    const allMessages = db
      .prepare('SELECT rowid, content FROM messages WHERE content IS NOT NULL')
      .all() as Array<{ rowid: number; content: string }>;

    const insertMany = db.transaction(
      (messages: Array<{ rowid: number; content: string }>) => {
        for (const msg of messages) {
          insertFts.run(msg.rowid, msg.content);
        }
      },
    );
    insertMany(allMessages);
  }
}

/**
 * Add a message to the FTS index.
 * Call this after inserting a message into the messages table.
 */
export function indexMessage(
  db: Database.Database,
  rowid: number,
  content: string,
): void {
  db.prepare('INSERT INTO messages_fts(rowid, content) VALUES (?, ?)').run(
    rowid,
    content,
  );
}

/**
 * Remove a message from the FTS index.
 * Call this before/after deleting a message from the messages table.
 */
export function removeFromIndex(db: Database.Database, rowid: number): void {
  db.prepare('DELETE FROM messages_fts WHERE rowid = ?').run(rowid);
}

/**
 * Sanitize a user-provided query for safe use in FTS5 MATCH expressions.
 * Strips special FTS5 operators and wraps as a literal phrase.
 */
function sanitizeFTS5Query(query: string): string {
  const stripped = query.replace(/[*^{}():\-+]/g, '');
  if (!stripped.trim()) return '""';
  return `"${stripped.replace(/"/g, '""')}"`;
}

export interface SearchResult {
  id: number;
  chatJid: string;
  sender: string;
  content: string;
  timestamp: string;
  isFromMe: boolean;
  snippet: string;
  rank: number;
}

/**
 * Search messages using FTS5.
 * Supports Chinese and English via trigram tokenizer.
 */
export function searchMessages(
  db: Database.Database,
  query: string,
  options?: { group?: string; limit?: number; offset?: number },
): { results: SearchResult[]; total: number } {
  const limit = options?.limit ?? 20;
  const offset = options?.offset ?? 0;

  if (!query.trim()) {
    return { results: [], total: 0 };
  }

  // Strip FTS5 special characters to prevent query injection, then wrap as literal phrase
  const escapedQuery = sanitizeFTS5Query(query);

  // Build WHERE clause for optional group filter
  let groupFilter = '';
  const params: any[] = [escapedQuery];
  if (options?.group) {
    groupFilter = 'AND m.chat_jid = ?';
    params.push(options.group);
  }

  // Count total matches
  const countSql = `
    SELECT COUNT(*) as total
    FROM messages_fts f
    JOIN messages m ON m.rowid = f.rowid
    WHERE messages_fts MATCH ?
    ${groupFilter}
  `;
  const { total } = db.prepare(countSql).get(...params) as { total: number };

  // Get paginated results with snippets
  const searchSql = `
    SELECT
      m.id,
      m.chat_jid as chatJid,
      m.sender,
      m.content,
      m.timestamp,
      m.is_from_me as isFromMe,
      snippet(messages_fts, 0, '<mark>', '</mark>', '...', 32) as snippet,
      rank
    FROM messages_fts f
    JOIN messages m ON m.rowid = f.rowid
    WHERE messages_fts MATCH ?
    ${groupFilter}
    ORDER BY rank
    LIMIT ? OFFSET ?
  `;

  const results = db
    .prepare(searchSql)
    .all(...params, limit, offset) as SearchResult[];

  return { results, total };
}
