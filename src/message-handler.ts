/**
 * Message Handler - Core message processing, admin commands, media handling, and agent execution.
 */
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import https from 'https';

import {
  ASSISTANT_NAME,
  CLEANUP,
  DATA_DIR,
  FAST_PATH,
  GROUPS_DIR,
  MAIN_GROUP_FOLDER,
  TELEGRAM_BOT_TOKEN,
  TRIGGER_PATTERN,
} from './config.js';
import {
  AvailableGroup,
  runContainerAgent,
  writeGroupsSnapshot,
  writeTasksSnapshot,
  type ProgressInfo,
} from './container-runner.js';
import { getAllTasks, getMessagesSince, storeMessage } from './db.js';
import { logger } from './logger.js';
import { isMaintenanceMode } from './maintenance.js';
import {
  getBot,
  getRegisteredGroups,
  getSessions,
  getLastAgentTimestamp,
  getIpcMessageSentChats,
} from './state.js';
import {
  sendMessage,
  sendMessageWithButtons,
  setTyping,
  QuickReplyButton,
} from './telegram-helpers.js';
import { getAvailableGroups, saveState } from './group-manager.js';
import { RegisteredGroup } from './types.js';
import { formatError, saveJson } from './utils.js';

// ============================================================================
// Media Handling
// ============================================================================

interface MediaInfo {
  type: 'photo' | 'voice' | 'audio' | 'video' | 'document';
  fileId: string;
  fileName?: string;
  mimeType?: string;
  caption?: string;
}

function extractMediaInfo(msg: TelegramBot.Message): MediaInfo | null {
  if (msg.photo && msg.photo.length > 0) {
    // Get highest resolution photo
    const photo = msg.photo[msg.photo.length - 1];
    return {
      type: 'photo',
      fileId: photo.file_id,
      caption: msg.caption,
    };
  }
  if (msg.voice) {
    return {
      type: 'voice',
      fileId: msg.voice.file_id,
      mimeType: msg.voice.mime_type,
    };
  }
  if (msg.audio) {
    return {
      type: 'audio',
      fileId: msg.audio.file_id,
      mimeType: msg.audio.mime_type,
    };
  }
  if (msg.video) {
    return {
      type: 'video',
      fileId: msg.video.file_id,
      mimeType: msg.video.mime_type,
      caption: msg.caption,
    };
  }
  if (msg.document) {
    return {
      type: 'document',
      fileId: msg.document.file_id,
      fileName: msg.document.file_name,
      mimeType: msg.document.mime_type,
      caption: msg.caption,
    };
  }
  return null;
}

async function downloadMedia(
  fileId: string,
  groupFolder: string,
  fileName?: string,
): Promise<string | null> {
  const bot = getBot();
  try {
    const fileInfo = await bot.getFile(fileId);
    if (!fileInfo.file_path) return null;

    const mediaDir = path.join(GROUPS_DIR, groupFolder, 'media');
    fs.mkdirSync(mediaDir, { recursive: true });

    const ext = path.extname(fileInfo.file_path) || '.bin';
    const sanitizedName = path
      .basename(fileName || '')
      .replace(/[^a-zA-Z0-9._-]/g, '_');
    const finalName = sanitizedName || `${Date.now()}${ext}`;
    const localPath = path.join(mediaDir, finalName);
    // Security: verify path is within mediaDir
    if (!path.resolve(localPath).startsWith(path.resolve(mediaDir))) {
      throw new Error('Invalid file path detected');
    }

    // Download file
    const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;

    await new Promise<void>((resolve, reject) => {
      const file = fs.createWriteStream(localPath);
      https
        .get(fileUrl, (response) => {
          // Check for successful HTTP response
          if (response.statusCode !== 200) {
            fs.unlink(localPath, () => {});
            reject(
              new Error(
                `HTTP ${response.statusCode}: Failed to download media`,
              ),
            );
            return;
          }
          response.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
        })
        .on('error', (err) => {
          fs.unlink(localPath, () => {});
          reject(err);
        });
    });

    logger.debug({ localPath }, 'Media downloaded');
    return localPath;
  } catch (err) {
    logger.error({ err, fileId }, 'Failed to download media');
    return null;
  }
}

