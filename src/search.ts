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

  if (ftsCount.cnt < msgCount.cnt) {
    // Sync FTS index with messages table (handles initial + gap population)
    const insertFts = db.prepare(
      'INSERT OR IGNORE INTO messages_fts(rowid, content) VALUES (?, ?)',
    );
    const missingMessages = db
      .prepare(
        `SELECT m.rowid, m.content FROM messages m
         WHERE m.content IS NOT NULL
         AND m.rowid NOT IN (SELECT rowid FROM messages_fts)`,
      )
      .all() as Array<{ rowid: number; content: string }>;

    if (missingMessages.length > 0) {
      const insertMany = db.transaction(
        (messages: Array<{ rowid: number; content: string }>) => {
          for (const msg of messages) {
            insertFts.run(msg.rowid, msg.content);
          }
        },
      );
      insertMany(missingMessages);
    }
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
 * Strips special FTS5 operators, splits into tokens, and joins with OR
 * for better recall with the trigram tokenizer.
 */
function sanitizeFTS5Query(query: string): string {
  const stripped = query.replace(/[*^{}():\-+]/g, '');
  const tokens = stripped.split(/\s+/).filter(t => t.length > 0);
  if (tokens.length === 0) return '""';
  if (tokens.length === 1) return `"${tokens[0].replace(/"/g, '""')}"`;
  return tokens.map(t => `"${t.replace(/"/g, '""')}"`).join(' OR ');
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

  // Trigram tokenizer requires >= 3 characters per token.
  // For short queries, fall back to LIKE search.
  const tokens = query.trim().split(/\s+/).filter(t => t.length > 0);
  const needsLikeFallback = tokens.some(t => t.length < 3);

  if (needsLikeFallback) {
    return searchMessagesLike(db, query, options);
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

/**
 * Fallback search using LIKE for short queries (< 3 chars per token).
 * Trigram FTS5 requires >= 3 characters; this handles shorter CJK queries like "行程".
 */
function searchMessagesLike(
  db: Database.Database,
  query: string,
  options?: { group?: string; limit?: number; offset?: number },
): { results: SearchResult[]; total: number } {
  const limit = options?.limit ?? 20;
  const offset = options?.offset ?? 0;
  const likePattern = `%${query.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;

  let groupFilter = '';
  const params: any[] = [likePattern];
  if (options?.group) {
    groupFilter = 'AND chat_jid = ?';
    params.push(options.group);
  }

  const countSql = `
    SELECT COUNT(*) as total FROM messages
    WHERE content LIKE ? ESCAPE '\\'
    ${groupFilter}
  `;
  const { total } = db.prepare(countSql).get(...params) as { total: number };

  const searchSql = `
    SELECT
      id, chat_jid as chatJid, sender, content, timestamp,
      is_from_me as isFromMe, content as snippet, 0 as rank
    FROM messages
    WHERE content LIKE ? ESCAPE '\\'
    ${groupFilter}
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `;
  const results = db.prepare(searchSql).all(...params, limit, offset) as SearchResult[];

  return { results, total };
}
