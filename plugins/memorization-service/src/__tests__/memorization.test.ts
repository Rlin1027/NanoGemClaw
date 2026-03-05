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
    it('should mark pending tasks as failed on start', async () => {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO memorization_tasks (group_folder, chat_jid, status, created_at, updated_at, message_count)
         VALUES (?, ?, 'pending', ?, ?, ?)`,
      ).run('test-group', '12345', now, now, 10);

      await service.start();

      // Crashed tasks are marked failed, not re-executed (to avoid blocking startup)
      expect(mockSummarize).not.toHaveBeenCalled();
      const failed = db
        .prepare(
          "SELECT * FROM memorization_tasks WHERE status = 'failed'",
        )
        .all() as Array<{ id: number }>;
      expect(failed.length).toBeGreaterThanOrEqual(1);
    });

    it('should mark stuck processing tasks as failed', async () => {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO memorization_tasks (group_folder, chat_jid, status, created_at, updated_at, message_count)
         VALUES (?, ?, 'processing', ?, ?, ?)`,
      ).run('test-group', '12345', now, now, 15);

      await service.start();

      expect(api.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Marking'),
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

  // ── Event-driven triggers ───────────────────────────────────

  describe('event-driven triggers', () => {
    function setupEventBus() {
      const callbacks: Record<string, Array<(payload: { chatId: string; groupFolder: string }) => void>> = {};
      const mockEventBus = {
        on: vi.fn((event: string, cb: (payload: { chatId: string; groupFolder: string }) => void) => {
          if (!callbacks[event]) callbacks[event] = [];
          callbacks[event].push(cb);
          return vi.fn(); // unsubscribe
        }),
        emit: vi.fn(),
      } as unknown as import('@nanogemclaw/event-bus').EventBus;
      return { mockEventBus, callbacks };
    }

    it('should trigger summarization when threshold is reached via events', async () => {
      const { mockEventBus, callbacks } = setupEventBus();
      service.subscribeToEvents(mockEventBus);

      insertMessages(db, '12345', 25);
      mockSummarize.mockResolvedValue({ summary: 'ok', messagesProcessed: 25, charsProcessed: 250 });

      // Fire message:received 20 times to hit default threshold (20)
      for (let i = 0; i < 20; i++) {
        callbacks['message:received'][0]({ chatId: '12345', groupFolder: 'test-group' });
      }

      // Allow async summarization to complete
      await vi.advanceTimersByTimeAsync(100);

      expect(mockSummarize).toHaveBeenCalled();
    });

    it('should reset pending count after threshold trigger', async () => {
      const { mockEventBus, callbacks } = setupEventBus();
      service.subscribeToEvents(mockEventBus);

      insertMessages(db, '12345', 25);
      mockSummarize.mockResolvedValue({ summary: 'ok', messagesProcessed: 25, charsProcessed: 250 });

      // Trigger first summarization via threshold
      for (let i = 0; i < 20; i++) {
        callbacks['message:received'][0]({ chatId: '12345', groupFolder: 'test-group' });
      }
      await vi.advanceTimersByTimeAsync(100);

      const firstCallCount = mockSummarize.mock.calls.length;

      // Fire fewer messages than threshold — should NOT trigger again immediately
      for (let i = 0; i < 5; i++) {
        callbacks['message:received'][0]({ chatId: '12345', groupFolder: 'test-group' });
      }
      await vi.advanceTimersByTimeAsync(100);

      // Still same call count since 5 < 20 threshold
      expect(mockSummarize.mock.calls.length).toBe(firstCallCount);
    });

    it('should trigger summarization after debounce timer fires', async () => {
      const { mockEventBus, callbacks } = setupEventBus();
      service.subscribeToEvents(mockEventBus);

      insertMessages(db, '12345', 25);
      mockSummarize.mockResolvedValue({ summary: 'ok', messagesProcessed: 25, charsProcessed: 250 });

      // Fire only 5 messages (below threshold of 20)
      for (let i = 0; i < 5; i++) {
        callbacks['message:received'][0]({ chatId: '12345', groupFolder: 'test-group' });
      }

      // No summarization yet
      expect(mockSummarize).not.toHaveBeenCalled();

      // Advance time past default debounceMs (3600000ms = 1hr)
      await vi.advanceTimersByTimeAsync(3600000 + 100);

      expect(mockSummarize).toHaveBeenCalled();
    });

    it('should not trigger debounce when pending count is 0', async () => {
      const { mockEventBus, callbacks } = setupEventBus();
      service.subscribeToEvents(mockEventBus);

      insertMessages(db, '12345', 25);
      mockSummarize.mockResolvedValue({ summary: 'ok', messagesProcessed: 25, charsProcessed: 250 });

      // Fire 20 messages to trigger threshold (resets count to 0)
      for (let i = 0; i < 20; i++) {
        callbacks['message:received'][0]({ chatId: '12345', groupFolder: 'test-group' });
      }
      await vi.advanceTimersByTimeAsync(100);
      const firstCallCount = mockSummarize.mock.calls.length;

      // Advance debounce timer — count is 0 so debounce should NOT trigger again
      await vi.advanceTimersByTimeAsync(3600000 + 100);

      expect(mockSummarize.mock.calls.length).toBe(firstCallCount);
    });

    it('should handle group not found in registry gracefully', async () => {
      const { mockEventBus, callbacks } = setupEventBus();

      // Override getGroups to return empty
      const emptyGroupApi = {
        ...api,
        getGroups: vi.fn(() => ({})),
      };
      const unknownService = new MemorizationService(emptyGroupApi, { summarize: mockSummarize });
      unknownService.initTable();
      unknownService.subscribeToEvents(mockEventBus);

      insertMessages(db, '12345', 25);

      // Fire enough to hit threshold
      for (let i = 0; i < 20; i++) {
        callbacks['message:received'][0]({ chatId: '12345', groupFolder: 'unknown-folder' });
      }
      await vi.advanceTimersByTimeAsync(100);

      // summarize should NOT be called — group not found
      expect(mockSummarize).not.toHaveBeenCalled();

      // Task should be marked failed with "Group not found"
      const tasks = db
        .prepare("SELECT * FROM memorization_tasks WHERE status = 'failed'")
        .all() as Array<{ error: string }>;
      expect(tasks.length).toBeGreaterThanOrEqual(1);
      expect(tasks[0].error).toContain('Group not found');

      await unknownService.stop();
    });

    it('should respect maxConcurrent guard via event triggers', async () => {
      const { mockEventBus, callbacks } = setupEventBus();

      const limitedService = new MemorizationService(api, {
        summarize: mockSummarize,
        config: { maxConcurrent: 1 },
      });
      limitedService.initTable();
      limitedService.subscribeToEvents(mockEventBus);

      insertMessages(db, '12345', 25);

      let resolveFirst!: () => void;
      mockSummarize.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = () =>
              resolve({ summary: 'done', messagesProcessed: 25, charsProcessed: 250 });
          }),
      );
      mockSummarize.mockResolvedValue({ summary: 'done2', messagesProcessed: 25, charsProcessed: 250 });

      // First threshold trigger starts a pending summarization
      for (let i = 0; i < 20; i++) {
        callbacks['message:received'][0]({ chatId: '12345', groupFolder: 'test-group' });
      }
      await vi.advanceTimersByTimeAsync(10);

      // Second threshold trigger should be skipped (maxConcurrent=1, already processing)
      for (let i = 0; i < 20; i++) {
        callbacks['message:received'][0]({ chatId: '12345', groupFolder: 'test-group' });
      }
      await vi.advanceTimersByTimeAsync(10);

      // Only 1 call despite two threshold crossings (second skipped due to isProcessing lock)
      expect(mockSummarize).toHaveBeenCalledTimes(1);

      resolveFirst();
      await vi.advanceTimersByTimeAsync(100);
      await limitedService.stop();
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