// ============================================================================
// Media Cleanup
// ============================================================================

function cleanupOldMedia(): void {
  const now = Date.now();
  const maxAge = CLEANUP.MEDIA_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  let deletedCount = 0;

  try {
    // Iterate through all group folders
    const groupFolders = fs.readdirSync(GROUPS_DIR);
    for (const folder of groupFolders) {
      const mediaDir = path.join(GROUPS_DIR, folder, 'media');
      if (!fs.existsSync(mediaDir)) continue;

      const files = fs.readdirSync(mediaDir);
      for (const file of files) {
        const filePath = path.join(mediaDir, file);
        try {
          const stats = fs.statSync(filePath);
          if (now - stats.mtimeMs > maxAge) {
            fs.unlinkSync(filePath);
            deletedCount++;
          }
        } catch {
          // Ignore individual file errors
        }
      }
    }

    if (deletedCount > 0) {
      logger.info({ deletedCount }, 'Old media files cleaned up');
    }
  } catch (err) {
    logger.error({ err: formatError(err) }, 'Error during media cleanup');
  }
}

export function startMediaCleanupScheduler(): void {
  // Run immediately on startup
  cleanupOldMedia();
  // Then run periodically
  setInterval(cleanupOldMedia, CLEANUP.MEDIA_CLEANUP_INTERVAL_MS);
  logger.info(
    { intervalHours: CLEANUP.MEDIA_CLEANUP_INTERVAL_HOURS },
    'Media cleanup scheduler started',
  );
}

// ============================================================================
// Admin Commands (Main Group Only)
// ============================================================================

const ADMIN_COMMANDS = {
  stats: 'Show usage statistics',
  groups: 'List all registered groups',
  tasks: 'List all scheduled tasks',
  help: 'Show available admin commands',
  errors: 'Show groups with recent errors',
  report: 'Generate daily usage report',
  language: 'Switch language (zh-TW/en)',
  persona: 'Set persona for a group (list/set)',
  trigger: 'Toggle @trigger requirement for a group (on/off)',
  export: 'Export conversation history for a group',
} as const;

// Admin command handler types
type AdminCommandHandler = (
  args: string[],
  context: AdminCommandContext,
) => Promise<string>;

interface AdminCommandContext {
  registeredGroups: Record<string, RegisteredGroup>;
  db: {
    getAllTasks: typeof getAllTasks;
    getUsageStats: any;
    getAllErrorStates: any;
    getConversationExport: any;
    formatExportAsMarkdown: any;
  };
  i18n: {
    t: any;
    setLanguage: any;
    availableLanguages: string[];
    getLanguage: any;
  };
  personas: {
    getAllPersonas: any;
  };
}

// Individual command handlers
async function handlePersonaCommand(
  args: string[],
  ctx: AdminCommandContext,
): Promise<string> {
  const subCmd = args[0];

  if (subCmd === 'list') {
    const allPersonas = ctx.personas.getAllPersonas();
    return `🎭 **Available Personas**\n\n${Object.entries(allPersonas)
      .map(
        ([key, p]: [string, any]) =>
          `• \`${key}\`: ${p.name} - ${p.description}`,
      )
      .join('\n')}`;
  }

  if (subCmd === 'set' && args[1] && args[2]) {
    const targetGroup = args[1];
    const key = args[2];

    let targetId: string | undefined;
    for (const [id, g] of Object.entries(ctx.registeredGroups)) {
      if (g.folder === targetGroup || g.name === targetGroup) {
        targetId = id;
        break;
      }
    }

    if (!targetId) {
      return `❌ Group not found: ${targetGroup}`;
    }

    const allPersonas = ctx.personas.getAllPersonas();
    if (!allPersonas[key]) {
      return `❌ Invalid persona key: ${key}. Use \`/admin persona list\``;
    }

    ctx.registeredGroups[targetId].persona = key;
    saveState();
    return `✅ Persona for **${ctx.registeredGroups[targetId].name}** set to **${allPersonas[key].name}**`;
  }

  return 'Usage: `/admin persona list` or `/admin persona set <group_folder> <persona_key>`';
}

