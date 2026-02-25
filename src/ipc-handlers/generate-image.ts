import { IpcHandler, IpcContext } from '../types.js';
import { logger } from '../logger.js';
import { GROUPS_DIR } from '../config.js';
import path from 'path';

export const GenerateImageHandler: IpcHandler = {
  type: 'generate_image',
  requiredPermission: 'own_group',

  async handle(data: Record<string, any>, context: IpcContext): Promise<void> {
    if (!data.prompt || !data.chatJid) {
      logger.warn({ data }, 'generate_image: missing prompt or chatJid');
      return;
    }

    const targetGroup = Object.entries(context.registeredGroups).find(
      ([jid]) => jid === data.chatJid,
    )?.[1];

    if (!targetGroup) {
      logger.warn(
        { chatJid: data.chatJid },
        'Cannot generate image: group not found',
      );
      return;
    }

    const { generateImage } = await import('../image-gen.js');
    const outputDir = path.join(GROUPS_DIR, targetGroup.folder, 'media');
    const result = await generateImage(data.prompt, outputDir);

    if (result.success && result.imagePath) {
      if (!context.bot) {
        logger.error('Bot instance not provided in context for image sending');
        return;
      }

      // Send the generated image to Telegram
      await context.bot.sendPhoto(data.chatJid, result.imagePath, {
        caption: `🎨 Generated: ${data.prompt.slice(0, 100)}`,
      });
      logger.info(
        { chatJid: data.chatJid, prompt: data.prompt.slice(0, 50) },
        'Image generated and sent',
      );
    } else {
      logger.error(
        { err: result.error, prompt: data.prompt?.substring(0, 100) },
        'Image generation failed',
      );
      await context.sendMessage(data.chatJid, '❌ 圖片生成失敗，請稍後再試。');
    }
  },
};
