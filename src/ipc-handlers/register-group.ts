import { IpcHandler, IpcContext } from '../types.js';
import { logger } from '../logger.js';

const SAFE_FOLDER_RE = /^[a-zA-Z0-9_-]+$/;

export const RegisterGroupHandler: IpcHandler = {
  type: 'register_group',
  requiredPermission: 'main',

  async handle(data: Record<string, any>, context: IpcContext): Promise<void> {
    if (!data.jid || !data.name || !data.folder || !data.trigger) {
      logger.warn(
        { data },
        'Invalid register_group request - missing required fields',
      );
      return;
    }

    if (!SAFE_FOLDER_RE.test(data.folder)) {
      logger.warn(
        { folder: data.folder },
        'Invalid folder name in register_group IPC',
      );
      return;
    }

    if (!context.registerGroup) {
      logger.error('registerGroup callback not provided in context');
      return;
    }

    context.registerGroup(data.jid, {
      name: data.name,
      folder: data.folder,
      trigger: data.trigger,
      added_at: new Date().toISOString(),
      containerConfig: data.containerConfig,
    });
  },
};