async function handleTriggerCommand(
  args: string[],
  ctx: AdminCommandContext,
): Promise<string> {
  const targetGroup = args[0];
  const mode = args[1]?.toLowerCase();

  if (!targetGroup || !mode || !['on', 'off'].includes(mode)) {
    return 'Usage: `/admin trigger <group_folder> on|off`\n\n`on` = require @trigger prefix\n`off` = respond to all messages';
  }

  let targetId: string | undefined;
  for (const [id, g] of Object.entries(ctx.registeredGroups)) {
    if (g.folder === targetGroup || g.name === targetGroup) {
      targetId = id;
      break;
    }
  }

  if (!targetId) {
    return `❌ Group not found: ${targetGroup}`;
  }

  ctx.registeredGroups[targetId].requireTrigger = mode === 'on';
  saveJson(path.join(DATA_DIR, 'registered_groups.json'), ctx.registeredGroups);
  const status = mode === 'on' ? '需要 @trigger 前綴' : '回應所有訊息';
  return `✅ **${ctx.registeredGroups[targetId].name}** trigger mode: **${mode}** (${status})`;
}

async function handleStatsCommand(
  args: string[],
  ctx: AdminCommandContext,
): Promise<string> {
  const groupCount = Object.keys(ctx.registeredGroups).length;
  const uptime = process.uptime();
  const uptimeHours = Math.floor(uptime / 3600);
  const uptimeMinutes = Math.floor((uptime % 3600) / 60);

  const usage = ctx.db.getUsageStats();
  const avgDuration =
    usage.total_requests > 0 ? Math.round(usage.avg_duration_ms / 1000) : 0;

  return `${ctx.i18n.t().statsTitle}

• ${ctx.i18n.t().registeredGroups}: ${groupCount}
• ${ctx.i18n.t().uptime}: ${uptimeHours}h ${uptimeMinutes}m
• ${ctx.i18n.t().memory}: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB

${ctx.i18n.t().usageAnalytics}
• ${ctx.i18n.t().totalRequests}: ${usage.total_requests}
• ${ctx.i18n.t().avgResponseTime}: ${avgDuration}s
• ${ctx.i18n.t().totalTokens}: ${usage.total_prompt_tokens + usage.total_response_tokens}`;
}

async function handleGroupsCommand(
  args: string[],
  ctx: AdminCommandContext,
): Promise<string> {
  const groups = Object.values(ctx.registeredGroups);
  if (groups.length === 0) {
    return '📁 No groups registered.';
  }

  const groupList = groups
    .map((g, i) => {
      const isMain = g.folder === MAIN_GROUP_FOLDER;
      const searchStatus = g.enableWebSearch !== false ? '🔍' : '';
      const hasPrompt = g.systemPrompt ? '💬' : '';
      const triggerStatus = isMain || g.requireTrigger === false ? '📢' : '';
      return `${i + 1}. **${g.name}** ${isMain ? '(main)' : ''} ${searchStatus}${hasPrompt}${triggerStatus}
   📁 ${g.folder} | 🎯 ${g.trigger}`;
    })
    .join('\n');

  return `📁 **${ctx.i18n.t().registeredGroups}** (${groups.length})

${groupList}

Legend: 🔍=Search 💬=Custom Prompt 📢=All Messages`;
}

async function handleTasksCommand(
  args: string[],
  ctx: AdminCommandContext,
): Promise<string> {
  const tasks = ctx.db.getAllTasks();
  if (tasks.length === 0) {
    return '📅 No scheduled tasks.';
  }

  const taskList = tasks
    .slice(0, 10)
    .map((t: any, i: number) => {
      const status =
        t.status === 'active' ? '✅' : t.status === 'paused' ? '⏸️' : '✓';
      const nextRun = t.next_run
        ? new Date(t.next_run).toLocaleString()
        : 'N/A';
      return `${i + 1}. ${status} **${t.group_folder}**
   📋 ${t.prompt.slice(0, 50)}${t.prompt.length > 50 ? '...' : ''}
   ⏰ ${t.schedule_type}: ${t.schedule_value} | Next: ${nextRun}`;
    })
    .join('\n');

  const moreText =
    tasks.length > 10 ? `\n\n_...and ${tasks.length - 10} more tasks_` : '';

  return `📅 **Scheduled Tasks** (${tasks.length})

${taskList}${moreText}`;
}

