import { vi, describe, it, expect, beforeEach } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */
const mocks = vi.hoisted(() => ({
  getTaskById: vi.fn<any>(() => null),
  createTask: vi.fn<any>(),
  runDailyCompaction: vi.fn<any>(async () => ({ updated: 1, errors: 0 })),
  runWeeklySynthesis: vi.fn<any>(async () => ({ updated: 1, errors: 0 })),
  updateShortTermMemory: vi.fn<any>(async () => true),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../config.js', () => ({
  MEMORY_COMPOUNDER: {
    ENABLED: true,
    DAILY_COMPACTION_HOUR: 3,
    WEEKLY_SYNTHESIS_DAY: 0,
    WEEKLY_SYNTHESIS_HOUR: 4,
    MIN_MESSAGES_FOR_SHORT: 5,
  },
  SYSTEM_TASK_PREFIX: '_system_',
  TIMEZONE: 'Asia/Taipei',
}));

vi.mock('../db.js', () => ({
  getTaskById: mocks.getTaskById,
  createTask: mocks.createTask,
}));

vi.mock('../logger.js', () => ({
  logger: mocks.logger,
}));

vi.mock('../memory-compounder.js', () => ({
  runDailyCompaction: mocks.runDailyCompaction,
  runWeeklySynthesis: mocks.runWeeklySynthesis,
  updateShortTermMemory: mocks.updateShortTermMemory,
}));

vi.mock('cron-parser', () => ({
  CronExpressionParser: {
    parse: () => ({
      next: () => ({ toISOString: () => '2026-03-16T03:00:00.000Z' }),
    }),
  },
}));

import {
  registerCompactionTasks,
  isCompactionTask,
  executeCompactionTask,
} from '../compounder-scheduler.js';
import type { RegisteredGroup } from '../types.js';

const mockGroups: Record<string, RegisteredGroup> = {
  '-1003751014620': {
    folder: 'main',
    name: 'Main Group',
    preferredPath: 'fast',
    trigger: '@bot',
    added_at: '2026-01-01T00:00:00.000Z',
  },
  '-1003896412053': {
    folder: 'test-group',
    name: 'Test Group',
    preferredPath: 'fast',
    trigger: '@bot',
    added_at: '2026-01-01T00:00:00.000Z',
  },
};

describe('compounder-scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTaskById.mockReturnValue(null);
  });

  describe('registerCompactionTasks', () => {
    it('should create both tasks when they do not exist', () => {
      registerCompactionTasks();
      expect(mocks.createTask).toHaveBeenCalledTimes(2);

      const dailyCall = mocks.createTask.mock.calls[0][0] as any;
      expect(dailyCall.id).toBe('_sys_daily_compaction');
      expect(dailyCall.group_folder).toBe('_system_compounder');
      expect(dailyCall.schedule_type).toBe('cron');
      expect(dailyCall.schedule_value).toBe('0 3 * * *');

      const weeklyCall = mocks.createTask.mock.calls[1][0] as any;
      expect(weeklyCall.id).toBe('_sys_weekly_synthesis');
      expect(weeklyCall.schedule_value).toBe('0 4 * * 0');
    });

    it('should skip creation when tasks already exist (idempotent)', () => {
      mocks.getTaskById.mockReturnValue({ id: 'existing' });
      registerCompactionTasks();
      expect(mocks.createTask).not.toHaveBeenCalled();
    });

    it('should skip when ENABLED is false', async () => {
      // Re-mock config with ENABLED=false
      const configMod = (await import('../config.js')) as any;
      const origEnabled = configMod.MEMORY_COMPOUNDER.ENABLED;
      configMod.MEMORY_COMPOUNDER.ENABLED = false;

      registerCompactionTasks();
      expect(mocks.createTask).not.toHaveBeenCalled();
      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('disabled'),
      );

      // Restore
      configMod.MEMORY_COMPOUNDER.ENABLED = origEnabled;
    });

    it('should create only missing tasks', () => {
      // Daily exists, weekly does not
      mocks.getTaskById
        .mockReturnValueOnce({ id: '_sys_daily_compaction' }) // daily exists
        .mockReturnValueOnce(null); // weekly missing
      registerCompactionTasks();
      expect(mocks.createTask).toHaveBeenCalledTimes(1);
      expect((mocks.createTask.mock.calls[0][0] as any).id).toBe(
        '_sys_weekly_synthesis',
      );
    });
  });

  describe('isCompactionTask', () => {
    it('should return true for daily compaction task', () => {
      expect(isCompactionTask('_sys_daily_compaction')).toBe(true);
    });

    it('should return true for weekly synthesis task', () => {
      expect(isCompactionTask('_sys_weekly_synthesis')).toBe(true);
    });

    it('should return false for other task IDs', () => {
      expect(isCompactionTask('some-other-task')).toBe(false);
      expect(isCompactionTask('_sys_other')).toBe(false);
      expect(isCompactionTask('')).toBe(false);
    });
  });

  describe('executeCompactionTask', () => {
    const getGroups = () => mockGroups;

    it('should run daily compaction with correct chat JIDs', async () => {
      const result = await executeCompactionTask(
        '_sys_daily_compaction',
        getGroups,
      );

      // Should call updateShortTermMemory for each group with correct chatJid
      expect(mocks.updateShortTermMemory).toHaveBeenCalledTimes(2);
      expect(mocks.updateShortTermMemory).toHaveBeenCalledWith(
        mockGroups['-1003751014620'],
        '-1003751014620',
      );
      expect(mocks.updateShortTermMemory).toHaveBeenCalledWith(
        mockGroups['-1003896412053'],
        '-1003896412053',
      );

      expect(mocks.runDailyCompaction).toHaveBeenCalledOnce();
      expect(result).toContain('Daily compaction');
    });

    it('should run weekly synthesis', async () => {
      const result = await executeCompactionTask(
        '_sys_weekly_synthesis',
        getGroups,
      );
      expect(mocks.runWeeklySynthesis).toHaveBeenCalledOnce();
      expect(result).toContain('Weekly synthesis');
    });

    it('should throw for unknown task ID', async () => {
      await expect(executeCompactionTask('unknown', getGroups)).rejects.toThrow(
        'Unknown system task: unknown',
      );
    });

    it('should continue processing groups when one fails short-term update', async () => {
      mocks.updateShortTermMemory
        .mockRejectedValueOnce(new Error('API error'))
        .mockResolvedValueOnce(true);

      await executeCompactionTask('_sys_daily_compaction', getGroups);

      // Should have attempted both groups
      expect(mocks.updateShortTermMemory).toHaveBeenCalledTimes(2);
      // Should still run daily compaction
      expect(mocks.runDailyCompaction).toHaveBeenCalledOnce();
      // Should log warning for failed group
      expect(mocks.logger.warn).toHaveBeenCalled();
    });

    it('should pass all group values to runDailyCompaction', async () => {
      await executeCompactionTask('_sys_daily_compaction', getGroups);
      const passedGroups = mocks.runDailyCompaction.mock.calls[0][0] as any;
      expect(passedGroups).toHaveLength(2);
      expect(passedGroups.map((g: RegisteredGroup) => g.folder)).toEqual(
        expect.arrayContaining(['main', 'test-group']),
      );
    });
  });
});
