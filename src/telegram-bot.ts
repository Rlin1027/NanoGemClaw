/**
 * Telegram Bot Connection - Bot initialization, event handlers, and background services.
 */
import TelegramBot from 'node-telegram-bot-api';

import { ASSISTANT_NAME, TELEGRAM_BOT_TOKEN } from './config.js';
import { storeChatMetadata, storeMessage } from './db.js';
import { logger } from './logger.js';
import { getBot, setBot, getRegisteredGroups, getSessions } from './state.js';
import {
  sendMessage,
  sendMessageWithButtons,
  QuickReplyButton,
} from './telegram-helpers.js';
import {
  processMessage,
  startMediaCleanupScheduler,
} from './message-handler.js';
import { saveState } from './group-manager.js';
import { startIpcWatcher } from './ipc-watcher.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { formatError } from './utils.js';

// ============================================================================
// Telegram Connection
// ============================================================================

export async function connectTelegram(): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error(
      '\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557',
    );
    console.error(
      '\u2551  FATAL: TELEGRAM_BOT_TOKEN not set                           \u2551',
    );
    console.error(
      '\u2551  Run: npm run setup:telegram                                 \u2551',
    );
    console.error(
      '\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d',
    );
    process.exit(1);
  }

  const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
  setBot(bot);

  // Import and setup message consolidator
  const { messageConsolidator } = await import('./message-consolidator.js');

  // Handle consolidated messages (multiple messages merged)
  messageConsolidator.on('consolidated', async (result: any) => {
    const chatId = String(result.chatId);
    const registeredGroups = getRegisteredGroups();
    const group = registeredGroups[chatId];
    if (!group) return;

    try {
      // Create a synthetic message with combined text
      const lastMsg = result.messages[result.messages.length - 1];
      const syntheticMsg = {
        chat: { id: parseInt(chatId), type: 'group' as const },
        text: result.combinedText,
        date: Math.floor(Date.now() / 1000),
        message_id: lastMsg.messageId || Date.now(),
        from: { id: 0, is_bot: false, first_name: 'User' },
      } as TelegramBot.Message;

      await processMessage(syntheticMsg);
      saveState();
    } catch (err) {
      logger.error({ err, chatId }, 'Error processing consolidated message');
    }
  });

  // Handle incoming messages
  bot.on('message', async (msg: TelegramBot.Message) => {
    const chatId = msg.chat.id.toString();
    const content = msg.text || msg.caption || '';
    const senderId = msg.from?.id.toString() || '';
    const senderName = msg.from?.first_name || 'Unknown';
    const timestamp = new Date(msg.date * 1000).toISOString();
    const chatName = msg.chat.title || msg.chat.first_name || chatId;

    // Store chat metadata for group discovery
    storeChatMetadata(chatId, timestamp, chatName);

    const registeredGroups = getRegisteredGroups();

    // Store message if registered group
    if (registeredGroups[chatId] && content) {
      // Feature #23: Intelligent Classification Tags
      const tags: string[] = [];
      if (content.includes('?')) tags.push('#question');
      if (content.startsWith('/')) tags.push('#command');
      if (content.match(/bug|error|fail|\u932f\u8aa4|\u5931\u6557/i))
        tags.push('#alert');
      if (content.match(/good|great|thanks|\u8b9a|\u8b1d\u8b1d/i))
        tags.push('#feedback');

      storeMessage(
        msg.message_id.toString(),
        chatId,
        senderId,
        senderName,
        content + (tags.length > 0 ? `\n\nTags: ${tags.join(' ')}` : ''),
        timestamp,
        false,
      );
    }

    // Process if registered (with message consolidation)
    if (registeredGroups[chatId]) {
      try {
        // Import consolidator
        const { messageConsolidator } =
          await import('./message-consolidator.js');
        const group = registeredGroups[chatId];

        // Check if this is a media message
        const isMedia = !!(
          msg.photo ||
          msg.voice ||
          msg.audio ||
          msg.video ||
          msg.document
        );

        // Get debounce setting (default 500ms, per-group config via consolidateMs)
        const debounceMs = (group as any)?.consolidateMs ?? 500;

        // Try to buffer the message
        const buffered = messageConsolidator.addMessage(chatId, content, {
          messageId: msg.message_id,
          isMedia,
          debounceMs,
        });

        // If buffered, wait for consolidation event; otherwise process immediately
        if (buffered) {
          return; // Message is buffered, will be processed via 'consolidated' event
        }

        await processMessage(msg);
        saveState();
      } catch (err) {
        logger.error({ err, chatId }, 'Error processing message');
      }
    }
  });

  // Handle polling errors
  bot.on('polling_error', (err: Error) => {
    logger.error({ err: err.message }, 'Telegram polling error');
  });

  // Handle inline keyboard button clicks
  bot.on('callback_query', async (query: TelegramBot.CallbackQuery) => {
    const chatId = query.message?.chat.id.toString();
    const data = query.data;

    if (!chatId || !data) {
      await bot.answerCallbackQuery(query.id);
      return;
    }

    logger.info({ chatId, action: data }, 'Callback query received');

    try {
      // Acknowledge the button click
      await bot.answerCallbackQuery(query.id);

      // Try to parse as JSON payload first (new format from suggest_actions)
      let callbackPayload: { type: string; data: string } | null = null;
      try {
        callbackPayload = JSON.parse(data);
      } catch {
        // Fall through to legacy format handling
      }

      const { tf } = await import('./i18n/index.js');
      const registeredGroups = getRegisteredGroups();

      // Handle new action types from suggest_actions
      if (
        callbackPayload &&
        ['reply', 'command', 'toggle'].includes(callbackPayload.type)
      ) {
        switch (callbackPayload.type) {
          case 'reply': {
            // Send the data as a new message (process as user message)
            const fakeMsg: TelegramBot.Message = {
              message_id: Date.now(),
              chat: { id: parseInt(chatId), type: 'group' },
              date: Math.floor(Date.now() / 1000),
              text: callbackPayload.data,
              from: {
                id: query.from.id,
                is_bot: false,
                first_name: query.from.first_name,
              },
            };
            await processMessage(fakeMsg);
            break;
          }
          case 'command': {
            // Execute the data as a bot command
            const fakeMsg: TelegramBot.Message = {
              message_id: Date.now(),
              chat: { id: parseInt(chatId), type: 'group' },
              date: Math.floor(Date.now() / 1000),
              text: callbackPayload.data,
              from: {
                id: query.from.id,
                is_bot: false,
                first_name: query.from.first_name,
              },
            };
            await processMessage(fakeMsg);
            break;
          }
          case 'toggle': {
            // Toggle a group setting (parse data as "setting:value")
            const [setting, value] = callbackPayload.data.split(':');
            const group = registeredGroups[chatId];
            if (group && setting) {
              logger.info(
                { chatId, setting, value },
                'Toggle action triggered',
              );
              await sendMessage(
                chatId,
                tf('settingToggled', { setting, value }),
              );
            }
            break;
          }
        }
        return;
      }

      // Handle onboarding callbacks
      if (data.startsWith('onboard_')) {
        const { handleOnboardingCallback } = await import('./onboarding.js');
        const group = registeredGroups[chatId];
        const groupFolder = group?.folder || 'main';
        const handled = await handleOnboardingCallback(
          chatId,
          groupFolder,
          data,
        );
        if (handled) return;
      }

      // Legacy format: route callback actions
      const [action, ...params] = data.split(':');

      switch (action) {
        case 'confirm':
          await sendMessage(chatId, tf('confirmed'));
          break;
        case 'cancel':
          await sendMessage(chatId, tf('cancelled'));
          break;
        case 'retry': {
          const originalMsgId = params[0];

          // Validate originalMsgId is numeric
          if (!/^\d+$/.test(originalMsgId)) {
            await bot.answerCallbackQuery(query.id, {
              text: 'Invalid message ID',
            });
            return;
          }

          // Rate limit check
          const { getMessageById, checkRateLimit } = await import('./db.js');
          const rateCheck = checkRateLimit(`retry:${chatId}`, 5, 60000);
          if (!rateCheck.allowed) {
            await bot.answerCallbackQuery(query.id, {
              text: 'Rate limited. Please wait.',
            });
            return;
          }

          const originalMsg = getMessageById(chatId, originalMsgId);

          if (originalMsg) {
            // Re-trigger the processing logic
            await sendMessage(chatId, tf('retrying'));

            // Construct a skeletal Telegram message for processMessage
            const fakeMsg: TelegramBot.Message = {
              message_id: parseInt(originalMsgId),
              chat: { id: parseInt(chatId), type: 'group' },
              date: Math.floor(
                new Date(originalMsg.timestamp).getTime() / 1000,
              ),
              text: originalMsg.content,
              from: {
                id: parseInt(originalMsg.sender),
                is_bot: false,
                first_name: originalMsg.sender_name,
              },
            };

            await processMessage(fakeMsg);
          } else {
            await sendMessage(chatId, tf('retryFailed'));
          }
          break;
        }
        case 'feedback_menu': {
          const buttons: QuickReplyButton[][] = [
            [
              {
                text: '\ud83d\udc4d',
                callbackData: `feedback:up:${params[0]}`,
              },
              {
                text: '\ud83d\udc4e',
                callbackData: `feedback:down:${params[0]}`,
              },
            ],
          ];
          await sendMessageWithButtons(chatId, tf('feedbackPrompt'), buttons);
          break;
        }
        case 'feedback': {
          const rating = params[0];
          logger.info({ chatId, rating }, 'User feedback received');
          await sendMessage(
            chatId,
            rating === 'up' ? tf('thanksFeedback') : tf('willImprove'),
          );
          break;
        }
        default: {
          // Pass through to agent if unknown action
          const group = registeredGroups[chatId];
          if (group) {
            await sendMessage(chatId, tf('unknownAction', { action: data }));
          }
        }
      }
    } catch (err) {
      logger.error({ chatId, err: formatError(err) }, 'Callback query error');
    }
  });

  // Get bot info
  const me = await bot.getMe();
  logger.info({ username: me.username, id: me.id }, 'Telegram bot connected');

  // Set bot commands for the "Menu" button
  await bot.setMyCommands([
    { command: 'start', description: 'Start the bot and see instructions' },
    { command: 'tasks', description: 'List and manage active tasks' },
    { command: 'persona', description: 'Change the assistant personality' },
    { command: 'report', description: 'Get a summary of recent activity' },
    { command: 'help', description: 'Show available commands' },
  ]);

  // Start background services
  startSchedulerLoop({
    sendMessage,
    registeredGroups: () => getRegisteredGroups(),
    getSessions: () => getSessions(),
  });
  startIpcWatcher();
  startMediaCleanupScheduler();
  const { startTaskCleanupScheduler } = await import('./task-tracker.js');
  startTaskCleanupScheduler();

  console.log(`\n\u2713 NanoGemClaw running (trigger: @${ASSISTANT_NAME})`);
  console.log(`  Bot: @${me.username}`);
  console.log(
    `  Registered groups: ${Object.keys(getRegisteredGroups()).length}\n`,
  );
}
