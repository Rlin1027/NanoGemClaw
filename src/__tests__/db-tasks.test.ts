import {
  vi,
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from 'vitest';

// Use vi.hoisted so TEST_STORE_DIR is available inside vi.mock factory
// Note: vi.hoisted runs before all imports, so we must use require() for node builtins
const { TEST_STORE_DIR } = vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  const _os = require('os') as typeof import('os');
  const _path = require('path') as typeof import('path');
  const TEST_STORE_DIR = _path.join(
    _os.tmpdir(),
    `nanogemclaw-test-${Date.now()}`,
  );
  return { TEST_STORE_DIR };
});

// Mock config to use temporary directory
vi.mock('../config.js', () => ({
  STORE_DIR: TEST_STORE_DIR,
}));

// Import db functions after mocking
import {
  initDatabase,
  closeDatabase,
  createTask,
  getTaskById,
  getTasksForGroup,
  getAllTasks,
  updateTask,
  deleteTask,
  getDueTasks,
  updateTaskAfterRun,
  logTaskRun,
  getTaskRunLogs,
} from '../db.js';
import { resetDatabase, cleanupTestDir } from './helpers/db-test-setup.js';

describe('db/tasks', () => {
  beforeAll(() => {
    initDatabase();
  });

  afterAll(() => {
    closeDatabase();
    cleanupTestDir(TEST_STORE_DIR);
  });

  describe('Scheduled Tasks', () => {
    beforeEach(() => resetDatabase(TEST_STORE_DIR));

    it('should create a scheduled task', () => {
      const task = {
        id: 'task1',
        group_folder: 'group1',
        chat_jid: 'chat1@g.us',
        prompt: 'Daily summary',
        schedule_type: 'cron' as const,
        schedule_value: '0 9 * * *',
        context_mode: 'group' as const,
        next_run: '2026-02-09T09:00:00Z',
        status: 'active' as const,
        created_at: '2026-02-08T10:00:00Z',
      };

      createTask(task);

      const retrieved = getTaskById('task1');
      expect(retrieved).toBeDefined();
      expect(retrieved?.prompt).toBe('Daily summary');
      expect(retrieved?.context_mode).toBe('group');
    });

    it('should create task with isolated context mode', () => {
      const task = {
        id: 'task2',
        group_folder: 'group1',
        chat_jid: 'chat1@g.us',
        prompt: 'Test',
        schedule_type: 'once' as const,
        schedule_value: '2026-02-09T10:00:00Z',
        context_mode: 'isolated' as const,
        next_run: '2026-02-09T10:00:00Z',
        status: 'active' as const,
        created_at: '2026-02-08T10:00:00Z',
      };

      createTask(task);

      const retrieved = getTaskById('task2');
      expect(retrieved?.context_mode).toBe('isolated');
    });

    it('should retrieve tasks for a group', () => {
      const task3 = {
        id: 'task3',
        group_folder: 'group2',
        chat_jid: 'chat2@g.us',
        prompt: 'Group2 task',
        schedule_type: 'interval' as const,
        schedule_value: '3600000',
        context_mode: 'isolated' as const,
        next_run: '2026-02-08T11:00:00Z',
        status: 'active' as const,
        created_at: '2026-02-08T10:00:00Z',
      };

      createTask(task3);

      const tasks = getTasksForGroup('group2');
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('task3');
    });

    it('should retrieve all tasks', () => {
      // Create some tasks first
      createTask({
        id: 'task_all_1',
        group_folder: 'group1',
        chat_jid: 'chat1@g.us',
        prompt: 'Task 1',
        schedule_type: 'once' as const,
        schedule_value: '2026-02-09T10:00:00Z',
        context_mode: 'isolated' as const,
        next_run: '2026-02-09T10:00:00Z',
        status: 'active' as const,
        created_at: '2026-02-08T10:00:00Z',
      });
      createTask({
        id: 'task_all_2',
        group_folder: 'group1',
        chat_jid: 'chat1@g.us',
        prompt: 'Task 2',
        schedule_type: 'once' as const,
        schedule_value: '2026-02-09T10:00:00Z',
        context_mode: 'isolated' as const,
        next_run: '2026-02-09T10:00:00Z',
        status: 'active' as const,
        created_at: '2026-02-08T10:00:00Z',
      });
      createTask({
        id: 'task_all_3',
        group_folder: 'group2',
        chat_jid: 'chat2@g.us',
        prompt: 'Task 3',
        schedule_type: 'once' as const,
        schedule_value: '2026-02-09T10:00:00Z',
        context_mode: 'isolated' as const,
        next_run: '2026-02-09T10:00:00Z',
        status: 'active' as const,
        created_at: '2026-02-08T10:00:00Z',
      });

      const tasks = getAllTasks();
      expect(tasks.length).toBeGreaterThanOrEqual(3);
    });

    it('should update task fields', () => {
      const taskId = 'task4';
      createTask({
        id: taskId,
        group_folder: 'group1',
        chat_jid: 'chat1@g.us',
        prompt: 'Original prompt',
        schedule_type: 'cron' as const,
        schedule_value: '0 9 * * *',
        context_mode: 'isolated' as const,
        next_run: '2026-02-09T09:00:00Z',
        status: 'active' as const,
        created_at: '2026-02-08T10:00:00Z',
      });

      updateTask(taskId, {
        prompt: 'Updated prompt',
        status: 'paused',
      });

      const retrieved = getTaskById(taskId);
      expect(retrieved?.prompt).toBe('Updated prompt');
      expect(retrieved?.status).toBe('paused');
    });

    it('should not update when no fields provided', () => {
      const taskId = 'task5';
      createTask({
        id: taskId,
        group_folder: 'group1',
        chat_jid: 'chat1@g.us',
        prompt: 'Original',
        schedule_type: 'once' as const,
        schedule_value: '2026-02-09T10:00:00Z',
        context_mode: 'isolated' as const,
        next_run: '2026-02-09T10:00:00Z',
        status: 'active' as const,
        created_at: '2026-02-08T10:00:00Z',
      });

      updateTask(taskId, {});

      const retrieved = getTaskById(taskId);
      expect(retrieved?.prompt).toBe('Original');
    });

    it('should delete task and its run logs', () => {
      const taskId = 'task6';
      createTask({
        id: taskId,
        group_folder: 'group1',
        chat_jid: 'chat1@g.us',
        prompt: 'To be deleted',
        schedule_type: 'once' as const,
        schedule_value: '2026-02-09T10:00:00Z',
        context_mode: 'isolated' as const,
        next_run: '2026-02-09T10:00:00Z',
        status: 'active' as const,
        created_at: '2026-02-08T10:00:00Z',
      });

      logTaskRun({
        task_id: taskId,
        run_at: '2026-02-08T10:00:00Z',
        duration_ms: 1000,
        status: 'success',
        result: 'Done',
        error: null,
      });

      deleteTask(taskId);

      expect(getTaskById(taskId)).toBeUndefined();
      expect(getTaskRunLogs(taskId)).toHaveLength(0);
    });

    it('should retrieve due tasks', () => {
      const now = new Date().toISOString();
      const pastTime = new Date(Date.now() - 3600000).toISOString();
      const futureTime = new Date(Date.now() + 3600000).toISOString();

      createTask({
        id: 'task7',
        group_folder: 'group1',
        chat_jid: 'chat1@g.us',
        prompt: 'Due task',
        schedule_type: 'once' as const,
        schedule_value: pastTime,
        context_mode: 'isolated' as const,
        next_run: pastTime,
        status: 'active' as const,
        created_at: now,
      });

      createTask({
        id: 'task8',
        group_folder: 'group1',
        chat_jid: 'chat1@g.us',
        prompt: 'Future task',
        schedule_type: 'once' as const,
        schedule_value: futureTime,
        context_mode: 'isolated' as const,
        next_run: futureTime,
        status: 'active' as const,
        created_at: now,
      });

      const dueTasks = getDueTasks();
      expect(dueTasks.some((t) => t.id === 'task7')).toBe(true);
      expect(dueTasks.some((t) => t.id === 'task8')).toBe(false);
    });

    it('should update task after run', () => {
      const taskId = 'task9';
      const nextRun = '2026-02-09T10:00:00Z';

      createTask({
        id: taskId,
        group_folder: 'group1',
        chat_jid: 'chat1@g.us',
        prompt: 'Test',
        schedule_type: 'interval' as const,
        schedule_value: '3600000',
        context_mode: 'isolated' as const,
        next_run: '2026-02-08T10:00:00Z',
        status: 'active' as const,
        created_at: '2026-02-08T10:00:00Z',
      });

      updateTaskAfterRun(taskId, nextRun, 'Success');

      const retrieved = getTaskById(taskId);
      expect(retrieved?.next_run).toBe(nextRun);
      expect(retrieved?.last_result).toBe('Success');
      expect(retrieved?.status).toBe('active');
    });

    it('should mark task completed when next_run is null', () => {
      const taskId = 'task10';

      createTask({
        id: taskId,
        group_folder: 'group1',
        chat_jid: 'chat1@g.us',
        prompt: 'One-time task',
        schedule_type: 'once' as const,
        schedule_value: '2026-02-08T10:00:00Z',
        context_mode: 'isolated' as const,
        next_run: '2026-02-08T10:00:00Z',
        status: 'active' as const,
        created_at: '2026-02-08T10:00:00Z',
      });

      updateTaskAfterRun(taskId, null, 'Done');

      const retrieved = getTaskById(taskId);
      expect(retrieved?.status).toBe('completed');
    });
  });

  describe('Task Run Logs', () => {
    beforeEach(() => resetDatabase(TEST_STORE_DIR));

    it('should log task run', () => {
      const taskId = 'task_log1';

      createTask({
        id: taskId,
        group_folder: 'group1',
        chat_jid: 'chat1@g.us',
        prompt: 'Test',
        schedule_type: 'once' as const,
        schedule_value: '2026-02-08T10:00:00Z',
        context_mode: 'isolated' as const,
        next_run: '2026-02-08T10:00:00Z',
        status: 'active' as const,
        created_at: '2026-02-08T10:00:00Z',
      });

      logTaskRun({
        task_id: taskId,
        run_at: '2026-02-08T10:00:00Z',
        duration_ms: 1500,
        status: 'success',
        result: 'Task completed successfully',
        error: null,
      });

      const logs = getTaskRunLogs(taskId);
      expect(logs).toHaveLength(1);
      expect(logs[0].status).toBe('success');
      expect(logs[0].duration_ms).toBe(1500);
    });

    it('should log task error', () => {
      const taskId = 'task_log2';

      createTask({
        id: taskId,
        group_folder: 'group1',
        chat_jid: 'chat1@g.us',
        prompt: 'Test',
        schedule_type: 'once' as const,
        schedule_value: '2026-02-08T10:00:00Z',
        context_mode: 'isolated' as const,
        next_run: '2026-02-08T10:00:00Z',
        status: 'active' as const,
        created_at: '2026-02-08T10:00:00Z',
      });

      logTaskRun({
        task_id: taskId,
        run_at: '2026-02-08T10:00:00Z',
        duration_ms: 500,
        status: 'error',
        result: null,
        error: 'Task failed due to timeout',
      });

      const logs = getTaskRunLogs(taskId);
      expect(logs).toHaveLength(1);
      expect(logs[0].status).toBe('error');
      expect(logs[0].error).toBe('Task failed due to timeout');
    });

    it('should limit task run logs', () => {
      const taskId = 'task_log3';

      createTask({
        id: taskId,
        group_folder: 'group1',
        chat_jid: 'chat1@g.us',
        prompt: 'Test',
        schedule_type: 'interval' as const,
        schedule_value: '3600000',
        context_mode: 'isolated' as const,
        next_run: '2026-02-08T10:00:00Z',
        status: 'active' as const,
        created_at: '2026-02-08T10:00:00Z',
      });

      // Log 15 runs
      for (let i = 0; i < 15; i++) {
        logTaskRun({
          task_id: taskId,
          run_at: `2026-02-08T${String(10 + i).padStart(2, '0')}:00:00Z`,
          duration_ms: 1000,
          status: 'success',
          result: `Run ${i}`,
          error: null,
        });
      }

      const logs = getTaskRunLogs(taskId, 5);
      expect(logs).toHaveLength(5);
    });

    it('should return logs ordered by most recent first', () => {
      const taskId = 'task_log4';

      createTask({
        id: taskId,
        group_folder: 'group1',
        chat_jid: 'chat1@g.us',
        prompt: 'Test',
        schedule_type: 'interval' as const,
        schedule_value: '3600000',
        context_mode: 'isolated' as const,
        next_run: '2026-02-08T10:00:00Z',
        status: 'active' as const,
        created_at: '2026-02-08T10:00:00Z',
      });

      logTaskRun({
        task_id: taskId,
        run_at: '2026-02-08T10:00:00Z',
        duration_ms: 1000,
        status: 'success',
        result: 'First',
        error: null,
      });

      logTaskRun({
        task_id: taskId,
        run_at: '2026-02-08T12:00:00Z',
        duration_ms: 1000,
        status: 'success',
        result: 'Latest',
        error: null,
      });

      const logs = getTaskRunLogs(taskId);
      expect(logs[0].result).toBe('Latest');
    });
  });
});