async function handleErrorsCommand(
  args: string[],
  ctx: AdminCommandContext,
): Promise<string> {
  const errorStates = ctx.db.getAllErrorStates();

  if (errorStates.length === 0) {
    return ctx.i18n.t().noErrors;
  }

  const errorList = errorStates
    .filter((e: any) => e.state.consecutiveFailures > 0)
    .map((e: any) => {
      const group =
        ctx.registeredGroups[
          Object.keys(ctx.registeredGroups).find(
            (k) => ctx.registeredGroups[k].folder === e.group,
          ) || ''
        ];
      return `• **${group?.name || e.group}**: ${e.state.consecutiveFailures} failures\n  Last: ${e.state.lastError?.slice(0, 80)}...`;
    })
    .join('\n');

  return errorList
    ? `${ctx.i18n.t().groupsWithErrors}\n\n${errorList}`
    : ctx.i18n.t().noActiveErrors;
}

async function handleReportCommand(
  args: string[],
  ctx: AdminCommandContext,
): Promise<string> {
  const { getDailyReportMessage } = await import('./daily-report.js');
  return getDailyReportMessage();
}

async function handleExportCommand(
  args: string[],
  ctx: AdminCommandContext,
): Promise<string> {
  const targetFolder = args[0];
  if (!targetFolder) {
    return 'Usage: `/admin export <group_folder>`\nExports conversation as a file.';
  }

  let targetChatId: string | undefined;
  for (const [id, g] of Object.entries(ctx.registeredGroups)) {
    if (g.folder === targetFolder || g.name === targetFolder) {
      targetChatId = id;
      break;
    }
  }

  if (!targetChatId) {
    return `❌ Group not found: ${targetFolder}`;
  }

  const exportData = ctx.db.getConversationExport(targetChatId);

  if (exportData.messageCount === 0) {
    return `📭 No messages found for **${targetFolder}**.`;
  }

  const md = ctx.db.formatExportAsMarkdown(exportData);

  const tmpPath = path.join(
    DATA_DIR,
    `export-${targetFolder}-${Date.now()}.md`,
  );
  fs.writeFileSync(tmpPath, md, 'utf-8');

  try {
    const mainChatId = Object.entries(ctx.registeredGroups).find(
      ([, g]) => g.folder === MAIN_GROUP_FOLDER,
    )?.[0];

    const bot = getBot();
    if (mainChatId && bot) {
      await bot.sendDocument(parseInt(mainChatId), tmpPath, {
        caption: `📤 Export: ${targetFolder} (${exportData.messageCount} messages)`,
      });
    }
  } catch (err) {
    logger.error({ err: formatError(err) }, 'Failed to send export file');
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch {}
  }

  return `✅ Exported **${exportData.messageCount}** messages for **${targetFolder}**.`;
}

async function handleLanguageCommand(
  args: string[],
  ctx: AdminCommandContext,
): Promise<string> {
  type Language = import('./i18n.js').Language;
  const lang = args[0] as Language;
  if (ctx.i18n.availableLanguages.includes(lang)) {
    ctx.i18n.setLanguage(lang);
    saveState();
    return `✅ Language switched to: **${lang}**`;
  }
  return `❌ Invalid language. Available: ${ctx.i18n.availableLanguages.join(', ')}\nCurrent: ${ctx.i18n.getLanguage()}`;
}

async function handleHelpCommand(
  args: string[],
  ctx: AdminCommandContext,
): Promise<string> {
  const commandList = Object.entries(ADMIN_COMMANDS)
    .map(([cmd, desc]) => `• \`/admin ${cmd}\` - ${desc}`)
    .join('\n');

  return `${ctx.i18n.t().adminCommandsTitle}

${commandList}

${ctx.i18n.t().adminOnlyNote}`;
}

// Command map
const ADMIN_COMMAND_HANDLERS: Record<string, AdminCommandHandler> = {
  persona: handlePersonaCommand,
  trigger: handleTriggerCommand,
  stats: handleStatsCommand,
  groups: handleGroupsCommand,
  tasks: handleTasksCommand,
  errors: handleErrorsCommand,
  report: handleReportCommand,
  export: handleExportCommand,
  language: handleLanguageCommand,
  help: handleHelpCommand,
};

