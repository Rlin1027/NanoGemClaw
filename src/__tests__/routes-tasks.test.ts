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
  getTaskRunLogsWithDetails: vi.fn(() => []),
  getTasksInDateRange: vi.fn(() => []),
}));

vi.mock('../utils/pagination.js', () => ({
  parsePagination: vi.fn(() => ({ limit: 20, offset: 0 })),
}));

vi.mock('cron-parser', () => ({
  CronExpressionParser: {
    parse: vi.fn(() => {
      const dates = [
        new Date('2026-03-01T09:00:00Z'),
        new Date('2026-03-02T09:00:00Z'),
      ];
      let idx = 0;
      return {
        next: vi.fn(() => {
          if (idx >= dates.length) throw new Error('Out of range');
          const d = dates[idx++];
          return { toDate: () => d, toISOString: () => d.toISOString() };
        }),
      };
    }),
  },
}));

vi.mock('../natural-schedule.js', () => ({
  parseNaturalSchedule: vi.fn(() => ({
    schedule_type: 'interval',
    schedule_value: '3600000',
  })),
}));

vi.mock('../task-scheduler.js', () => ({ forceRunTask: vi.fn() }));

import request from 'supertest';
import { createTestApp, createMockDeps } from './helpers/route-test-setup.js';
import { createTasksRouter } from '../routes/tasks.js';
import * as dbModule from '../db.js';
import { CronExpressionParser } from 'cron-parser';
import { forceRunTask } from '../task-scheduler.js';

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
    vi.mocked(dbModule.getTaskRunLogsWithDetails).mockReturnValue([]);
    vi.mocked(dbModule.getTasksInDateRange).mockReturnValue([]);
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
    // Reset cron-parser mock to default working implementation
    vi.mocked(CronExpressionParser.parse).mockImplementation(() => {
      const dates = [
        new Date('2026-03-01T09:00:00Z'),
        new Date('2026-03-02T09:00:00Z'),
      ];
      let idx = 0;
      return {
        next: vi.fn(() => {
          if (idx >= dates.length) throw new Error('Out of range');
          const d = dates[idx++];
          return { toDate: () => d, toISOString: () => d.toISOString() };
        }),
      } as any;
    });
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

  // GET /api/task-runs
  describe('GET /api/task-runs', () => {
    it('returns activity logs with default days', async () => {
      vi.mocked(dbModule.getTaskRunLogsWithDetails).mockReturnValue([
        { id: 1 },
      ] as any);
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).get('/api/task-runs');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(1);
    });

    it('passes days param to db function', async () => {
      vi.mocked(dbModule.getTaskRunLogsWithDetails).mockReturnValue([]);
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).get('/api/task-runs?days=14');
      expect(res.status).toBe(200);
      expect(dbModule.getTaskRunLogsWithDetails).toHaveBeenCalledWith(
        14,
        undefined,
      );
    });

    it('passes groupFolder param to db function', async () => {
      vi.mocked(dbModule.getTaskRunLogsWithDetails).mockReturnValue([]);
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).get('/api/task-runs?groupFolder=grp1');
      expect(res.status).toBe(200);
      expect(dbModule.getTaskRunLogsWithDetails).toHaveBeenCalledWith(
        7,
        'grp1',
      );
    });

    it('returns 500 on db error', async () => {
      vi.mocked(dbModule.getTaskRunLogsWithDetails).mockImplementation(() => {
        throw new Error('DB error');
      });
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).get('/api/task-runs');
      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('error');
    });
  });

  // GET /api/tasks/week
  describe('GET /api/tasks/week', () => {
    const start = '2026-03-01T00:00:00.000Z';
    const end = '2026-03-07T23:59:59.000Z';

    it('returns empty slots when no tasks', async () => {
      vi.mocked(dbModule.getTasksInDateRange).mockReturnValue([]);
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).get(
        `/api/tasks/week?start=${start}&end=${end}`,
      );
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('returns 400 when start missing', async () => {
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).get(`/api/tasks/week?end=${end}`);
      expect(res.status).toBe(400);
    });

    it('returns 400 when end missing', async () => {
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).get(`/api/tasks/week?start=${start}`);
      expect(res.status).toBe(400);
    });

    it('returns slots for cron tasks', async () => {
      vi.mocked(dbModule.getTasksInDateRange).mockReturnValue([
        {
          id: 'task-cron',
          group_folder: 'grp1',
          prompt: 'Cron task',
          schedule_type: 'cron',
          schedule_value: '0 9 * * *',
          status: 'active',
          next_run: null,
        },
      ] as any);
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).get(
        `/api/tasks/week?start=${start}&end=${end}`,
      );
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      // mock returns 2 dates within range
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0]).toHaveProperty('task_id', 'task-cron');
      expect(res.body.data[0]).toHaveProperty('schedule_type', 'cron');
    });

    it('returns slots for interval tasks', async () => {
      vi.mocked(dbModule.getTasksInDateRange).mockReturnValue([
        {
          id: 'task-interval',
          group_folder: 'grp1',
          prompt: 'Interval task',
          schedule_type: 'interval',
          schedule_value: '3600000', // 1 hour
          status: 'active',
          next_run: '2026-03-01T09:00:00.000Z',
        },
      ] as any);
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).get(
        `/api/tasks/week?start=${start}&end=${end}`,
      );
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0]).toHaveProperty('task_id', 'task-interval');
      expect(res.body.data[0]).toHaveProperty('schedule_type', 'interval');
    });

    it('returns slot for once task', async () => {
      vi.mocked(dbModule.getTasksInDateRange).mockReturnValue([
        {
          id: 'task-once',
          group_folder: 'grp1',
          prompt: 'Once task',
          schedule_type: 'once',
          schedule_value: '2026-03-03T10:00:00.000Z',
          status: 'active',
          next_run: '2026-03-03T10:00:00.000Z',
        },
      ] as any);
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).get(
        `/api/tasks/week?start=${start}&end=${end}`,
      );
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toHaveProperty('task_id', 'task-once');
      expect(res.body.data[0]).toHaveProperty(
        'start_time',
        '2026-03-03T10:00:00.000Z',
      );
    });

    it('skips interval tasks with invalid schedule_value', async () => {
      vi.mocked(dbModule.getTasksInDateRange).mockReturnValue([
        {
          id: 'task-bad-interval',
          group_folder: 'grp1',
          prompt: 'Bad interval',
          schedule_type: 'interval',
          schedule_value: 'notanumber',
          status: 'active',
          next_run: '2026-03-01T09:00:00.000Z',
        },
      ] as any);
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).get(
        `/api/tasks/week?start=${start}&end=${end}`,
      );
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('skips cron tasks with invalid cron expression', async () => {
      vi.mocked(CronExpressionParser.parse).mockImplementationOnce(() => {
        throw new Error('Invalid cron');
      });
      vi.mocked(dbModule.getTasksInDateRange).mockReturnValue([
        {
          id: 'task-bad-cron',
          group_folder: 'grp1',
          prompt: 'Bad cron',
          schedule_type: 'cron',
          schedule_value: 'bad cron',
          status: 'active',
          next_run: null,
        },
      ] as any);
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).get(
        `/api/tasks/week?start=${start}&end=${end}`,
      );
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  // POST /api/tasks/:taskId/run
  describe('POST /api/tasks/:taskId/run', () => {
    it('force-runs a task and returns success', async () => {
      vi.mocked(forceRunTask).mockResolvedValue('Task completed' as any);
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).post('/api/tasks/task-123/run');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('result', 'Task completed');
      expect(forceRunTask).toHaveBeenCalledWith('task-123');
    });

    it('returns 400 when forceRunTask throws', async () => {
      vi.mocked(forceRunTask).mockRejectedValue(new Error('Task not found'));
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).post('/api/tasks/task-123/run');
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'Task not found');
    });
  });

  // PUT /api/tasks/:taskId schedule updates
  describe('PUT /api/tasks/:taskId schedule recalculation', () => {
    it('recalculates next_run when cron schedule_value changes', async () => {
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app)
        .put('/api/tasks/task-123')
        .send({ schedule_type: 'cron', schedule_value: '0 10 * * *' });
      expect(res.status).toBe(200);
      expect(dbModule.updateTask).toHaveBeenCalledWith(
        'task-123',
        expect.objectContaining({ next_run: expect.any(String) }),
      );
    });

    it('recalculates next_run when interval schedule_value changes', async () => {
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
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app)
        .put('/api/tasks/task-123')
        .send({ schedule_type: 'interval', schedule_value: '120000' });
      expect(res.status).toBe(200);
      expect(dbModule.updateTask).toHaveBeenCalledWith(
        'task-123',
        expect.objectContaining({ next_run: expect.any(String) }),
      );
    });

    it('returns 400 for invalid cron expression on update', async () => {
      vi.mocked(CronExpressionParser.parse).mockImplementationOnce(() => {
        throw new Error('Invalid cron');
      });
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app)
        .put('/api/tasks/task-123')
        .send({ schedule_type: 'cron', schedule_value: 'bad cron' });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'Invalid cron expression');
    });

    it('returns 400 for invalid interval value on update', async () => {
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app)
        .put('/api/tasks/task-123')
        .send({ schedule_type: 'interval', schedule_value: 'notanumber' });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'Invalid interval value');
    });
  });

  // POST /api/tasks natural_schedule null path
  describe('POST /api/tasks natural_schedule null', () => {
    it('returns 400 when parseNaturalSchedule returns null', async () => {
      const { parseNaturalSchedule } = await import('../natural-schedule.js');
      vi.mocked(parseNaturalSchedule).mockReturnValueOnce(null as any);
      const app = createTestApp(createTasksRouter(createTasksDeps()));
      const res = await request(app).post('/api/tasks').send({
        group_folder: 'grp1',
        prompt: 'Something',
        natural_schedule: 'gibberish that cannot be parsed',
      });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
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
