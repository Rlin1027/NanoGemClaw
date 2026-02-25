import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../db.js', () => ({
  getAllTasksPaginated: vi.fn(() => ({ rows: [], total: 0 })),
  getTasksForGroupPaginated: vi.fn(() => ({ rows: [], total: 0 })),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  getTaskById: vi.fn(() => ({
    id: 'task-123',
    group_folder: 'grp1',
    chat_jid: '-100123',
    prompt: 'Do something',
    schedule_type: 'interval',
    schedule_value: '60000',
    context_mode: 'isolated',
    next_run: new Date().toISOString(),
    status: 'active',
    created_at: new Date().toISOString(),
  })),
  getTaskRunLogs: vi.fn(() => []),
}));

vi.mock('../utils/pagination.js', () => ({
  parsePagination: vi.fn(() => ({ limit: 20, offset: 0 })),
}));

vi.mock('cron-parser', () => ({
  CronExpressionParser: {
    parse: vi.fn(() => ({
      next: vi.fn(() => ({ toISOString: () => new Date().toISOString() })),
    })),
  },
}));

vi.mock('../natural-schedule.js', () => ({
  parseNaturalSchedule: vi.fn(() => ({
    schedule_type: 'interval',
    schedule_value: '3600000',
  })),
}));

import request from 'supertest';
import { createTestApp, createMockDeps } from './helpers/route-test-setup.js';
import { createTasksRouter } from '../routes/tasks.js';
import * as dbModule from '../db.js';
import { CronExpressionParser } from 'cron-parser';

function createTasksDeps(overrides = {}) {
  return { ...createMockDeps(), ...overrides };
}

