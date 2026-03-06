import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks
const mockInsertToolCallLog = vi.hoisted(() => vi.fn().mockReturnValue(1));
const mockGetToolCallLogs = vi.hoisted(() =>
  vi.fn().mockReturnValue({ rows: [], total: 0 }),
);
const mockGetToolCallStats = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    total_calls: 0,
    unique_tools: 0,
    avg_duration_ms: null,
    injection_count: 0,
    by_status: [],
    by_tool: [],
  }),
);
const mockRunBeforeToolCallHooks = vi.hoisted(() =>
  vi.fn().mockResolvedValue(null),
);
const mockRunAfterToolCallHooks = vi.hoisted(() =>
  vi.fn().mockResolvedValue(null),
);

vi.mock('../db.js', () => ({
  insertToolCallLog: mockInsertToolCallLog,
  getToolCallLogs: mockGetToolCallLogs,
  getToolCallStats: mockGetToolCallStats,
  getTasksForGroup: vi.fn().mockReturnValue([]),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  getTaskById: vi.fn().mockReturnValue(null),
  upsertFact: vi.fn(),
  getFact: vi.fn().mockReturnValue(null),
  getAllFacts: vi.fn().mockReturnValue([]),
  deleteFact: vi.fn(),
  getDatabase: vi.fn(),
}));

vi.mock('../../app/src/plugin-loader.js', () => ({
  runBeforeToolCallHooks: mockRunBeforeToolCallHooks,
  runAfterToolCallHooks: mockRunAfterToolCallHooks,
  dispatchPluginToolCall: vi.fn().mockResolvedValue(null),
}));

vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../fast-path.js', () => ({
  resolvePreferredPath: vi.fn().mockReturnValue('main'),
}));

vi.mock('@nanogemclaw/core', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  SAFE_FOLDER_RE: /^[a-zA-Z0-9_-]+$/,
}));

vi.mock('../zod-tools.js', () => ({
  validateToolInput: vi.fn().mockReturnValue({ valid: true, data: {} }),
}));

vi.mock('../config.js', () => ({
  TIMEZONE: 'UTC',
  DATA_DIR: '/tmp/test-data',
}));

