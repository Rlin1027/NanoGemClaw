/**
 * Message Handler - Core message processing orchestrator.
 * Media handling, admin commands, agent execution, and response parsing
 * are delegated to their respective modules.
 */
import TelegramBot from 'node-telegram-bot-api';
import path from 'path';

import { ASSISTANT_NAME, TRIGGER_PATTERN } from './config.js';
import { getMessagesSince, storeMessage } from './db.js';
import { logger } from './logger.js';
import { isMaintenanceMode } from './maintenance.js';
import {
  getBot,
  getRegisteredGroups,
  getLastAgentTimestamp,
  getIpcMessageSentChats,
} from './state.js';
import {
  sendMessage,
  sendMessageWithButtons,
  storeSuggestion,
  setTyping,
  QuickReplyButton,
} from './telegram-helpers.js';
import { formatError } from './utils.js';
import { extractMediaInfo, downloadMedia } from './media-handler.js';
import { handleAdminCommand } from './admin-commands.js';
import { runAgent } from './agent-executor.js';
import { extractFacts } from './fact-extractor.js';
import { extractFollowUps } from './response-parser.js';

export { startMediaCleanupScheduler } from './media-handler.js';

// ============================================================================
// Message Processing
// ============================================================================

/**
 * Process an incoming message.
 * Concurrency is handled at the container level (container-runner.ts).
 */