describe('routes/tasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset implementations that may have been overridden in error-path tests
    vi.mocked(dbModule.updateTask).mockReset();
    vi.mocked(dbModule.deleteTask).mockReset();
    vi.mocked(dbModule.createTask).mockReset();
    vi.mocked(dbModule.getTaskRunLogs).mockReturnValue([]);
    vi.mocked(dbModule.getTaskById).mockReturnValue({
      id: 'task-123',
      group_folder: 'grp1',
      chat_jid: '-100123',
      prompt: 'Do something',
      schedule_type: 'interval',
      schedule_value: '60000',
      context_mode: 'isolated',
      next_run: new Date().toISOString(),
      status: 'active',
      created_at: new Date().toISOString(),
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // GET /api/tasks
  describe('GET /api/tasks', () => {
    it('returns paginated tasks', async () => {
      vi.mocked(dbModule.getAllTasksPaginated).mockReturnValue({
        rows: [{ id: 'task-1' }] as any,
        total: 1,
      });
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).get('/api/tasks');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('pagination');
    });

    it('returns empty list when no tasks', async () => {
      vi.mocked(dbModule.getAllTasksPaginated).mockReturnValue({
        rows: [],
        total: 0,
      });
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).get('/api/tasks');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.total).toBe(0);
    });

    it('returns 500 on db error', async () => {
      vi.mocked(dbModule.getAllTasksPaginated).mockImplementation(() => {
        throw new Error('DB error');
      });
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).get('/api/tasks');
      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('error');
    });
  });

  // GET /api/tasks/group/:groupFolder
  describe('GET /api/tasks/group/:groupFolder', () => {
    it('returns tasks for a group', async () => {
      vi.mocked(dbModule.getTasksForGroupPaginated).mockReturnValue({
        rows: [{ id: 'task-1' }] as any,
        total: 1,
      });
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).get('/api/tasks/group/grp1');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('pagination');
    });

    it('returns 400 for invalid group folder', async () => {
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).get('/api/tasks/group/bad!folder');
      expect(res.status).toBe(400);
    });

    it('returns 500 on db error', async () => {
      vi.mocked(dbModule.getTasksForGroupPaginated).mockImplementation(() => {
        throw new Error('DB error');
      });
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).get('/api/tasks/group/grp1');
      expect(res.status).toBe(500);
    });
  });

  // POST /api/tasks
  describe('POST /api/tasks', () => {
    it('creates an interval task', async () => {
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).post('/api/tasks').send({
        group_folder: 'grp1',
        prompt: 'Do something',
        schedule_type: 'interval',
        schedule_value: '60000',
      });
      expect(res.status).toBe(201);
      expect(res.body.data).toHaveProperty('id');
    });

    it('creates a cron task', async () => {
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).post('/api/tasks').send({
        group_folder: 'grp1',
        prompt: 'Daily report',
        schedule_type: 'cron',
        schedule_value: '0 9 * * *',
      });
      expect(res.status).toBe(201);
      expect(res.body.data).toHaveProperty('id');
    });

    it('creates a once task', async () => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).post('/api/tasks').send({
        group_folder: 'grp1',
        prompt: 'One time task',
        schedule_type: 'once',
        schedule_value: futureDate,
      });
      expect(res.status).toBe(201);
    });

    it('parses natural schedule when provided', async () => {
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).post('/api/tasks').send({
        group_folder: 'grp1',
        prompt: 'Every hour',
        natural_schedule: 'every hour',
      });
      expect(res.status).toBe(201);
    });

    it('returns 400 when required fields missing', async () => {
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).post('/api/tasks').send({
        prompt: 'No folder',
        schedule_type: 'interval',
        schedule_value: '60000',
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid group folder', async () => {
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).post('/api/tasks').send({
        group_folder: 'bad!folder',
        prompt: 'test',
        schedule_type: 'interval',
        schedule_value: '60000',
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid cron expression', async () => {
      vi.mocked(CronExpressionParser.parse).mockImplementation(() => {
        throw new Error('Invalid cron');
      });
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).post('/api/tasks').send({
        group_folder: 'grp1',
        prompt: 'test',
        schedule_type: 'cron',
        schedule_value: 'bad cron',
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid interval value', async () => {
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).post('/api/tasks').send({
        group_folder: 'grp1',
        prompt: 'test',
        schedule_type: 'interval',
        schedule_value: 'notanumber',
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid once date', async () => {
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).post('/api/tasks').send({
        group_folder: 'grp1',
        prompt: 'test',
        schedule_type: 'once',
        schedule_value: 'not-a-date',
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for unknown schedule type', async () => {
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).post('/api/tasks').send({
        group_folder: 'grp1',
        prompt: 'test',
        schedule_type: 'weekly',
        schedule_value: 'monday',
      });
      expect(res.status).toBe(400);
    });
  });

  // PUT /api/tasks/:taskId
  describe('PUT /api/tasks/:taskId', () => {
    it('updates task prompt', async () => {
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app)
        .put('/api/tasks/task-123')
        .send({ prompt: 'New prompt' });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('success', true);
    });

    it('returns 404 when task not found', async () => {
      vi.mocked(dbModule.getTaskById).mockReturnValue(undefined as any);
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app)
        .put('/api/tasks/nonexistent')
        .send({ prompt: 'x' });
      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid status', async () => {
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app)
        .put('/api/tasks/task-123')
        .send({ status: 'invalid-status' });
      expect(res.status).toBe(400);
    });

    it('accepts valid status values', async () => {
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      for (const status of ['active', 'paused', 'completed']) {
        const res = await request(app)
          .put('/api/tasks/task-123')
          .send({ status });
        expect(res.status).toBe(200);
      }
    });

    it('returns 500 on db error', async () => {
      vi.mocked(dbModule.updateTask).mockImplementation(() => {
        throw new Error('DB error');
      });
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app)
        .put('/api/tasks/task-123')
        .send({ prompt: 'x' });
      expect(res.status).toBe(500);
    });
  });

  // DELETE /api/tasks/:taskId
  describe('DELETE /api/tasks/:taskId', () => {
    it('deletes a task', async () => {
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).delete('/api/tasks/task-123');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('success', true);
    });

    it('returns 404 when task not found', async () => {
      vi.mocked(dbModule.getTaskById).mockReturnValue(undefined as any);
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).delete('/api/tasks/nonexistent');
      expect(res.status).toBe(404);
    });

    it('returns 500 on db error', async () => {
      vi.mocked(dbModule.deleteTask).mockImplementation(() => {
        throw new Error('DB error');
      });
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).delete('/api/tasks/task-123');
      expect(res.status).toBe(500);
    });
  });

  // PUT /api/tasks/:taskId/status
  describe('PUT /api/tasks/:taskId/status', () => {
    it('pauses a task', async () => {
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app)
        .put('/api/tasks/task-123/status')
        .send({ status: 'paused' });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('success', true);
    });

    it('resumes a task', async () => {
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app)
        .put('/api/tasks/task-123/status')
        .send({ status: 'active' });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('success', true);
    });

    it('returns 400 for invalid status', async () => {
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app)
        .put('/api/tasks/task-123/status')
        .send({ status: 'completed' });
      expect(res.status).toBe(400);
    });

    it('returns 404 when task not found', async () => {
      vi.mocked(dbModule.getTaskById).mockReturnValue(undefined as any);
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app)
        .put('/api/tasks/nonexistent/status')
        .send({ status: 'paused' });
      expect(res.status).toBe(404);
    });
  });

  // GET /api/tasks/:taskId/runs
  describe('GET /api/tasks/:taskId/runs', () => {
    it('returns task run logs', async () => {
      vi.mocked(dbModule.getTaskRunLogs).mockReturnValue([{ id: 1 }] as any);
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).get('/api/tasks/task-123/runs');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('returns 400 for invalid limit', async () => {
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).get('/api/tasks/task-123/runs?limit=abc');
      expect(res.status).toBe(400);
    });

    it('accepts custom limit', async () => {
      vi.mocked(dbModule.getTaskRunLogs).mockReturnValue([]);
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).get('/api/tasks/task-123/runs?limit=25');
      expect(res.status).toBe(200);
      expect(dbModule.getTaskRunLogs).toHaveBeenCalledWith('task-123', 25);
    });

    it('returns 500 on db error', async () => {
      vi.mocked(dbModule.getTaskRunLogs).mockImplementation(() => {
        throw new Error('DB error');
      });
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).get('/api/tasks/task-123/runs');
      expect(res.status).toBe(500);
    });
  });
});
