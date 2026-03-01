import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { MemorizationService } from '../memorization.js';
import type { PluginApi } from '@nanogemclaw/plugin-api';

function createTestDb(): InstanceType<typeof Database> {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL,
      chat_jid TEXT NOT NULL,
      sender TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      is_bot INTEGER NOT NULL DEFAULT 0,
      message_thread_id TEXT
    )
  `);
  return db;
}

function createMockApi(db: InstanceType<typeof Database>): PluginApi {
  return {
    getDatabase: () => db as unknown,
    sendMessage: vi.fn(),
    getGroups: vi.fn(() => ({
      '12345': {
        name: 'Test Group',
        folder: 'test-group',
        trigger: '@bot',
        added_at: '2024-01-01',
      },
    })),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    config: {},
    dataDir: '/tmp/test-memorization',
  };
}

function insertMessages(
  db: InstanceType<typeof Database>,
  chatJid: string,
  count: number,
): void {
  const stmt = db.prepare(
    `INSERT INTO messages (message_id, chat_jid, sender, sender_name, content, timestamp, is_bot)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
  );
  for (let i = 0; i < count; i++) {
    stmt.run(
      `msg-${i}`,
      chatJid,
      'user1',
      'User',
      `Message ${i}`,
      new Date(Date.now() - (count - i) * 60000).toISOString(),
    );
  }
}