export async function processMessage(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id.toString();
  const registeredGroups = getRegisteredGroups();
  const group = registeredGroups[chatId];
  if (!group) return;

  const bot = getBot();

  const messageThreadId = msg.message_thread_id ?? undefined;
  const threadIdNum = messageThreadId ?? null;
  const threadIdStr = messageThreadId?.toString();

  // Maintenance mode: auto-reply and skip processing
  if (isMaintenanceMode()) {
    const { tf: i18nTf, getGroupLang: i18nGetGroupLang } =
      await import('./i18n/index.js');
    await bot.sendMessage(
      parseInt(chatId),
      i18nTf('maintenanceMode', undefined, i18nGetGroupLang(group.folder)),
      { ...(threadIdNum ? { message_thread_id: threadIdNum } : {}) },
    );
    return;
  }

  // Extract content (text or caption)
  let content = msg.text || msg.caption || '';
  const isMainGroup =
    group.folder === (await import('./config.js')).MAIN_GROUP_FOLDER;

  // Handle admin commands (main group or admin private chat)
  const { isAdminGroup } = await import('./admin-auth.js');
  const isAdminChat = isAdminGroup(group.folder);
  if ((isMainGroup || isAdminChat) && content.startsWith('/admin')) {
    const parts = content.slice(7).trim().split(/\s+/);
    const adminCmd = parts[0] || 'help';
    const adminArgs = parts.slice(1);

    try {
      const response = await handleAdminCommand(adminCmd, adminArgs);
      await sendMessage(chatId, response, threadIdNum);
    } catch (err) {
      logger.error({ err: formatError(err) }, 'Admin command failed');
      await sendMessage(
        chatId,
        '❌ Admin command failed. Check logs for details.',
        threadIdNum,
      );
    }
    return;
  }

  // Check if trigger prefix is required (main group always responds; others check requireTrigger setting)
  // Slash commands directed at this bot (e.g. /start@BotName) bypass trigger check
  const botCommandPattern = new RegExp(`^/\\w+@${ASSISTANT_NAME}\\b`, 'i');
  const isBotCommand = botCommandPattern.test(content);
  if (isBotCommand) {
    // Strip @BotName suffix so commands work uniformly (e.g. /start@Bot → /start)
    content = content
      .replace(new RegExp(`@${ASSISTANT_NAME}\\b`, 'i'), '')
      .trim();
  }
  // Media messages (photo, voice, video, document) bypass trigger check — high-intent interaction
  const isMedia = !!(
    msg.photo ||
    msg.voice ||
    msg.audio ||
    msg.video ||
    msg.document
  );
  const needsTrigger = !isMainGroup && group.requireTrigger !== false;
  if (
    needsTrigger &&
    !isBotCommand &&
    !isMedia &&
    !TRIGGER_PATTERN.test(content)
  )
    return;

  // Onboarding check for new groups (before processing first message)
  const isCommand = content.startsWith('/');
  if (!isCommand && !isAdminChat) {
    const { checkAndStartOnboarding } = await import('./onboarding.js');
    const triggered = await checkAndStartOnboarding(
      chatId,
      group.folder,
      group.name,
      threadIdNum,
    );
    if (triggered) return; // Don't process the first message, show onboarding instead
  }

  // Rate limiting check
  const { checkRateLimit } = await import('./db.js');
  const { RATE_LIMIT } = await import('./config.js');
  const { tf, getGroupLang } = await import('./i18n/index.js');

  if (RATE_LIMIT.ENABLED && !isAdminChat) {
    const rateLimitKey = `group:${chatId}`;
    const windowMs = RATE_LIMIT.WINDOW_MINUTES * 60 * 1000;
    const result = checkRateLimit(
      rateLimitKey,
      RATE_LIMIT.MAX_REQUESTS,
      windowMs,
    );

    if (!result.allowed) {
      const waitMinutes = Math.ceil(result.resetInMs / 60000);
      logger.warn(
        { chatId, remaining: result.remaining, waitMinutes },
        'Rate limited',
      );
      const groupLang = getGroupLang(group.folder);
      await sendMessage(
        chatId,
        `${tf('rateLimited', undefined, groupLang)} ${tf('retryIn', { minutes: waitMinutes }, groupLang)}`,
        threadIdNum,
      );
      return;
    }
  }

  // Extract reply context if this message is a reply to another
  let replyContext = '';
  if (msg.reply_to_message) {
    const replyMsg = msg.reply_to_message;
    const replySender = replyMsg.from?.first_name || 'Unknown';
    const replyContent = replyMsg.text || replyMsg.caption || '[非文字內容]';
    const truncatedReply =
      replyContent.slice(0, 500) + (replyContent.length > 500 ? '...' : '');
    replyContext = `[使用者正在回覆 ${replySender} 的以下訊息，請根據此訊息內容回答]\n---\n${truncatedReply}\n---\n`;
    content = replyContext + content;
    logger.info(
      { chatId, replyToId: replyMsg.message_id },
      'Processing reply context',
    );
  }

  // Handle media with progress updates
  const mediaInfo = extractMediaInfo(msg);
  let mediaPath: string | null = null;
  let statusMsg: TelegramBot.Message | null = null;

  const groupLang = getGroupLang(group.folder);

  // Send status message for processing requests
  statusMsg = await bot.sendMessage(
    chatId,
    `⏳ ${tf('processing', undefined, groupLang)}...`,
    {
      reply_to_message_id: msg.message_id,
      ...(threadIdNum ? { message_thread_id: threadIdNum } : {}),
    },
  );

  if (mediaInfo) {
    await bot.editMessageText(
      `📥 ${tf('downloadingMedia', undefined, groupLang)}...`,
      {
        chat_id: chatId,
        message_id: statusMsg.message_id,
      },
    );

    mediaPath = await downloadMedia(
      mediaInfo.fileId,
      group.folder,
      mediaInfo.fileName,
    );

    if (mediaPath) {
      const containerMediaPath = `/workspace/group/media/${path.basename(mediaPath)}`;

      if (mediaInfo.type === 'voice') {
        // Check voice duration (Telegram provides this in msg.voice.duration)
        if (msg.voice?.duration && msg.voice.duration > 300) {
          await bot.editMessageText(
            `⚠️ ${tf('stt_too_long', undefined, groupLang)}`,
            {
              chat_id: chatId,
              message_id: statusMsg.message_id,
            },
          );
          return;
        }

        await bot.editMessageText(
          `🧠 ${tf('transcribing', undefined, groupLang)}...`,
          {
            chat_id: chatId,
            message_id: statusMsg.message_id,
          },
        );

        const { transcribeAudio } = await import('./stt.js');
        let transcription: string;
        try {
          transcription = await transcribeAudio(mediaPath);
          // Echo transcription back to user
          await sendMessage(
            chatId,
            `🎤 ${tf('stt_transcribed', undefined, groupLang)}: "${transcription}"`,
            threadIdNum,
          );
          logger.info(
            { chatId, transcription: transcription.slice(0, 100) },
            'Voice message transcribed',
          );
        } catch (err) {
          await bot.editMessageText(
            `❌ ${tf('stt_error', undefined, groupLang)}`,
            {
              chat_id: chatId,
              message_id: statusMsg.message_id,
            },
          );
          logger.error({ err, chatId }, 'Voice transcription failed');
          return;
        }
        content = `[Voice message transcription: "${transcription}"]\n${content}`;
        mediaPath = null; // Transcription captured; audio file no longer needed for routing
      } else {
        content = `[Media: ${mediaInfo.type} at ${containerMediaPath}]\n${content}`;
      }
    }
  }

  await bot.editMessageText(`🤖 ${tf('thinking', undefined, groupLang)}...`, {
    chat_id: chatId,
    message_id: statusMsg.message_id,
  });

  // Get all messages since last agent interaction
  const lastAgentTimestamp = getLastAgentTimestamp();
  const sinceTimestamp = lastAgentTimestamp[chatId] || '';
  const missedMessages = getMessagesSince(
    chatId,
    sinceTimestamp,
    ASSISTANT_NAME,
    threadIdStr,
  );

  if (missedMessages.length === 0) return;

  const lines = missedMessages.map((m) => {
    const escapeXml = (s: string) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    return `<message sender="${escapeXml(m.sender_name)}" time="${m.timestamp}">${escapeXml(m.content)}</message>`;
  });
  let prompt = `<messages>\n${lines.join('\n')}\n</messages>`;

  // Inject reply context into prompt so Gemini can see the referenced message
  if (replyContext) {
    prompt = `${replyContext}\n${prompt}`;
  }

  logger.info(
    { group: group.name, messageCount: missedMessages.length },
    'Processing message',
  );

  // Extract structured facts from user message (fire-and-forget)
  // Skip for admin chat — admin messages are operational, not personal facts
  if (!isAdminChat) {
    try {
      extractFacts(content, group.folder);
    } catch {
      // Non-critical: don't fail message processing if extraction errors
    }
  }

  const ipcMessageSentChats = getIpcMessageSentChats();
  await setTyping(chatId, true, threadIdNum);
  ipcMessageSentChats.delete(chatId); // Reset before agent run

  // Build plugin hook context (shared across before/after/onError hooks)
  const senderName = msg.from?.first_name || msg.from?.username || 'Unknown';
  const hookContext = {
    chatJid: chatId,
    sender: msg.from?.id?.toString() || '',
    senderName,
    content,
    groupFolder: group.folder,
    isMain: isMainGroup,
    timestamp: new Date(msg.date * 1000).toISOString(),
  };

  // Run plugin beforeMessage hooks
  try {
    const pluginLoaderPath = '../app/src/plugin-loader.js';
    const { runBeforeMessageHooks } = await import(pluginLoaderPath);
    const beforeResult = await runBeforeMessageHooks(hookContext);
    if (
      beforeResult &&
      typeof beforeResult === 'object' &&
      'skip' in beforeResult
    ) {
      return;
    }
    if (typeof beforeResult === 'string') {
      content = beforeResult;
    }
  } catch {
    /* plugin hooks should not break message processing */
  }

  try {
    const response = await runAgent(
      group,
      prompt,
      chatId,
      mediaPath,
      statusMsg,
      messageThreadId,
    );

    // Skip container output if agent already sent response via IPC
    const ipcAlreadySent = ipcMessageSentChats.has(chatId);
    ipcMessageSentChats.delete(chatId); // Clean up

    if (response && !ipcAlreadySent) {
      const timestamp = new Date(msg.date * 1000).toISOString();
      lastAgentTimestamp[chatId] = timestamp;

      // Clean up status message
      if (statusMsg) {
        await bot
          .deleteMessage(parseInt(chatId), statusMsg.message_id)
          .catch(() => {});
      }

      // Parse follow-up suggestions from response
      const { cleanText, followUps } = extractFollowUps(response);

      // Build buttons: always include retry/feedback, add follow-ups if present
      const buttons: QuickReplyButton[][] = [
        [
          {
            text: `🔄 ${tf('retry', undefined, groupLang)}`,
            callbackData: `retry:${msg.message_id}`,
          },
          {
            text: `💬 ${tf('feedback', undefined, groupLang)}`,
            callbackData: `feedback_menu:${msg.message_id}`,
          },
        ],
      ];

      // Add follow-up suggestions as additional button rows (one per suggestion)
      if (followUps.length > 0) {
        for (const suggestion of followUps) {
          buttons.push([
            {
              text: `💡 ${suggestion}`,
              callbackData: storeSuggestion(suggestion),
            },
          ]);
        }
      }

      await sendMessageWithButtons(
        chatId,
        `${ASSISTANT_NAME}: ${cleanText}`,
        buttons,
        threadIdNum,
      );

      // Store bot response for conversation history
      // Without this, Gemini only sees consecutive user messages and
      // loses context of previous replies (e.g. repeating function calls)
      if (cleanText) {
        storeMessage(
          `bot-${Date.now()}`,
          chatId,
          ASSISTANT_NAME,
          ASSISTANT_NAME,
          cleanText,
          new Date().toISOString(),
          true,
          threadIdStr ?? null,
        );
      }

      // Run plugin afterMessage hooks (fire-and-forget)
      try {
        const pluginLoaderPath = '../app/src/plugin-loader.js';
        import(pluginLoaderPath).then(({ runAfterMessageHooks }) =>
          runAfterMessageHooks({ ...hookContext, reply: cleanText }).catch(
            () => {},
          ),
        );
      } catch {}
    } else if (ipcAlreadySent && statusMsg) {
      // IPC handled the response; just clean up status message
      await bot
        .deleteMessage(parseInt(chatId), statusMsg.message_id)
        .catch(() => {});
    } else if (statusMsg) {
      // Run plugin onMessageError hooks
      try {
        const pluginLoaderPath = '../app/src/plugin-loader.js';
        import(pluginLoaderPath).then(({ runOnMessageErrorHooks }) =>
          runOnMessageErrorHooks({
            ...hookContext,
            error: new Error('No response from agent'),
          }).catch(() => {}),
        );
      } catch {}

      // If no response, update status message to error with retry button
      await bot
        .editMessageText(`❌ ${tf('errorOccurred', undefined, groupLang)}`, {
          chat_id: parseInt(chatId),
          message_id: statusMsg.message_id,
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 Retry', callback_data: `retry:${msg.message_id}` }],
            ],
          },
        })
        .catch(() => {});
    }
  } finally {
    await setTyping(chatId, false, threadIdNum);
  }
}