// Main admin command dispatcher
async function handleAdminCommand(
  command: string,
  args: string[],
): Promise<string> {
  const handler =
    ADMIN_COMMAND_HANDLERS[command] || ADMIN_COMMAND_HANDLERS.help;

  // Load dependencies
  const {
    getAllTasks,
    getUsageStats,
    getAllErrorStates,
    getConversationExport,
    formatExportAsMarkdown,
  } = await import('./db.js');
  const { t, setLanguage, availableLanguages, getLanguage } =
    await import('./i18n.js');
  const { getAllPersonas } = await import('./personas.js');

  const context: AdminCommandContext = {
    registeredGroups: getRegisteredGroups(),
    db: {
      getAllTasks,
      getUsageStats,
      getAllErrorStates,
      getConversationExport,
      formatExportAsMarkdown,
    },
    i18n: {
      t,
      setLanguage,
      availableLanguages,
      getLanguage,
    },
    personas: {
      getAllPersonas,
    },
  };

  return handler(args, context);
}

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

  // Maintenance mode: auto-reply and skip processing
  if (isMaintenanceMode()) {
    await bot.sendMessage(parseInt(chatId), '⚙️ 系統維護中，請稍後再試。');
    return;
  }

  // Extract content (text or caption)
  let content = msg.text || msg.caption || '';
  const isMainGroup = group.folder === MAIN_GROUP_FOLDER;

  // Handle admin commands (main group only)
  if (isMainGroup && content.startsWith('/admin')) {
    const parts = content.slice(7).trim().split(/\s+/);
    const adminCmd = parts[0] || 'help';
    const adminArgs = parts.slice(1);

    try {
      const response = await handleAdminCommand(adminCmd, adminArgs);
      await sendMessage(chatId, response);
    } catch (err) {
      logger.error({ err: formatError(err) }, 'Admin command failed');
      await sendMessage(
        chatId,
        '❌ Admin command failed. Check logs for details.',
      );
    }
    return;
  }

  // Check if trigger prefix is required (main group always responds; others check requireTrigger setting)
  const needsTrigger = !isMainGroup && group.requireTrigger !== false;
  if (needsTrigger && !TRIGGER_PATTERN.test(content)) return;

  // Onboarding check for new groups (before processing first message)
  const isCommand = content.startsWith('/');
  if (!isCommand) {
    const { checkAndStartOnboarding } = await import('./onboarding.js');
    const triggered = await checkAndStartOnboarding(
      chatId,
      group.folder,
      group.name,
    );
    if (triggered) return; // Don't process the first message, show onboarding instead
  }

  // Rate limiting check
  const { checkRateLimit } = await import('./db.js');
  const { RATE_LIMIT } = await import('./config.js');
  const { t } = await import('./i18n.js');

  if (RATE_LIMIT.ENABLED) {
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
      await sendMessage(
        chatId,
        `${t().rateLimited} ${t().retryIn(waitMinutes)}`,
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
    replyContext = `[回復 ${replySender} 的訊息: "${replyContent.slice(0, 200)}${replyContent.length > 200 ? '...' : ''}"]\n`;
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

  // Send status message for processing requests
  statusMsg = await bot.sendMessage(chatId, `⏳ ${t().processing}...`, {
    reply_to_message_id: msg.message_id,
  });

  if (mediaInfo) {
    await bot.editMessageText(`📥 ${t().downloadingMedia}...`, {
      chat_id: chatId,
      message_id: statusMsg.message_id,
    });

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
          await bot.editMessageText(`⚠️ ${t().stt_too_long}`, {
            chat_id: chatId,
            message_id: statusMsg.message_id,
          });
          return;
        }

        await bot.editMessageText(`🧠 ${t().transcribing}...`, {
          chat_id: chatId,
          message_id: statusMsg.message_id,
        });

        const { transcribeAudio } = await import('./stt.js');
        let transcription: string;
        try {
          transcription = await transcribeAudio(mediaPath);
          // Echo transcription back to user
          await sendMessage(
            chatId,
            `🎤 ${t().stt_transcribed}: "${transcription}"`,
          );
          logger.info(
            { chatId, transcription: transcription.slice(0, 100) },
            'Voice message transcribed',
          );
        } catch (err) {
          await bot.editMessageText(`❌ ${t().stt_error}`, {
            chat_id: chatId,
            message_id: statusMsg.message_id,
          });
          logger.error({ err, chatId }, 'Voice transcription failed');
          return;
        }
        content = `[Voice message transcription: "${transcription}"]\n[Audio file: ${containerMediaPath}]\n${content}`;
      } else {
        content = `[Media: ${mediaInfo.type} at ${containerMediaPath}]\n${content}`;
      }
    }
  }

  await bot.editMessageText(`🤖 ${t().thinking}...`, {
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
  );

  const lines = missedMessages.map((m) => {
    const escapeXml = (s: string) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    return `<message sender="${escapeXml(m.sender_name)}" time="${m.timestamp}">${escapeXml(m.content)}</message>`;
  });
  const prompt = `<messages>\n${lines.join('\n')}\n</messages>`;

  if (!prompt) return;

  logger.info(
    { group: group.name, messageCount: missedMessages.length },
    'Processing message',
  );

  const ipcMessageSentChats = getIpcMessageSentChats();
  await setTyping(chatId, true);
  ipcMessageSentChats.delete(chatId); // Reset before agent run
  try {
    const response = await runAgent(
      group,
      prompt,
      chatId,
      mediaPath,
      statusMsg,
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
          { text: `🔄 ${t().retry}`, callbackData: `retry:${msg.message_id}` },
          {
            text: `💬 ${t().feedback}`,
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
              callbackData: JSON.stringify({ type: 'reply', data: suggestion }),
            },
          ]);
        }
      }

      await sendMessageWithButtons(
        chatId,
        `${ASSISTANT_NAME}: ${cleanText}`,
        buttons,
      );
    } else if (ipcAlreadySent && statusMsg) {
      // IPC handled the response; just clean up status message
      await bot
        .deleteMessage(parseInt(chatId), statusMsg.message_id)
        .catch(() => {});
    } else if (statusMsg) {
      // If no response, update status message to error with retry button
      await bot
        .editMessageText(`❌ ${t().errorOccurred}`, {
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
    await setTyping(chatId, false);
  }
}

// ============================================================================
// Follow-up Suggestions Parsing
// ============================================================================

/**
 * Extract follow-up suggestions from agent response.
 * Lines starting with ">>>" are treated as suggestions.
 */
function extractFollowUps(text: string): {
  cleanText: string;
  followUps: string[];
} {
  const lines = text.split('\n');
  const followUps: string[] = [];
  const contentLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('>>>')) {
      const suggestion = trimmed.slice(3).trim();
      if (suggestion) followUps.push(suggestion);
    } else {
      contentLines.push(line);
    }
  }

  // Remove trailing empty lines from content
  while (
    contentLines.length > 0 &&
    contentLines[contentLines.length - 1].trim() === ''
  ) {
    contentLines.pop();
  }

  return {
    cleanText: contentLines.join('\n'),
    followUps: followUps.slice(0, 3), // Max 3 suggestions
  };
}

