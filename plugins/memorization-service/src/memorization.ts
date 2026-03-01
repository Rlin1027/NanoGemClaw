/**
 * MemorizationService — Automatic conversation summarization.
 *
 * Dual trigger strategy (inspired by memUBot):
 * - Phase 1 (Polling): Check all groups every CHECK_INTERVAL_HOURS.
 *   If a group has >= MESSAGE_THRESHOLD unsummarized messages, trigger summarization.
 * - Phase 2 (Event Bus): Subscribe to message:received events.
 *   Per-group debounce: 20 messages threshold OR 60 min inactivity.
 *
 * Crash recovery: On start, re-process any tasks left in pending/processing state.
 */
import { join } from 'path';
import type { PluginApi } from '@nanogemclaw/plugin-api';
import type { EventBus } from '@nanogemclaw/event-bus';

interface MemorizationTask {
  id: number;
  group_folder: string;
  chat_jid: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: string;
  updated_at: string;
  message_count: number;
  error: string | null;
}

/** Function signature for the summarizer (injectable for testing). */
export type SummarizeFunction = (
  group: { folder: string; name: string },
  chatJid: string,
) => Promise<{ summary: string; messagesProcessed: number; charsProcessed: number } | null>;

export interface MemorizationConfig {
  /** Messages needed to trigger summarization (default: 20) */
  messageThreshold?: number;
  /** Debounce timeout for event-driven mode in ms (default: 3600000) */
  debounceMs?: number;
  /** Hours between polling cycles (default: 4) */
  checkIntervalHours?: number;
  /** Minimum messages — below this count, skip processing (default: 5) */
  minMessages?: number;
  /** Maximum messages per summarization batch (default: 200) */
  maxMessages?: number;
  /** Maximum concurrent summarizations across all groups (default: 1) */
  maxConcurrent?: number;
}

const DEFAULT_CONFIG: Required<MemorizationConfig> = {
  messageThreshold: 20,
  debounceMs: 60 * 60 * 1000,
  checkIntervalHours: 4,
  minMessages: 5,
  maxMessages: 200,
  maxConcurrent: 1,
};

export interface MemorizationServiceOptions {
  /** Override the summarizer (defaults to dynamic import of src/memory-summarizer.js). */
  summarize?: SummarizeFunction;
  /** Configuration overrides. */
  config?: MemorizationConfig;
}

export class MemorizationService {
  private api: PluginApi;
  private db: ReturnType<PluginApi['getDatabase']> & {
    exec(sql: string): void;
    prepare(sql: string): {
      run(...args: unknown[]): { lastInsertRowid: number | bigint; changes: number };
      get(...args: unknown[]): unknown;
      all(...args: unknown[]): unknown[];
    };
  };
  private injectedSummarize?: SummarizeFunction;
  private config: Required<MemorizationConfig>;
  private eventBus?: EventBus;

  // Per-group processing lock
  private isProcessing = new Map<string, boolean>();
  // Global concurrency counter
  private activeCount = 0;

  // Polling timer
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private initialTimer: ReturnType<typeof setTimeout> | null = null;

  // Phase 2: Event-driven state
  private pendingCounts = new Map<string, number>();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private eventUnsubscribers: Array<() => void> = [];

  constructor(api: PluginApi, options?: MemorizationServiceOptions) {
    this.api = api;
    this.db = api.getDatabase() as MemorizationService['db'];
    this.injectedSummarize = options?.summarize;
    this.config = { ...DEFAULT_CONFIG, ...options?.config };
  }

