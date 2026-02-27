import { NewMessage } from '../types.js';
import { getDatabase } from './connection.js';

export interface ChatInfo {
  jid: string;
  name: string;
  last_message_time: string;
}

export interface ExportMessage {
  id: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: boolean;
}

export interface ConversationExport {
  chatJid: string;
  exportedAt: string;
  messageCount: number;
  messages: ExportMessage[];
}

export interface GroupMessageStats {
  chat_jid: string;
  message_count: number;
  total_chars: number;
  oldest_timestamp: string;
  newest_timestamp: string;
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
  const db = getDatabase();
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
  const db = getDatabase();
  db.prepare(
    `
    INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
    ON CONFLICT(jid) DO UPDATE SET name = excluded.name
  `,
  ).run(chatJid, name, new Date().toISOString());
}

/**
 * Get all known chats, ordered by most recent activity.
 */
export function getAllChats(): ChatInfo[] {
  const db = getDatabase();
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
  const db = getDatabase();
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
  const db = getDatabase();
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
  messageThreadId?: string | null,
): void {
  const db = getDatabase();
  db.prepare(
    `INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, message_thread_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    msgId,
    chatId,
    senderId,
    senderName,
    content,
    timestamp,
    isFromMe ? 1 : 0,
    messageThreadId ?? null,
  );
}

// Note: No thread filtering — this function aggregates across all threads.
// Used for daily reports and scheduled tasks where cross-thread view is intentional.
// Thread-scoped variant planned for Phase 2.
export function getNewMessages(
  jids: string[],
  lastTimestamp: string,
  botPrefix: string,
): { messages: NewMessage[]; newTimestamp: string } {
  const db = getDatabase();
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
  messageThreadId?: string | null,
): NewMessage[] {
  const db = getDatabase();
  // Filter out bot's own messages by checking content prefix
  if (messageThreadId !== undefined) {
    const sql = `
      SELECT id, chat_jid, sender, sender_name, content, timestamp
      FROM messages
      WHERE chat_jid = ? AND timestamp > ? AND content NOT LIKE ?
        AND message_thread_id IS ?
      ORDER BY timestamp
    `;
    return db
      .prepare(sql)
      .all(
        chatJid,
        sinceTimestamp,
        `${botPrefix}:%`,
        messageThreadId ?? null,
      ) as NewMessage[];
  }
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
  const db = getDatabase();
  return db
    .prepare('SELECT * FROM messages WHERE chat_jid = ? AND id = ?')
    .get(chatId, msgId) as NewMessage | undefined;
}

export function getGroupMessageStats(
  chatJid: string,
): GroupMessageStats | null {
  const db = getDatabase();
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
  const db = getDatabase();
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

/**
 * Get recent messages for multi-turn conversation context.
 * Returns messages ordered oldest-first, with role mapped from is_from_me.
 */
export function getRecentConversation(
  chatJid: string,
  limit: number = 50,
  messageThreadId?: string | null,
): Array<{ role: 'user' | 'model'; text: string }> {
  const db = getDatabase();
  const rows =
    messageThreadId !== undefined
      ? (db
          .prepare(
            `
      SELECT content, is_from_me
      FROM messages
      WHERE chat_jid = ? AND content != '' AND message_thread_id IS ?
      ORDER BY timestamp DESC
      LIMIT ?
    `,
          )
          .all(chatJid, messageThreadId ?? null, limit) as Array<{
          content: string;
          is_from_me: number;
        }>)
      : (db
          .prepare(
            `
      SELECT content, is_from_me
      FROM messages
      WHERE chat_jid = ? AND content != ''
      ORDER BY timestamp DESC
      LIMIT ?
    `,
          )
          .all(chatJid, limit) as Array<{
          content: string;
          is_from_me: number;
        }>);

  // Reverse to oldest-first order for conversation context
  return rows.reverse().map((row) => ({
    role: row.is_from_me ? ('model' as const) : ('user' as const),
    text: row.content,
  }));
}

export function deleteOldMessages(
  chatJid: string,
  beforeTimestamp: string,
): number {
  const db = getDatabase();
  const result = db
    .prepare('DELETE FROM messages WHERE chat_jid = ? AND timestamp < ?')
    .run(chatJid, beforeTimestamp);
  return result.changes;
}

/**
 * Export conversation messages for a given chat JID.
 * Supports optional time filtering with 'since' parameter.
 */
export function getConversationExport(
  chatJid: string,
  since?: string,
): ConversationExport {
  const db = getDatabase();
  let query = `
    SELECT id, sender, sender_name, content, timestamp, is_from_me
    FROM messages
    WHERE chat_jid = ?
  `;
  const params: string[] = [chatJid];

  if (since) {
    query += ' AND timestamp > ?';
    params.push(since);
  }

  query += ' ORDER BY timestamp ASC';

  const messages = db.prepare(query).all(...params) as ExportMessage[];

  return {
    chatJid,
    exportedAt: new Date().toISOString(),
    messageCount: messages.length,
    messages: messages.map((m) => ({
      ...m,
      is_from_me: !!m.is_from_me,
    })),
  };
}

/**
 * Format conversation export as Markdown.
 */
export function formatExportAsMarkdown(exp: ConversationExport): string {
  const lines: string[] = [
    `# Conversation Export`,
    ``,
    `- **Chat:** ${exp.chatJid}`,
    `- **Exported:** ${exp.exportedAt}`,
    `- **Messages:** ${exp.messageCount}`,
    ``,
    `---`,
    ``,
  ];

  for (const msg of exp.messages) {
    const time = new Date(msg.timestamp).toLocaleString();
    const name = msg.sender_name || msg.sender || 'Unknown';
    lines.push(`**${name}** (${time}):`);
    lines.push(msg.content);
    lines.push('');
  }

  return lines.join('\n');
}

export function getAllChatsPaginated(
  limit: number,
  offset: number,
): { rows: ChatInfo[]; total: number } {
  const db = getDatabase();
  const rows = db
    .prepare(
      'SELECT jid, name, last_message_time FROM chats ORDER BY last_message_time DESC LIMIT ? OFFSET ?',
    )
    .all(limit, offset) as ChatInfo[];
  const { total } = db.prepare('SELECT COUNT(*) as total FROM chats').get() as {
    total: number;
  };
  return { rows, total };
}

/**
 * Batch: Get message counts for all chat JIDs at once.
 * Returns Map<chatJid, messageCount>
 */
export function getMessageCountsBatch(): Map<string, number> {
  const db = getDatabase();
  const rows = db
    .prepare(
      `
    SELECT chat_jid, COUNT(*) as message_count
    FROM messages
    GROUP BY chat_jid
  `,
    )
    .all() as Array<{ chat_jid: string; message_count: number }>;
  const map = new Map<string, number>();
  for (const row of rows) map.set(row.chat_jid, row.message_count);
  return map;
}
