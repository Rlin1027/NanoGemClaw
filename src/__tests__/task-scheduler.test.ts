import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Use vi.hoisted so all mock fns are available inside vi.mock factories
const {
  mockRunContainerAgent,
  mockWriteTasksSnapshot,
  mockGetAllTasks,
  mockGetDueTasks,
  mockGetTaskById,
  mockLogTaskRun,
  mockUpdateTaskAfterRun,
  mockIsMaintenanceMode,
  mockMkdirSync,
  mockLogger,
} = vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  return {
    mockRunContainerAgent: vi.fn(),
    mockWriteTasksSnapshot: vi.fn(),
    mockGetAllTasks: vi.fn(),
    mockGetDueTasks: vi.fn(),
    mockGetTaskById: vi.fn(),
    mockLogTaskRun: vi.fn(),
    mockUpdateTaskAfterRun: vi.fn(),
    mockIsMaintenanceMode: vi.fn(),
    mockMkdirSync: vi.fn(),
    mockLogger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  };
});

vi.mock('../container-runner.js', () => ({
  runContainerAgent: mockRunContainerAgent,
  writeTasksSnapshot: mockWriteTasksSnapshot,
}));

vi.mock('../db.js', () => ({
  getAllTasks: mockGetAllTasks,
  getDueTasks: mockGetDueTasks,
  getTaskById: mockGetTaskById,
  logTaskRun: mockLogTaskRun,
  updateTaskAfterRun: mockUpdateTaskAfterRun,
}));

vi.mock('../logger.js', () => ({
  logger: mockLogger,
}));

vi.mock('../maintenance.js', () => ({
  isMaintenanceMode: mockIsMaintenanceMode,
}));

vi.mock('../config.js', () => ({
  GROUPS_DIR: '/tmp/test-groups',
  MAIN_GROUP_FOLDER: 'main',
  SCHEDULER: {
    POLL_INTERVAL_MS: 100,
    CONCURRENCY: 3,
    getRecommendedConcurrency: () => 3,
  },
  TIMEZONE: 'UTC',
  DATA_DIR: '/tmp/test-data',
}));

vi.mock('fs', () => ({
  default: {
    mkdirSync: mockMkdirSync,
  },
}));

import type { RegisteredGroup, ScheduledTask } from '../types.js';
import {
  startSchedulerLoop,
  type SchedulerDependencies,
} from '../task-scheduler.js';

