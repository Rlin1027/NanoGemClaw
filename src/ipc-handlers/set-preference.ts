import { IpcHandler, IpcContext } from '../types.js';
import { logger } from '../logger.js';

const ALLOWED_KEYS = [
  'language',
  'nickname',
  'response_style',
  'interests',
  'timezone',
  'custom_instructions',
];

export const SetPreferenceHandler: IpcHandler = {
  type: 'set_preference',
  requiredPermission: 'own_group',

  async handle(data: Record<string, any>, context: IpcContext): Promise<void> {
    if (!data.key || data.value === undefined || !data.groupFolder) {
      logger.warn({ data }, 'set_preference: missing required fields');
      return;
    }

    if (!ALLOWED_KEYS.includes(data.key)) {
      logger.warn(
        { key: data.key, allowedKeys: ALLOWED_KEYS },
        'set_preference: invalid key',
      );
      return;
    }

    const targetGroup = data.groupFolder;
    if (!context.isMain && targetGroup !== context.sourceGroup) {
      logger.warn(
        { sourceGroup: context.sourceGroup, targetGroup },
        'Unauthorized set_preference attempt blocked',
      );
      return;
    }

    const { setPreference } = await import('../db.js');
    setPreference(targetGroup, data.key, String(data.value));

    logger.info(
      {
        groupFolder: targetGroup,
        key: data.key,
        sourceGroup: context.sourceGroup,
      },
      'Preference set via IPC',
    );
  },
};
