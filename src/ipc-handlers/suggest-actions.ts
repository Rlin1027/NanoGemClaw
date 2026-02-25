import { IpcHandler, IpcContext, SuggestActionsPayload } from '../types.js';
import { logger } from '../logger.js';

export const SuggestActionsHandler: IpcHandler = {
  type: 'suggest_actions',
  requiredPermission: 'own_group',

  async handle(data: Record<string, any>, context: IpcContext): Promise<void> {
    const payload = data as unknown as SuggestActionsPayload;

    if (!payload.actions || !Array.isArray(payload.actions)) {
      logger.warn(
        { data },
        'suggest_actions: missing or invalid actions array',
      );
      return;
    }

    // Determine target chat
    let targetChatId: string | undefined;

    if (payload.chatId) {
      targetChatId = payload.chatId;
    } else {
      // Find chat for source group
      targetChatId = Object.entries(context.registeredGroups).find(
        ([, group]) => group.folder === context.sourceGroup,
      )?.[0];
    }

    if (!targetChatId) {
      logger.warn(
        { sourceGroup: context.sourceGroup },
        'Cannot suggest actions: target chat not found',
      );
      return;
    }

    // Permission check: non-main groups can only target their own chat
    if (!context.isMain) {
      const ownChatId = Object.entries(context.registeredGroups).find(
        ([, group]) => group.folder === context.sourceGroup,
      )?.[0];

      if (targetChatId !== ownChatId) {
        logger.warn(
          { sourceGroup: context.sourceGroup, targetChatId },
          'Unauthorized suggest_actions attempt blocked',
        );
        return;
      }
    }

    // Build inline keyboard
    const columns = 2; // Default layout
    const keyboard: Array<Array<{ text: string; callback_data: string }>> = [];

    for (let i = 0; i < payload.actions.length; i += columns) {
      const row = payload.actions.slice(i, i + columns).map((action) => ({
        text: action.label,
        callback_data: JSON.stringify({ type: action.type, data: action.data }),
      }));
      keyboard.push(row);
    }

    // Send message with inline keyboard
    if (!context.bot) {
      logger.warn('Bot instance not available in context');
      return;
    }

    try {
      const messageText = payload.message || '選擇一個動作:';
      await context.bot.sendMessage(targetChatId, messageText, {
        reply_markup: {
          inline_keyboard: keyboard,
        },
      });

      logger.info(
        {
          sourceGroup: context.sourceGroup,
          targetChatId,
          actionsCount: payload.actions.length,
        },
        'Actions suggested via IPC',
      );
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'Failed to send inline keyboard',
      );
    }
  },
};
