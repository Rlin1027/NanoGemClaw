import { IpcHandler, IpcContext } from '../types.js';
import { logger } from '../logger.js';
import { TIMEZONE } from '../config.js';

export const ScheduleTaskHandler: IpcHandler = {
  type: 'schedule_task',
  requiredPermission: 'own_group',

  async handle(data: Record<string, any>, context: IpcContext): Promise<void> {
    if (
      !data.prompt ||
      !data.schedule_type ||
      !data.schedule_value ||
      !data.groupFolder
    ) {
      logger.warn({ data }, 'schedule_task: missing required fields');
      return;
    }

    const targetGroup = data.groupFolder;
    if (!context.isMain && targetGroup !== context.sourceGroup) {
      logger.warn(
        { sourceGroup: context.sourceGroup, targetGroup },
        'Unauthorized schedule_task attempt blocked',
      );
      return;
    }

    const targetChatId = Object.entries(context.registeredGroups).find(
      ([, group]) => group.folder === targetGroup,
    )?.[0];

    if (!targetChatId) {
      logger.warn(
        { targetGroup },
        'Cannot schedule task: target group not registered',
      );
      return;
    }

    const scheduleType = data.schedule_type as 'cron' | 'interval' | 'once';

    // Calculate next_run based on schedule type
    let nextRun: string | null = null;
    if (scheduleType === 'cron') {
      try {
        const { CronExpressionParser } = await import('cron-parser');
        const interval = CronExpressionParser.parse(data.schedule_value, {
          tz: TIMEZONE,
        });
        nextRun = interval.next().toISOString();
      } catch {
        logger.warn(
          { scheduleValue: data.schedule_value },
          'Invalid cron expression',
        );
        return;
      }
    } else if (scheduleType === 'interval') {
      const ms = parseInt(data.schedule_value, 10);
      if (isNaN(ms) || ms <= 0) {
        logger.warn({ scheduleValue: data.schedule_value }, 'Invalid interval');
        return;
      }
      nextRun = new Date(Date.now() + ms).toISOString();
    } else if (scheduleType === 'once') {
      const scheduled = new Date(data.schedule_value);
      if (isNaN(scheduled.getTime())) {
        logger.warn(
          { scheduleValue: data.schedule_value },
          'Invalid timestamp',
        );
        return;
      }
      nextRun = scheduled.toISOString();
    }

    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const contextMode =
      data.context_mode === 'group' || data.context_mode === 'isolated'
        ? data.context_mode
        : 'isolated';

    const { createTask } = await import('../db.js');
    createTask({
      id: taskId,
      group_folder: targetGroup,
      chat_jid: targetChatId,
      prompt: data.prompt,
      schedule_type: scheduleType,
      schedule_value: data.schedule_value,
      context_mode: contextMode,
      next_run: nextRun,
      status: 'active',
      created_at: new Date().toISOString(),
    });

    logger.info(
      { taskId, sourceGroup: context.sourceGroup, targetGroup, contextMode },
      'Task created via IPC',
    );
  },
};