// ============================================================================
// Agent Execution with Retry Helper
// ============================================================================

interface RetryOptions {
  maxRetries: number;
  shouldRetry: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number) => void;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < options.maxRetries && options.shouldRetry(err, attempt)) {
        options.onRetry?.(err, attempt);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatId: string,
  mediaPath: string | null = null,
  statusMsg: TelegramBot.Message | null = null,
): Promise<string | null> {
  const bot = getBot();
  const sessions = getSessions();
  const registeredGroups = getRegisteredGroups();
  const isMain = group.folder === MAIN_GROUP_FOLDER;
  const sessionId = sessions[group.folder];

  // Import streaming utilities
  const { telegramRateLimiter, safeMarkdownTruncate } =
    await import('./telegram-rate-limiter.js');

  // Create progress callback that updates Telegram statusMsg with streaming support
  const onProgress = async (info: ProgressInfo) => {
    if (!statusMsg) return;
    try {
      let progressText = '🤖 思考中...';
      if (info.type === 'tool_use') {
        const toolEmoji: Record<string, string> = {
          google_search: '🔍 正在搜尋網路...',
          web_search: '🔍 正在搜尋網路...',
          read_file: '📄 正在讀取檔案...',
          write_file: '✍️ 正在寫入...',
          generate_image: '🎨 正在生成圖片...',
          execute_code: '⚙️ 正在執行程式...',
          schedule_task: '📅 正在排程任務...',
          set_preference: '⚙️ 正在設定偏好...',
        };
        progressText =
          toolEmoji[info.toolName || ''] || `🔧 使用工具: ${info.toolName}...`;
        await bot
          .editMessageText(progressText, {
            chat_id: chatId,
            message_id: statusMsg.message_id,
          })
          .catch(() => {});
      } else if (info.type === 'message') {
        // Use streaming for long responses (>100 chars)
        if (info.contentSnapshot && info.contentSnapshot.length > 100) {
          // Check rate limit before editing
          if (telegramRateLimiter.canEdit(chatId)) {
            const truncated = safeMarkdownTruncate(info.contentSnapshot, 4096);
            const streamingIndicator = info.isComplete ? '' : ' ⏳';
            await bot
              .editMessageText(`💬 ${truncated}${streamingIndicator}`, {
                chat_id: chatId,
                message_id: statusMsg.message_id,
                parse_mode: 'Markdown',
              })
              .catch(() => {});
            telegramRateLimiter.recordEdit(chatId);
          }
        } else if (info.content || info.contentSnapshot) {
          // Short response or fallback
          progressText = `💬 回應中...`;
          await bot
            .editMessageText(progressText, {
              chat_id: chatId,
              message_id: statusMsg.message_id,
            })
            .catch(() => {});
        }
      }
    } catch {}
  };

  // Import message consolidator and mark streaming as active
  const { messageConsolidator } = await import('./message-consolidator.js');
  messageConsolidator.setStreaming(chatId, true);

  try {
    // Get memory context from conversation summaries
    const { getMemoryContext } = await import('./memory-summarizer.js');
    const memoryContext = getMemoryContext(group.folder);

    // ========================================================================
    // Fast Path: Direct Gemini API with streaming + function calling
    // ========================================================================
    const { isFastPathEligible, runFastPath } = await import('./fast-path.js');
    const hasMedia = !!mediaPath;

    if (isFastPathEligible(group, hasMedia)) {
      logger.info({ group: group.name }, 'Using fast path (direct API)');

      // Resolve system prompt with persona
      const { getEffectiveSystemPrompt } = await import('./personas.js');
      const systemPrompt = getEffectiveSystemPrompt(
        group.systemPrompt,
        group.persona,
      );

      // Build IPC context for function calling
      const ipcContext = {
        sourceGroup: group.folder,
        isMain,
        registeredGroups,
        sendMessage: async (jid: string, text: string) => {
          await sendMessage(jid, text);
        },
        bot,
      };

      // Fetch recent conversation history for multi-turn context
      let conversationHistory: Array<{
        role: 'user' | 'model';
        text: string;
      }> = [];
      try {
        const { getRecentConversation } = await import('./db.js');
        conversationHistory = getRecentConversation(
          chatId,
          FAST_PATH.MAX_HISTORY_MESSAGES,
        );
      } catch {
        // DB may not have messages yet
      }

      const startTime = Date.now();

      const output = await runFastPath(
        group,
        {
          prompt,
          groupFolder: group.folder,
          chatJid: chatId,
          isMain,
          systemPrompt,
          memoryContext: memoryContext ?? undefined,
          enableWebSearch: group.enableWebSearch ?? true,
          conversationHistory,
        },
        ipcContext,
        onProgress,
      );

      const durationMs = Date.now() - startTime;

      // Log usage statistics (same mechanism as container runner)
      try {
        const { logUsage, resetErrors, recordError } = await import('./db.js');
        const { GEMINI_MODEL: defaultModel } = await import('./config.js');
        logUsage({
          group_folder: group.folder,
          timestamp: new Date().toISOString(),
          duration_ms: durationMs,
          prompt_tokens: output.promptTokens,
          response_tokens: output.responseTokens,
          model: `fast:${group.geminiModel || defaultModel}`,
        });

        if (output.status === 'error') {
          recordError(group.folder, output.error || 'Fast path error');
        } else {
          resetErrors(group.folder);
        }
      } catch (logErr) {
        logger.warn({ err: logErr }, 'Failed to log fast path usage stats');
      }

      if (output.status === 'error') {
        // Fast path failed - fall through to container as fallback
        logger.warn(
          { group: group.name, error: output.error },
          'Fast path failed, falling back to container',
        );
      } else {
        return output.result;
      }
    }

    // ========================================================================
    // Container Path: Full container-based execution (existing behavior)
    // ========================================================================

    // Update tasks snapshot for container to read
    const tasks = getAllTasks();
    writeTasksSnapshot(
      group.folder,
      isMain,
      tasks.map((t) => ({
        id: t.id,
        groupFolder: t.group_folder,
        prompt: t.prompt,
        schedule_type: t.schedule_type,
        schedule_value: t.schedule_value,
        status: t.status,
        next_run: t.next_run,
      })),
    );

    // Update available groups snapshot
    const availableGroups = getAvailableGroups();
    writeGroupsSnapshot(
      group.folder,
      isMain,
      availableGroups,
      new Set(Object.keys(registeredGroups)),
    );

    // Helper to run container agent once
    const runOnce = async (useSessionId?: string) => {
      return await runContainerAgent(
        group,
        {
          prompt,
          sessionId: useSessionId,
          groupFolder: group.folder,
          chatJid: chatId,
          isMain,
          systemPrompt: group.systemPrompt,
          persona: group.persona,
          enableWebSearch: group.enableWebSearch ?? true,
          mediaPath: mediaPath
            ? `/workspace/group/media/${path.basename(mediaPath)}`
            : undefined,
          memoryContext: memoryContext ?? undefined,
        },
        onProgress,
      );
    };

    // First attempt with session
    const output = await runOnce(sessionId);

    if (output.newSessionId) {
      sessions[group.folder] = output.newSessionId;
      saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);
    }

    if (output.status === 'error') {
      // Retry logic for session resume failure
      if (sessionId && output.error?.includes('No previous sessions found')) {
        logger.warn(
          { group: group.name },
          'Session resume failed, retrying without session',
        );
        delete sessions[group.folder];
        saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);

        const retryOutput = await runOnce(undefined);

        if (retryOutput.newSessionId) {
          sessions[group.folder] = retryOutput.newSessionId;
          saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);
        }

        if (retryOutput.status === 'error') {
          logger.error(
            { group: group.name, error: retryOutput.error },
            'Container agent error (retry)',
          );
          return null;
        }
        return retryOutput.result;
      }

      // Retry logic for timeout or non-zero exit
      const isTimeout = output.error?.includes('Container timed out after');
      const isNonZeroExit = output.error?.includes(
        'Container exited with code',
      );

      if (isTimeout || isNonZeroExit) {
        logger.warn(
          { group: group.name, error: output.error },
          'Container timeout/error, retrying with fresh session',
        );

        // Send retry status update to chat
        try {
          await bot
            .sendMessage(parseInt(chatId), '🔄 重試中...')
            .catch(() => {});
        } catch {}

        // Wait 2 seconds before retry
        await new Promise((r) => setTimeout(r, 2000));

        // Clear session for fresh start
        delete sessions[group.folder];
        saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);

        const retryOutput = await runOnce(undefined);

        if (retryOutput.newSessionId) {
          sessions[group.folder] = retryOutput.newSessionId;
          saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);
        }

        if (retryOutput.status === 'error') {
          logger.error(
            { group: group.name, error: retryOutput.error },
            'Container agent error (retry after timeout)',
          );
          return null;
        }
        return retryOutput.result;
      }

      logger.error(
        { group: group.name, error: output.error },
        'Container agent error',
      );
      return null;
    }

    return output.result;
  } catch (err) {
    logger.error({ group: group.name, err }, 'Agent error');
    return null;
  } finally {
    // Clear streaming state
    messageConsolidator.setStreaming(chatId, false);
  }
}
