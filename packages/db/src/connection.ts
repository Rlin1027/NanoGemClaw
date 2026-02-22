import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

let db: Database.Database;

export function initDatabase(options?: { storeDir?: string }): void {
  const storeDir = options?.storeDir ?? path.resolve(process.cwd(), 'store');
  const dbPath = path.join(storeDir, 'messages.db');
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

  // Schema migration mechanism using PRAGMA user_version
  const currentVersion = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

  if (currentVersion < 1) {
    // Migration v1: composite index + column additions
    db.exec('CREATE INDEX IF NOT EXISTS idx_messages_chat_timestamp ON messages(chat_jid, timestamp)');

    // Add sender_name column if it doesn't exist
    try {
      db.exec(`ALTER TABLE messages ADD COLUMN sender_name TEXT`);
    } catch {
      /* column already exists */
    }

    // Add context_mode column if it doesn't exist
    try {
      db.exec(`ALTER TABLE scheduled_tasks ADD COLUMN context_mode TEXT DEFAULT 'isolated'`);
    } catch {
      /* column already exists */
    }

    // Create preferences table
    db.exec(`
      CREATE TABLE IF NOT EXISTS preferences (
        group_folder TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (group_folder, key)
      );
      CREATE INDEX IF NOT EXISTS idx_preferences_group ON preferences(group_folder);
    `);

    db.exec('PRAGMA user_version = 1');
  }

  if (currentVersion < 2) {
    // Migration v2: Knowledge base tables
    db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_docs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_folder TEXT NOT NULL,
        filename TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        size_chars INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(group_folder, filename)
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_group ON knowledge_docs(group_folder);
    `);
    db.exec('PRAGMA user_version = 2');
  }

  // Future migrations go here:
  // if (currentVersion < 3) { ... db.exec('PRAGMA user_version = 3'); }
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

export function getDatabase(): Database.Database {
  return db;
}