  /** Create the memorization_tasks table (plugin-managed migration). */
  initTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memorization_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_folder TEXT NOT NULL,
        chat_jid TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0,
        error TEXT
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memorization_tasks_status
      ON memorization_tasks (status)
    `);
  }

  async start(): Promise<void> {
    this.api.logger.info('Memorization service starting');
    await this.recoverCrashedTasks();
    this.startPolling();
    this.api.logger.info('Memorization service started');
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.pendingCounts.clear();
    this.isProcessing.clear();
    for (const unsub of this.eventUnsubscribers) {
      unsub();
    }
    this.eventUnsubscribers = [];
    this.api.logger.info('Memorization service stopped');
  }

  // ── Phase 2: Event Bus integration ──────────────────────────────

  /** Subscribe to Event Bus events for real-time trigger. */
  subscribeToEvents(eventBus: EventBus): void {
    this.eventBus = eventBus;
    const unsub1 = eventBus.on('message:received', (payload) => {
      this.onMessageReceived(payload.chatId, payload.groupFolder);
    });
    const unsub2 = eventBus.on('message:sent', (payload) => {
      this.onMessageReceived(payload.chatId, payload.groupFolder);
    });
    this.eventUnsubscribers.push(unsub1, unsub2);
  }

  private onMessageReceived(chatId: string, groupFolder: string): void {
    const count = (this.pendingCounts.get(groupFolder) ?? 0) + 1;
    this.pendingCounts.set(groupFolder, count);

    // Clear existing debounce timer
    const existing = this.debounceTimers.get(groupFolder);
    if (existing) clearTimeout(existing);

    // Check threshold immediately
    if (count >= this.config.messageThreshold) {
      this.pendingCounts.set(groupFolder, 0);
      this.triggerSummarization(groupFolder, chatId).catch((err) =>
        this.api.logger.error(
          `Event-triggered summarization failed for ${groupFolder}: ${err}`,
        ),
      );
      return;
    }

    // Debounce: also trigger after inactivity period
    const timer = setTimeout(() => {
      this.debounceTimers.delete(groupFolder);
      if ((this.pendingCounts.get(groupFolder) ?? 0) > 0) {
        this.pendingCounts.set(groupFolder, 0);
        this.triggerSummarization(groupFolder, chatId).catch((err) =>
          this.api.logger.error(
            `Debounce-triggered summarization failed for ${groupFolder}: ${err}`,
          ),
        );
      }
    }, this.config.debounceMs);
    this.debounceTimers.set(groupFolder, timer);
  }

  // ── Phase 1: Polling ────────────────────────────────────────────

  private startPolling(): void {
    const intervalMs = this.config.checkIntervalHours * 60 * 60 * 1000;

    // Initial check after 30s (let the system finish booting)
    this.initialTimer = setTimeout(() => {
      this.initialTimer = null;
      this.pollAllGroups().catch((err) =>
        this.api.logger.error(`Initial poll failed: ${err}`),
      );
    }, 30_000);

    // Periodic check
    this.pollTimer = setInterval(() => {
      this.pollAllGroups().catch((err) =>
        this.api.logger.error(`Poll failed: ${err}`),
      );
    }, intervalMs);
  }

  async pollAllGroups(): Promise<void> {
    const groups = this.api.getGroups();
    for (const [chatId, group] of Object.entries(groups)) {
      if (this.isProcessing.get(group.folder)) {
        this.api.logger.debug(
          `Skipping ${group.folder} — already processing`,
        );
        continue;
      }
      if (this.checkThreshold(chatId)) {
        await this.triggerSummarization(group.folder, chatId);
      }
    }
  }

  private checkThreshold(chatJid: string): boolean {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM messages WHERE chat_jid = ?')
      .get(chatJid) as { count: number } | undefined;
    const count = row?.count ?? 0;
    return count >= this.config.messageThreshold && count >= this.config.minMessages;
  }

  // ── Core ─────────────────────────────────────────────────────────

  private async triggerSummarization(
    groupFolder: string,
    chatJid: string,
  ): Promise<void> {
    if (this.isProcessing.get(groupFolder)) return;
    if (this.activeCount >= this.config.maxConcurrent) return;
    this.isProcessing.set(groupFolder, true);
    this.activeCount++;

    const taskId = this.createTask(groupFolder, chatJid);
    this.api.logger.info(
      `Starting summarization for ${groupFolder} (task ${taskId})`,
    );

    try {
      this.updateTaskStatus(taskId, 'processing');

      // Use injected summarizer or dynamic import from host app
      let summarize = this.injectedSummarize;
      if (!summarize) {
        const summarizerPath = join(process.cwd(), 'src', 'memory-summarizer.js');
        const mod = (await import(summarizerPath)) as {
          summarizeConversation: SummarizeFunction;
        };
        summarize = mod.summarizeConversation;
      }

      // Find group config
      const groups = this.api.getGroups();
      const group = Object.values(groups).find((g) => g.folder === groupFolder);
      if (!group) {
        this.updateTaskFailed(taskId, 'Group not found in registry');
        return;
      }

      const result = await summarize(group, chatJid);

      if (result) {
        this.updateTaskCompleted(taskId);
        this.eventBus?.emit('memory:summarized', { groupFolder, chunkIndex: taskId });
        this.api.logger.info(
          `Summarization completed for ${groupFolder}: ${result.messagesProcessed} messages`,
        );
      } else {
        this.updateTaskCompleted(taskId);
        this.api.logger.info(
          `Summarization skipped for ${groupFolder} (no messages to process)`,
        );
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.updateTaskFailed(taskId, error);
      this.api.logger.error(
        `Summarization failed for ${groupFolder}: ${error}`,
      );
    } finally {
      this.isProcessing.set(groupFolder, false);
      this.activeCount--;
    }
  }

  // ── Crash Recovery ───────────────────────────────────────────────

  private async recoverCrashedTasks(): Promise<void> {
    const crashed = this.db
      .prepare(
        `SELECT * FROM memorization_tasks WHERE status IN ('pending', 'processing')`,
      )
      .all() as MemorizationTask[];

    if (crashed.length === 0) return;

    this.api.logger.warn(
      `Recovering ${crashed.length} crashed memorization task(s)`,
    );

    for (const task of crashed) {
      this.api.logger.warn(
        `Recovering task ${task.id} for ${task.group_folder} (was ${task.status})`,
      );
      await this.triggerSummarization(task.group_folder, task.chat_jid);
    }
  }

  // ── DB Operations ────────────────────────────────────────────────

  private createTask(groupFolder: string, chatJid: string): number {
    const now = new Date().toISOString();
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM messages WHERE chat_jid = ?')
      .get(chatJid) as { count: number } | undefined;
    const messageCount = row?.count ?? 0;

    const result = this.db
      .prepare(
        `INSERT INTO memorization_tasks (group_folder, chat_jid, status, created_at, updated_at, message_count)
         VALUES (?, ?, 'pending', ?, ?, ?)`,
      )
      .run(groupFolder, chatJid, now, now, messageCount);

    return Number(result.lastInsertRowid);
  }

  private updateTaskStatus(id: number, status: string): void {
    this.db
      .prepare(
        'UPDATE memorization_tasks SET status = ?, updated_at = ? WHERE id = ?',
      )
      .run(status, new Date().toISOString(), id);
  }

  private updateTaskCompleted(id: number): void {
    this.db
      .prepare(
        'UPDATE memorization_tasks SET status = ?, updated_at = ? WHERE id = ?',
      )
      .run('completed', new Date().toISOString(), id);
  }

  private updateTaskFailed(id: number, error: string): void {
    this.db
      .prepare(
        'UPDATE memorization_tasks SET status = ?, error = ?, updated_at = ? WHERE id = ?',
      )
      .run('failed', error, new Date().toISOString(), id);
  }
}