describe('task-scheduler', () => {
  let mockDeps: SchedulerDependencies;

  beforeEach(() => {
    vi.useFakeTimers();

    mockDeps = {
      sendMessage: vi.fn(),
      registeredGroups: vi.fn().mockReturnValue({
        group1: {
          name: 'Test Group',
          jid: 'group1@g.us',
          folder: 'test-group',
          trigger: '@test',
          added_at: '2024-01-01T00:00:00Z',
          systemPrompt: 'Test prompt',
          enableWebSearch: true,
        } as RegisteredGroup,
        main: {
          name: 'Main Group',
          jid: 'main@g.us',
          folder: 'main',
          trigger: '@main',
          added_at: '2024-01-01T00:00:00Z',
          systemPrompt: 'Main prompt',
          enableWebSearch: true,
        } as RegisteredGroup,
      }),
      getSessions: vi.fn().mockReturnValue({
        'test-group': 'session-123',
        main: 'session-main',
      }),
    };

    // Default mock implementations
    mockIsMaintenanceMode.mockReturnValue(false);
    mockGetDueTasks.mockReturnValue([]);
    mockGetAllTasks.mockReturnValue([]);
    mockRunContainerAgent.mockResolvedValue({
      status: 'success',
      result: 'Task completed successfully',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('startSchedulerLoop', () => {
    it('should return an object with stop method', () => {
      const scheduler = startSchedulerLoop(mockDeps);

      expect(scheduler).toHaveProperty('stop');
      expect(typeof scheduler.stop).toBe('function');

      scheduler.stop();
    });

    it('should stop polling after stop() is called', async () => {
      const scheduler = startSchedulerLoop(mockDeps);

      await vi.advanceTimersByTimeAsync(50);
      scheduler.stop();

      const callsBefore = mockGetDueTasks.mock.calls.length;
      await vi.advanceTimersByTimeAsync(200);
      const callsAfter = mockGetDueTasks.mock.calls.length;

      expect(callsAfter).toBe(callsBefore);
    });

    it('should skip task processing in maintenance mode', async () => {
      mockIsMaintenanceMode.mockReturnValue(true);

      const scheduler = startSchedulerLoop(mockDeps);

      await vi.advanceTimersByTimeAsync(150);

      expect(mockIsMaintenanceMode).toHaveBeenCalled();
      expect(mockGetDueTasks).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Scheduler skipping: maintenance mode active',
      );

      scheduler.stop();
    });

    it('should continue polling when maintenance mode ends', async () => {
      mockIsMaintenanceMode.mockReturnValue(true);

      const scheduler = startSchedulerLoop(mockDeps);

      await vi.advanceTimersByTimeAsync(150);
      expect(mockGetDueTasks).not.toHaveBeenCalled();

      // Disable maintenance mode
      mockIsMaintenanceMode.mockReturnValue(false);

      await vi.advanceTimersByTimeAsync(150);
      expect(mockGetDueTasks).toHaveBeenCalled();

      scheduler.stop();
    });

    it('should poll for due tasks at regular intervals', async () => {
      const scheduler = startSchedulerLoop(mockDeps);

      await vi.advanceTimersByTimeAsync(50);
      expect(mockGetDueTasks).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(100);
      expect(mockGetDueTasks).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(100);
      expect(mockGetDueTasks).toHaveBeenCalledTimes(3);

      scheduler.stop();
    });

    it('should not process tasks when no tasks are due', async () => {
      mockGetDueTasks.mockReturnValue([]);

      const scheduler = startSchedulerLoop(mockDeps);

      await vi.advanceTimersByTimeAsync(150);

      expect(mockGetDueTasks).toHaveBeenCalled();
      expect(mockRunContainerAgent).not.toHaveBeenCalled();
      expect(mockLogger.info).not.toHaveBeenCalledWith(
        expect.objectContaining({ count: expect.any(Number) }),
        'Found due tasks',
      );

      scheduler.stop();
    });

    it('should execute due tasks when found', async () => {
      const dueTask: ScheduledTask = {
        id: 'task-1',
        group_folder: 'test-group',
        chat_jid: 'group1@g.us',
        prompt: 'Test prompt',
        schedule_type: 'once',
        schedule_value: '2024-01-01T00:00:00Z',
        next_run: '2024-01-01T00:00:00Z',
        status: 'active',
        context_mode: 'isolated',
        created_at: '2024-01-01T00:00:00Z',
        last_run: null,
        last_result: null,
      };

      mockGetDueTasks.mockReturnValue([dueTask]);
      mockGetTaskById.mockReturnValue(dueTask);
      mockGetAllTasks.mockReturnValue([dueTask]);

      const scheduler = startSchedulerLoop(mockDeps);

      await vi.advanceTimersByTimeAsync(150);

      expect(mockLogger.info).toHaveBeenCalledWith(
        { count: 1 },
        'Found due tasks',
      );
      expect(mockMkdirSync).toHaveBeenCalledWith(
        '/tmp/test-groups/test-group',
        { recursive: true },
      );
      expect(mockRunContainerAgent).toHaveBeenCalled();

      scheduler.stop();
    });

    it('should log error when task group is not found', async () => {
      const dueTask: ScheduledTask = {
        id: 'task-1',
        group_folder: 'nonexistent-group',
        chat_jid: 'group1@g.us',
        prompt: 'Test prompt',
        schedule_type: 'once',
        schedule_value: '2024-01-01T00:00:00Z',
        next_run: '2024-01-01T00:00:00Z',
        status: 'active',
        context_mode: 'isolated',
        created_at: '2024-01-01T00:00:00Z',
        last_run: null,
        last_result: null,
      };

      mockGetDueTasks.mockReturnValue([dueTask]);
      mockGetTaskById.mockReturnValue(dueTask);

      const scheduler = startSchedulerLoop(mockDeps);

      await vi.advanceTimersByTimeAsync(150);

      expect(mockLogger.error).toHaveBeenCalledWith(
        { taskId: 'task-1', groupFolder: 'nonexistent-group' },
        'Group not found for task',
      );
      expect(mockLogTaskRun).toHaveBeenCalledWith(
        expect.objectContaining({
          task_id: 'task-1',
          status: 'error',
          error: 'Group not found: nonexistent-group',
        }),
      );
      expect(mockRunContainerAgent).not.toHaveBeenCalled();

      scheduler.stop();
    });

    it('should skip paused tasks', async () => {
      const dueTask: ScheduledTask = {
        id: 'task-1',
        group_folder: 'test-group',
        chat_jid: 'group1@g.us',
        prompt: 'Test prompt',
        schedule_type: 'once',
        schedule_value: '2024-01-01T00:00:00Z',
        next_run: '2024-01-01T00:00:00Z',
        status: 'active',
        context_mode: 'isolated',
        created_at: '2024-01-01T00:00:00Z',
        last_run: null,
        last_result: null,
      };

      const pausedTask: ScheduledTask = { ...dueTask, status: 'paused' };

      mockGetDueTasks.mockReturnValue([dueTask]);
      mockGetTaskById.mockReturnValue(pausedTask); // Task was paused between getDueTasks and execution

      const scheduler = startSchedulerLoop(mockDeps);

      await vi.advanceTimersByTimeAsync(150);

      expect(mockGetTaskById).toHaveBeenCalledWith('task-1');
      expect(mockRunContainerAgent).not.toHaveBeenCalled();

      scheduler.stop();
    });

    it('should skip cancelled tasks', async () => {
      const dueTask: ScheduledTask = {
        id: 'task-1',
        group_folder: 'test-group',
        chat_jid: 'group1@g.us',
        prompt: 'Test prompt',
        schedule_type: 'once',
        schedule_value: '2024-01-01T00:00:00Z',
        next_run: '2024-01-01T00:00:00Z',
        status: 'active',
        context_mode: 'isolated',
        created_at: '2024-01-01T00:00:00Z',
        last_run: null,
        last_result: null,
      };

      const cancelledTask: ScheduledTask = { ...dueTask, status: 'paused' };

      mockGetDueTasks.mockReturnValue([dueTask]);
      mockGetTaskById.mockReturnValue(cancelledTask);

      const scheduler = startSchedulerLoop(mockDeps);

      await vi.advanceTimersByTimeAsync(150);

      expect(mockRunContainerAgent).not.toHaveBeenCalled();

      scheduler.stop();
    });

    it('should continue processing other tasks when one task fails', async () => {
      const task1: ScheduledTask = {
        id: 'task-1',
        group_folder: 'test-group',
        chat_jid: 'group1@g.us',
        prompt: 'Task 1',
        schedule_type: 'once',
        schedule_value: '2024-01-01T00:00:00Z',
        next_run: '2024-01-01T00:00:00Z',
        status: 'active',
        context_mode: 'isolated',
        created_at: '2024-01-01T00:00:00Z',
        last_run: null,
        last_result: null,
      };

      const task2: ScheduledTask = { ...task1, id: 'task-2', prompt: 'Task 2' };

      mockGetDueTasks.mockReturnValue([task1, task2]);
      mockGetTaskById.mockImplementation((id) =>
        id === 'task-1' ? task1 : task2,
      );
      mockGetAllTasks.mockReturnValue([task1, task2]);

      mockRunContainerAgent
        .mockRejectedValueOnce(new Error('Task 1 failed'))
        .mockResolvedValueOnce({ status: 'success', result: 'Task 2 success' });

      const scheduler = startSchedulerLoop(mockDeps);

      await vi.advanceTimersByTimeAsync(50);

      // Each task should be called exactly once; verify error isolation
      expect(mockRunContainerAgent).toHaveBeenCalledTimes(2);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-1',
          error: 'Task 1 failed',
        }),
        'Task failed',
      );

      scheduler.stop();
    });

    it('should update cron tasks with next_run after execution', async () => {
      const cronTask: ScheduledTask = {
        id: 'task-1',
        group_folder: 'test-group',
        chat_jid: 'group1@g.us',
        prompt: 'Cron task',
        schedule_type: 'cron',
        schedule_value: '0 0 * * *', // Daily at midnight
        next_run: '2024-01-01T00:00:00Z',
        status: 'active',
        context_mode: 'isolated',
        created_at: '2024-01-01T00:00:00Z',
        last_run: null,
        last_result: null,
      };

      mockGetDueTasks.mockReturnValue([cronTask]);
      mockGetTaskById.mockReturnValue(cronTask);
      mockGetAllTasks.mockReturnValue([cronTask]);

      const scheduler = startSchedulerLoop(mockDeps);

      await vi.advanceTimersByTimeAsync(150);

      expect(mockUpdateTaskAfterRun).toHaveBeenCalledWith(
        'task-1',
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        expect.any(String),
      );

      const nextRun = mockUpdateTaskAfterRun.mock.calls[0][1];
      expect(nextRun).not.toBeNull();

      scheduler.stop();
    });

    it('should update interval tasks with next_run after execution', async () => {
      const intervalTask: ScheduledTask = {
        id: 'task-1',
        group_folder: 'test-group',
        chat_jid: 'group1@g.us',
        prompt: 'Interval task',
        schedule_type: 'interval',
        schedule_value: '3600000', // 1 hour in ms
        next_run: '2024-01-01T00:00:00Z',
        status: 'active',
        context_mode: 'isolated',
        created_at: '2024-01-01T00:00:00Z',
        last_run: null,
        last_result: null,
      };

      mockGetDueTasks.mockReturnValue([intervalTask]);
      mockGetTaskById.mockReturnValue(intervalTask);
      mockGetAllTasks.mockReturnValue([intervalTask]);

      const scheduler = startSchedulerLoop(mockDeps);

      await vi.advanceTimersByTimeAsync(150);

      expect(mockUpdateTaskAfterRun).toHaveBeenCalledWith(
        'task-1',
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        expect.any(String),
      );

      const nextRun = mockUpdateTaskAfterRun.mock.calls[0][1];
      expect(nextRun).not.toBeNull();

      scheduler.stop();
    });

    it('should set next_run to null for once tasks after execution', async () => {
      const onceTask: ScheduledTask = {
        id: 'task-1',
        group_folder: 'test-group',
        chat_jid: 'group1@g.us',
        prompt: 'Once task',
        schedule_type: 'once',
        schedule_value: '2024-01-01T00:00:00Z',
        next_run: '2024-01-01T00:00:00Z',
        status: 'active',
        context_mode: 'isolated',
        created_at: '2024-01-01T00:00:00Z',
        last_run: null,
        last_result: null,
      };

      mockGetDueTasks.mockReturnValue([onceTask]);
      mockGetTaskById.mockReturnValue(onceTask);
      mockGetAllTasks.mockReturnValue([onceTask]);

      const scheduler = startSchedulerLoop(mockDeps);

      await vi.advanceTimersByTimeAsync(150);

      expect(mockUpdateTaskAfterRun).toHaveBeenCalledWith(
        'task-1',
        null,
        expect.any(String),
      );

      scheduler.stop();
    });

    it('should log task run as error when container agent returns error', async () => {
      const task: ScheduledTask = {
        id: 'task-1',
        group_folder: 'test-group',
        chat_jid: 'group1@g.us',
        prompt: 'Test task',
        schedule_type: 'once',
        schedule_value: '2024-01-01T00:00:00Z',
        next_run: '2024-01-01T00:00:00Z',
        status: 'active',
        context_mode: 'isolated',
        created_at: '2024-01-01T00:00:00Z',
        last_run: null,
        last_result: null,
      };

      mockGetDueTasks.mockReturnValue([task]);
      mockGetTaskById.mockReturnValue(task);
      mockGetAllTasks.mockReturnValue([task]);
      mockRunContainerAgent.mockResolvedValue({
        status: 'error',
        error: 'Container execution failed',
      });

      const scheduler = startSchedulerLoop(mockDeps);

      await vi.advanceTimersByTimeAsync(150);

      expect(mockLogTaskRun).toHaveBeenCalledWith(
        expect.objectContaining({
          task_id: 'task-1',
          status: 'error',
          error: 'Container execution failed',
        }),
      );

      scheduler.stop();
    });

    it('should use group session for group context mode tasks', async () => {
      const groupContextTask: ScheduledTask = {
        id: 'task-1',
        group_folder: 'test-group',
        chat_jid: 'group1@g.us',
        prompt: 'Group context task',
        schedule_type: 'once',
        schedule_value: '2024-01-01T00:00:00Z',
        next_run: '2024-01-01T00:00:00Z',
        status: 'active',
        context_mode: 'group',
        created_at: '2024-01-01T00:00:00Z',
        last_run: null,
        last_result: null,
      };

      mockGetDueTasks.mockReturnValue([groupContextTask]);
      mockGetTaskById.mockReturnValue(groupContextTask);
      mockGetAllTasks.mockReturnValue([groupContextTask]);

      const scheduler = startSchedulerLoop(mockDeps);

      await vi.advanceTimersByTimeAsync(150);

      expect(mockRunContainerAgent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          sessionId: 'session-123',
        }),
      );

      scheduler.stop();
    });

    it('should use undefined session for isolated context mode tasks', async () => {
      const isolatedTask: ScheduledTask = {
        id: 'task-1',
        group_folder: 'test-group',
        chat_jid: 'group1@g.us',
        prompt: 'Isolated task',
        schedule_type: 'once',
        schedule_value: '2024-01-01T00:00:00Z',
        next_run: '2024-01-01T00:00:00Z',
        status: 'active',
        context_mode: 'isolated',
        created_at: '2024-01-01T00:00:00Z',
        last_run: null,
        last_result: null,
      };

      mockGetDueTasks.mockReturnValue([isolatedTask]);
      mockGetTaskById.mockReturnValue(isolatedTask);
      mockGetAllTasks.mockReturnValue([isolatedTask]);

      const scheduler = startSchedulerLoop(mockDeps);

      await vi.advanceTimersByTimeAsync(150);

      expect(mockRunContainerAgent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          sessionId: undefined,
        }),
      );

      scheduler.stop();
    });

    it('should write tasks snapshot before running container agent', async () => {
      const task: ScheduledTask = {
        id: 'task-1',
        group_folder: 'test-group',
        chat_jid: 'group1@g.us',
        prompt: 'Test task',
        schedule_type: 'once',
        schedule_value: '2024-01-01T00:00:00Z',
        next_run: '2024-01-01T00:00:00Z',
        status: 'active',
        context_mode: 'isolated',
        created_at: '2024-01-01T00:00:00Z',
        last_run: null,
        last_result: null,
      };

      mockGetDueTasks.mockReturnValue([task]);
      mockGetTaskById.mockReturnValue(task);
      mockGetAllTasks.mockReturnValue([task]);

      const scheduler = startSchedulerLoop(mockDeps);

      await vi.advanceTimersByTimeAsync(150);

      expect(mockWriteTasksSnapshot).toHaveBeenCalledWith(
        'test-group',
        false,
        expect.arrayContaining([
          expect.objectContaining({
            id: 'task-1',
            groupFolder: 'test-group',
            prompt: 'Test task',
          }),
        ]),
      );

      // Verify snapshot was written before container agent runs
      const snapshotCallOrder =
        mockWriteTasksSnapshot.mock.invocationCallOrder[0];
      const containerCallOrder =
        mockRunContainerAgent.mock.invocationCallOrder[0];
      expect(snapshotCallOrder).toBeLessThan(containerCallOrder);

      scheduler.stop();
    });

    it('should identify main group correctly for snapshot', async () => {
      const mainTask: ScheduledTask = {
        id: 'task-1',
        group_folder: 'main',
        chat_jid: 'main@g.us',
        prompt: 'Main task',
        schedule_type: 'once',
        schedule_value: '2024-01-01T00:00:00Z',
        next_run: '2024-01-01T00:00:00Z',
        status: 'active',
        context_mode: 'isolated',
        created_at: '2024-01-01T00:00:00Z',
        last_run: null,
        last_result: null,
      };

      mockGetDueTasks.mockReturnValue([mainTask]);
      mockGetTaskById.mockReturnValue(mainTask);
      mockGetAllTasks.mockReturnValue([mainTask]);

      const scheduler = startSchedulerLoop(mockDeps);

      await vi.advanceTimersByTimeAsync(150);

      expect(mockWriteTasksSnapshot).toHaveBeenCalledWith(
        'main',
        true, // isMain should be true
        expect.any(Array),
      );

      scheduler.stop();
    });
  });
});
