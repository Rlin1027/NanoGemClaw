import { IpcHandler, IpcContext } from '../types.js';
import { logger } from '../logger.js';

const handlers = new Map<string, IpcHandler>();

export function registerIpcHandler(handler: IpcHandler): void {
  if (handlers.has(handler.type)) {
    logger.warn(
      { type: handler.type },
      'IPC handler already registered, overwriting',
    );
  }
  handlers.set(handler.type, handler);
  logger.debug({ type: handler.type }, 'IPC handler registered');
}

export function getIpcHandler(type: string): IpcHandler | undefined {
  return handlers.get(type);
}

export function getAllIpcHandlers(): IpcHandler[] {
  return Array.from(handlers.values());
}

/**
 * Dispatch an IPC message to its registered handler.
 * Handles permission checking before delegating to the handler.
 */
export async function dispatchIpc(
  data: Record<string, any>,
  context: IpcContext,
): Promise<void> {
  const handler = handlers.get(data.type);
  if (!handler) {
    logger.warn({ type: data.type }, 'Unknown IPC task type');
    return;
  }

  // Permission check
  if (handler.requiredPermission === 'main' && !context.isMain) {
    logger.warn(
      { type: data.type, sourceGroup: context.sourceGroup },
      'Unauthorized IPC attempt blocked (requires main)',
    );
    return;
  }

  if (handler.requiredPermission === 'own_group' && !context.isMain) {
    const targetGroup = data.groupFolder || data.group;
    if (targetGroup && targetGroup !== context.sourceGroup) {
      logger.warn(
        { type: data.type, sourceGroup: context.sourceGroup, targetGroup },
        'Unauthorized IPC: own_group violation',
      );
      return;
    }
  }

  try {
    await handler.handle(data, context);
  } catch (err) {
    logger.error(
      {
        type: data.type,
        err: err instanceof Error ? err.message : String(err),
      },
      'IPC handler error',
    );
  }
}

/**
 * Load and register all built-in handlers
 */
export async function loadBuiltinHandlers(): Promise<void> {
  const { ScheduleTaskHandler } = await import('./schedule-task.js');
  const { PauseTaskHandler } = await import('./pause-task.js');
  const { ResumeTaskHandler } = await import('./resume-task.js');
  const { CancelTaskHandler } = await import('./cancel-task.js');
  const { RegisterGroupHandler } = await import('./register-group.js');
  const { GenerateImageHandler } = await import('./generate-image.js');
  const { SetPreferenceHandler } = await import('./set-preference.js');
  const { SuggestActionsHandler } = await import('./suggest-actions.js');

  registerIpcHandler(ScheduleTaskHandler);
  registerIpcHandler(PauseTaskHandler);
  registerIpcHandler(ResumeTaskHandler);
  registerIpcHandler(CancelTaskHandler);
  registerIpcHandler(RegisterGroupHandler);
  registerIpcHandler(GenerateImageHandler);
  registerIpcHandler(SetPreferenceHandler);
  registerIpcHandler(SuggestActionsHandler);

  logger.info({ count: handlers.size }, 'Built-in IPC handlers loaded');
}