describe('tool call audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunBeforeToolCallHooks.mockResolvedValue(null);
    mockRunAfterToolCallHooks.mockResolvedValue(null);
  });

  describe('sanitizeArgs (via executeFunctionCall)', () => {
    it('logs audit entry on successful tool call', async () => {
      const { executeFunctionCall } = await import('../gemini-tools.js');
      const context = { isMain: true, bot: null, registerGroup: null };

      await executeFunctionCall(
        'list_tasks',
        {},
        context as any,
        'main',
        '-100123',
      );

      expect(mockInsertToolCallLog).toHaveBeenCalledWith(
        expect.objectContaining({
          group_folder: 'main',
          chat_jid: '-100123',
          tool_name: 'list_tasks',
          result_status: 'success',
        }),
      );
    });

    it('logs audit entry with result_status=blocked when tool is blocked', async () => {
      mockRunBeforeToolCallHooks.mockResolvedValue({ reason: 'rate limit' });

      const { executeFunctionCall } = await import('../gemini-tools.js');
      const context = { isMain: true, bot: null, registerGroup: null };

      const result = await executeFunctionCall(
        'list_tasks',
        {},
        context as any,
        'main',
        '-100123',
      );

      expect(result.response).toMatchObject({ success: false });
      expect(mockInsertToolCallLog).toHaveBeenCalledWith(
        expect.objectContaining({
          tool_name: 'list_tasks',
          result_status: 'blocked',
        }),
      );
    });

    it('includes duration_ms in audit log', async () => {
      const { executeFunctionCall } = await import('../gemini-tools.js');
      const context = { isMain: true, bot: null, registerGroup: null };

      await executeFunctionCall(
        'list_tasks',
        {},
        context as any,
        'main',
        '-100123',
      );

      const call = mockInsertToolCallLog.mock.calls[0][0];
      expect(typeof call.duration_ms).toBe('number');
      expect(call.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('redacts sensitive args in args_summary', async () => {
      const { executeFunctionCall } = await import('../gemini-tools.js');
      const context = { isMain: true, bot: null, registerGroup: null };
      const sensitiveArgs = {
        api_key: 'sk-super-secret-token',
        prompt: 'hello',
      };

      await executeFunctionCall(
        'list_tasks',
        sensitiveArgs,
        context as any,
        'main',
        '-100123',
      );

      const call = mockInsertToolCallLog.mock.calls[0][0];
      expect(call.args_summary).not.toContain('sk-super-secret-token');
    });

    it('truncates long args_summary to 200 chars + ellipsis', async () => {
      const { executeFunctionCall } = await import('../gemini-tools.js');
      const context = { isMain: true, bot: null, registerGroup: null };
      const longArgs = { prompt: 'x'.repeat(500) };

      await executeFunctionCall(
        'list_tasks',
        longArgs,
        context as any,
        'main',
        '-100123',
      );

      const call = mockInsertToolCallLog.mock.calls[0][0];
      expect(call.args_summary!.length).toBeLessThanOrEqual(202); // 200 + '…'
    });
  });

  describe('GET /api/tool-calls route', () => {
    it('returns paginated tool call logs', async () => {
      const { createToolCallsRouter } = await import('../routes/tool-calls.js');
      const express = (await import('express')).default;
      const app = express();
      app.use(express.json());
      app.use('/api', createToolCallsRouter());

      const { default: request } = await import('supertest');
      mockGetToolCallLogs.mockReturnValue({
        rows: [
          {
            id: 1,
            group_folder: 'main',
            chat_jid: '-100123',
            tool_name: 'list_tasks',
            args_summary: '{}',
            result_status: 'success',
            duration_ms: 42,
            injection_detected: 0,
            injection_patterns: null,
            created_at: '2026-03-05T00:00:00.000Z',
          },
        ],
        total: 1,
      });

      const res = await request(app).get('/api/tool-calls?page=1&limit=50');
      expect(res.status).toBe(200);
      expect(res.body.data.records).toHaveLength(1);
      expect(res.body.data.total).toBe(1);
    });

    it('filters by group param', async () => {
      const { createToolCallsRouter } = await import('../routes/tool-calls.js');
      const express = (await import('express')).default;
      const app = express();
      app.use(express.json());
      app.use('/api', createToolCallsRouter());

      const { default: request } = await import('supertest');
      mockGetToolCallLogs.mockReturnValue({ rows: [], total: 0 });

      await request(app).get('/api/tool-calls?group=main');
      expect(mockGetToolCallLogs).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        'main',
        false,
      );
    });

    it('filters injection=true', async () => {
      const { createToolCallsRouter } = await import('../routes/tool-calls.js');
      const express = (await import('express')).default;
      const app = express();
      app.use(express.json());
      app.use('/api', createToolCallsRouter());

      const { default: request } = await import('supertest');
      mockGetToolCallLogs.mockReturnValue({ rows: [], total: 0 });

      await request(app).get('/api/tool-calls?injection=true');
      expect(mockGetToolCallLogs).toHaveBeenCalledWith(
        expect.any(Number),
        expect.any(Number),
        undefined,
        true,
      );
    });
  });

  describe('GET /api/tool-calls/stats route', () => {
    it('returns stats', async () => {
      const { createToolCallsRouter } = await import('../routes/tool-calls.js');
      const express = (await import('express')).default;
      const app = express();
      app.use(express.json());
      app.use('/api', createToolCallsRouter());

      const { default: request } = await import('supertest');
      mockGetToolCallStats.mockReturnValue({
        total_calls: 10,
        unique_tools: 3,
        avg_duration_ms: 50,
        injection_count: 1,
        by_status: [{ result_status: 'success', count: 9 }],
        by_tool: [{ tool_name: 'list_tasks', count: 5 }],
      });

      const res = await request(app).get('/api/tool-calls/stats');
      expect(res.status).toBe(200);
      expect(res.body.data.total_calls).toBe(10);
      expect(res.body.data.injection_count).toBe(1);
    });
  });
});