describe('MemorizationService', () => {
  let db: InstanceType<typeof Database>;
  let api: PluginApi;
  let service: MemorizationService;
  const mockSummarize = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    db = createTestDb();
    api = createMockApi(db);
    // Inject mock summarizer via DI — no dynamic imports needed
    service = new MemorizationService(api, { summarize: mockSummarize });
    service.initTable();
    mockSummarize.mockReset();
  });

  afterEach(async () => {
    await service.stop();
    db.close();
    vi.useRealTimers();
  });

  // ── Table creation ─────────────────────────────────────────────

  describe('initTable', () => {
    it('should create memorization_tasks table', () => {
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='memorization_tasks'",
        )
        .all() as Array<{ name: string }>;
      expect(tables).toHaveLength(1);
    });

    it('should be idempotent', () => {
      service.initTable();
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='memorization_tasks'",
        )
        .all() as Array<{ name: string }>;
      expect(tables).toHaveLength(1);
    });
  });

  // ── Threshold checking ─────────────────────────────────────────

  describe('threshold checking', () => {
    it('should not trigger for groups below threshold', async () => {
      insertMessages(db, '12345', 5);
      await service.pollAllGroups();
      const tasks = db
        .prepare('SELECT * FROM memorization_tasks')
        .all() as Array<{ id: number }>;
      expect(tasks).toHaveLength(0);
      expect(mockSummarize).not.toHaveBeenCalled();
    });

    it('should trigger for groups at threshold', async () => {
      insertMessages(db, '12345', 20);
      mockSummarize.mockResolvedValue({
        summary: 'Test summary',
        messagesProcessed: 20,
        charsProcessed: 200,
      });
      await service.pollAllGroups();
      const tasks = db
        .prepare('SELECT * FROM memorization_tasks')
        .all() as Array<{ id: number; status: string }>;
      expect(tasks).toHaveLength(1);
      expect(tasks[0].status).toBe('completed');
      expect(mockSummarize).toHaveBeenCalledOnce();
    });

    it('should trigger for groups above threshold', async () => {
      insertMessages(db, '12345', 30);
      mockSummarize.mockResolvedValue({
        summary: 'Test',
        messagesProcessed: 30,
        charsProcessed: 300,
      });
      await service.pollAllGroups();
      expect(mockSummarize).toHaveBeenCalledOnce();
    });
  });

  // ── Processing lock ────────────────────────────────────────────

  describe('processing lock', () => {
    it('should prevent concurrent summarization of same group', async () => {
      insertMessages(db, '12345', 25);

      let resolvePromise!: () => void;
      mockSummarize.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePromise = () =>
              resolve({
                summary: 'done',
                messagesProcessed: 25,
                charsProcessed: 250,
              });
          }),
      );

      const first = service.pollAllGroups();
      // Second poll should skip the already-processing group
      await service.pollAllGroups();

      const tasks = db
        .prepare('SELECT * FROM memorization_tasks')
        .all() as Array<{ id: number }>;
      // Only 1 task because second poll skipped
      expect(tasks).toHaveLength(1);

      resolvePromise();
      await first;
    });
  });

  // ── Crash recovery ─────────────────────────────────────────────

  describe('crash recovery', () => {
    it('should re-process pending tasks on start', async () => {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO memorization_tasks (group_folder, chat_jid, status, created_at, updated_at, message_count)
         VALUES (?, ?, 'pending', ?, ?, ?)`,
      ).run('test-group', '12345', now, now, 10);

      insertMessages(db, '12345', 5);
      mockSummarize.mockResolvedValue({
        summary: 'Recovered',
        messagesProcessed: 5,
        charsProcessed: 50,
      });

      await service.start();

      expect(mockSummarize).toHaveBeenCalled();
      const completed = db
        .prepare(
          "SELECT * FROM memorization_tasks WHERE status = 'completed'",
        )
        .all() as Array<{ id: number }>;
      expect(completed.length).toBeGreaterThanOrEqual(1);
    });

    it('should re-process stuck processing tasks', async () => {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO memorization_tasks (group_folder, chat_jid, status, created_at, updated_at, message_count)
         VALUES (?, ?, 'processing', ?, ?, ?)`,
      ).run('test-group', '12345', now, now, 15);

      mockSummarize.mockResolvedValue(null);
      await service.start();

      expect(api.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Recovering'),
      );
    });
  });

  // ── Task status tracking ───────────────────────────────────────

  describe('task status tracking', () => {
    it('should record failed status on error', async () => {
      insertMessages(db, '12345', 25);
      mockSummarize.mockRejectedValue(new Error('Gemini timeout'));

      await service.pollAllGroups();

      const tasks = db
        .prepare('SELECT * FROM memorization_tasks')
        .all() as Array<{ status: string; error: string | null }>;
      expect(tasks).toHaveLength(1);
      expect(tasks[0].status).toBe('failed');
      expect(tasks[0].error).toContain('Gemini timeout');
    });

    it('should record message count at task creation', async () => {
      insertMessages(db, '12345', 30);
      mockSummarize.mockResolvedValue({
        summary: 'Test',
        messagesProcessed: 30,
        charsProcessed: 300,
      });

      await service.pollAllGroups();

      const tasks = db
        .prepare('SELECT * FROM memorization_tasks')
        .all() as Array<{ message_count: number }>;
      expect(tasks[0].message_count).toBe(30);
    });

    it('should mark null result as completed', async () => {
      insertMessages(db, '12345', 20);
      mockSummarize.mockResolvedValue(null);

      await service.pollAllGroups();

      const tasks = db
        .prepare('SELECT * FROM memorization_tasks')
        .all() as Array<{ status: string }>;
      expect(tasks[0].status).toBe('completed');
    });
  });

  // ── Polling lifecycle ──────────────────────────────────────────

  describe('polling lifecycle', () => {
    it('should stop cleanly', async () => {
      await service.start();
      await service.stop();
      // Advance time past polling interval — should not throw
      await vi.advanceTimersByTimeAsync(5 * 60 * 60 * 1000);
    });
  });

  // ── Config overrides ────────────────────────────────────────

  describe('config overrides', () => {
    it('should respect custom messageThreshold', async () => {
      const customService = new MemorizationService(api, {
        summarize: mockSummarize,
        config: { messageThreshold: 5 },
      });
      customService.initTable();

      insertMessages(db, '12345', 5);
      mockSummarize.mockResolvedValue({
        summary: 'Test',
        messagesProcessed: 5,
        charsProcessed: 50,
      });

      await customService.pollAllGroups();
      expect(mockSummarize).toHaveBeenCalledOnce();
      await customService.stop();
    });

    it('should enforce minMessages floor in polling', async () => {
      const customService = new MemorizationService(api, {
        summarize: mockSummarize,
        config: { messageThreshold: 3, minMessages: 10 },
      });
      customService.initTable();

      // 5 messages: above threshold (3) but below minMessages (10)
      insertMessages(db, '12345', 5);
      await customService.pollAllGroups();
      expect(mockSummarize).not.toHaveBeenCalled();

      // 10 messages: meets both thresholds
      insertMessages(db, '12345', 5); // total now 10
      mockSummarize.mockResolvedValue({
        summary: 'ok',
        messagesProcessed: 10,
        charsProcessed: 100,
      });
      await customService.pollAllGroups();
      expect(mockSummarize).toHaveBeenCalledOnce();
      await customService.stop();
    });

    it('should enforce maxConcurrent limit', async () => {
      // maxConcurrent=1 means only 1 group can be processed at a time
      const multiGroupApi = {
        ...api,
        getGroups: vi.fn(() => ({
          '111': { name: 'G1', folder: 'g1', trigger: '@bot', added_at: '2024-01-01' },
          '222': { name: 'G2', folder: 'g2', trigger: '@bot', added_at: '2024-01-01' },
        })),
      };

      const customService = new MemorizationService(multiGroupApi, {
        summarize: mockSummarize,
        config: { maxConcurrent: 1 },
      });
      customService.initTable();

      insertMessages(db, '111', 25);
      insertMessages(db, '222', 25);

      let resolveFirst!: () => void;
      let callCount = 0;
      mockSummarize.mockImplementation(
        () =>
          new Promise((resolve) => {
            callCount++;
            if (callCount === 1) {
              resolveFirst = () => resolve({ summary: 'done', messagesProcessed: 25, charsProcessed: 250 });
            } else {
              resolve({ summary: 'done', messagesProcessed: 25, charsProcessed: 250 });
            }
          }),
      );

      const poll = customService.pollAllGroups();
      // First group starts but second should be skipped due to maxConcurrent=1
      expect(mockSummarize).toHaveBeenCalledTimes(1);
      resolveFirst();
      await poll;
      await customService.stop();
    });
  });

  // ── Event Bus integration ───────────────────────────────────

  describe('event bus integration', () => {
    it('should subscribe to message:sent events', () => {
      const mockEventBus = {
        on: vi.fn(() => vi.fn()),
        emit: vi.fn(),
      } as unknown as import('@nanogemclaw/event-bus').EventBus;

      service.subscribeToEvents(mockEventBus);

      expect(mockEventBus.on).toHaveBeenCalledWith('message:received', expect.any(Function));
      expect(mockEventBus.on).toHaveBeenCalledWith('message:sent', expect.any(Function));
    });

    it('should emit memory:summarized on successful summarization', async () => {
      const mockEventBus = {
        on: vi.fn(() => vi.fn()),
        emit: vi.fn(),
      } as unknown as import('@nanogemclaw/event-bus').EventBus;

      service.subscribeToEvents(mockEventBus);
      insertMessages(db, '12345', 25);
      mockSummarize.mockResolvedValue({
        summary: 'Test summary',
        messagesProcessed: 25,
        charsProcessed: 250,
      });

      await service.pollAllGroups();

      expect(mockEventBus.emit).toHaveBeenCalledWith('memory:summarized', {
        groupFolder: 'test-group',
        chunkIndex: expect.any(Number),
      });
    });

    it('should not emit memory:summarized when result is null', async () => {
      const mockEventBus = {
        on: vi.fn(() => vi.fn()),
        emit: vi.fn(),
      } as unknown as import('@nanogemclaw/event-bus').EventBus;

      service.subscribeToEvents(mockEventBus);
      insertMessages(db, '12345', 20);
      mockSummarize.mockResolvedValue(null);

      await service.pollAllGroups();

      expect(mockEventBus.emit).not.toHaveBeenCalled();
    });
  });
});
