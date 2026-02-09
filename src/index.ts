/**
 * NanoGemClaw - Personal AI Assistant
 * Telegram Bot Frontend with Gemini CLI Backend
 */
import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import https from 'https';

import {
  ASSISTANT_NAME,
  CLEANUP,
  CONTAINER,
  DATA_DIR,
  IPC_POLL_INTERVAL,
  MAIN_GROUP_FOLDER,
  STORE_DIR,
  TELEGRAM,
  TELEGRAM_BOT_TOKEN,
  TIMEZONE,
  TRIGGER_PATTERN,
  GROUPS_DIR,
} from './config.js';
import {
  AvailableGroup,
  runContainerAgent,
  writeGroupsSnapshot,
  writeTasksSnapshot,
  type ProgressInfo,
} from './container-runner.js';
import {
  getAllChats,
  getAllTasks,
  getLastGroupSync,
  getMessagesSince,
  getNewMessages,
  getTaskById,
  initDatabase,
  closeDatabase,
  setLastGroupSync,
  storeChatMetadata,
  storeMessage,
  updateChatName,
} from './db.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { NewMessage, RegisteredGroup, Session } from './types.js';
import { loadJson, saveJson, formatError } from './utils.js';

import { logger } from './logger.js';
import { isMaintenanceMode, loadMaintenanceState } from './maintenance.js';
import { setGroupRegistrar } from './server.js';

let bot: TelegramBot;
let lastTimestamp = '';
let sessions: Session = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};
/** Track chatIds that received IPC messages during a container run */
const ipcMessageSentChats = new Set<string>();

// ============================================================================
// State Management
// ============================================================================

async function loadState(): Promise<void> {
  const statePath = path.join(DATA_DIR, 'router_state.json');
  const state = loadJson<{
    last_timestamp?: string;
    last_agent_timestamp?: Record<string, string>;
    language?: string;
  }>(statePath, {});
  lastTimestamp = state.last_timestamp || '';
  lastAgentTimestamp = state.last_agent_timestamp || {};

  if (state.language) {
    const { setLanguage, availableLanguages } = await import('./i18n.js');
    type Language = import('./i18n.js').Language;
    if (availableLanguages.includes(state.language as Language)) {
      setLanguage(state.language as Language);
    }
  }

  sessions = loadJson(path.join(DATA_DIR, 'sessions.json'), {});
  registeredGroups = loadJson(
    path.join(DATA_DIR, 'registered_groups.json'),
    {},
  );
  logger.info(
    { groupCount: Object.keys(registeredGroups).length },
    'State loaded',
  );
}

async function saveState(): Promise<void> {
  const { getLanguage } = await import('./i18n.js');
  saveJson(path.join(DATA_DIR, 'router_state.json'), {
    last_timestamp: lastTimestamp,
    last_agent_timestamp: lastAgentTimestamp,
    language: getLanguage(),
  });
  saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);
}

function registerGroup(chatId: string, group: RegisteredGroup): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(group.folder)) {
    logger.warn({ folder: group.folder }, 'Invalid folder name rejected');
    return;
  }
  registeredGroups[chatId] = group;
  saveJson(path.join(DATA_DIR, 'registered_groups.json'), registeredGroups);

  // Create group folder
  const groupDir = path.join(GROUPS_DIR, group.folder);
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(groupDir, 'media'), { recursive: true });

  logger.info(
    { chatId, name: group.name, folder: group.folder },
    'Group registered',
  );
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

function startMediaCleanupScheduler(): void {
  // Run immediately on startup
  cleanupOldMedia();
  // Then run periodically
  setInterval(cleanupOldMedia, CLEANUP.MEDIA_CLEANUP_INTERVAL_MS);
  logger.info({ intervalHours: CLEANUP.MEDIA_CLEANUP_INTERVAL_HOURS }, 'Media cleanup scheduler started');
}

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
  try {
    const fileInfo = await bot.getFile(fileId);
    if (!fileInfo.file_path) return null;

    const mediaDir = path.join(GROUPS_DIR, groupFolder, 'media');
    fs.mkdirSync(mediaDir, { recursive: true });

    const ext = path.extname(fileInfo.file_path) || '.bin';
    const sanitizedName = path.basename(fileName || '').replace(/[^a-zA-Z0-9._-]/g, '_');
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
      https.get(fileUrl, (response) => {
        // Check for successful HTTP response
        if (response.statusCode !== 200) {
          fs.unlink(localPath, () => { });
          reject(new Error(`HTTP ${response.statusCode}: Failed to download media`));
          return;
        }
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', (err) => {
        fs.unlink(localPath, () => { });
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

async function handleAdminCommand(
  command: string,
  args: string[],
): Promise<string> {
  const { getAllTasks, getUsageStats, getAllErrorStates } = await import('./db.js');
  const { t, setLanguage, availableLanguages, getLanguage } = await import('./i18n.js');
  type Language = import('./i18n.js').Language;
  const { PERSONAS, getAllPersonas } = await import('./personas.js');

  switch (command) {
    // ... cases ...

    case 'persona': {
      const subCmd = args[0];

      if (subCmd === 'list') {
        const allPersonas = getAllPersonas();
        return `🎭 **Available Personas**\n\n${Object.entries(allPersonas)
          .map(([key, p]) => `• \`${key}\`: ${p.name} - ${p.description}`)
          .join('\n')}`;
      }

      if (subCmd === 'set' && args[1] && args[2]) {
        const targetGroup = args[1]; // folder name or 'main'
        const key = args[2];

        let targetId: string | undefined;
        // Resolve group folder
        for (const [id, g] of Object.entries(registeredGroups)) {
          if (g.folder === targetGroup || g.name === targetGroup) {
            targetId = id;
            break;
          }
        }

        if (!targetId) {
          return `❌ Group not found: ${targetGroup}`;
        }

        const allPersonas = getAllPersonas();
        if (!allPersonas[key]) {
          return `❌ Invalid persona key: ${key}. Use \`/admin persona list\``;
        }

        registeredGroups[targetId].persona = key;
        saveState();
        return `✅ Persona for **${registeredGroups[targetId].name}** set to **${allPersonas[key].name}**`;
      }

      return 'Usage: `/admin persona list` or `/admin persona set <group_folder> <persona_key>`';
    }

    case 'trigger': {
      const targetGroup = args[0];
      const mode = args[1]?.toLowerCase();

      if (!targetGroup || !mode || !['on', 'off'].includes(mode)) {
        return 'Usage: `/admin trigger <group_folder> on|off`\n\n`on` = require @trigger prefix\n`off` = respond to all messages';
      }

      let targetId: string | undefined;
      for (const [id, g] of Object.entries(registeredGroups)) {
        if (g.folder === targetGroup || g.name === targetGroup) {
          targetId = id;
          break;
        }
      }

      if (!targetId) {
        return `❌ Group not found: ${targetGroup}`;
      }

      registeredGroups[targetId].requireTrigger = mode === 'on';
      saveJson(path.join(DATA_DIR, 'registered_groups.json'), registeredGroups);
      const status = mode === 'on' ? '需要 @trigger 前綴' : '回應所有訊息';
      return `✅ **${registeredGroups[targetId].name}** trigger mode: **${mode}** (${status})`;
    }

    case 'stats': {
      const groupCount = Object.keys(registeredGroups).length;
      const uptime = process.uptime();
      const uptimeHours = Math.floor(uptime / 3600);
      const uptimeMinutes = Math.floor((uptime % 3600) / 60);

      // Get usage stats
      const usage = getUsageStats();
      const avgDuration = usage.total_requests > 0
        ? Math.round(usage.avg_duration_ms / 1000)
        : 0;

      return `${t().statsTitle}

• ${t().registeredGroups}: ${groupCount}
• ${t().uptime}: ${uptimeHours}h ${uptimeMinutes}m
• ${t().memory}: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB

${t().usageAnalytics}
• ${t().totalRequests}: ${usage.total_requests}
• ${t().avgResponseTime}: ${avgDuration}s
• ${t().totalTokens}: ${usage.total_prompt_tokens + usage.total_response_tokens}`;
    }

    case 'groups': {
      const groups = Object.values(registeredGroups);
      if (groups.length === 0) {
        return '📁 No groups registered.';
      }

      const groupList = groups.map((g, i) => {
        const isMain = g.folder === MAIN_GROUP_FOLDER;
        const searchStatus = g.enableWebSearch !== false ? '🔍' : '';
        const hasPrompt = g.systemPrompt ? '💬' : '';
        const triggerStatus = isMain || g.requireTrigger === false ? '📢' : '';
        return `${i + 1}. **${g.name}** ${isMain ? '(main)' : ''} ${searchStatus}${hasPrompt}${triggerStatus}
   📁 ${g.folder} | 🎯 ${g.trigger}`;
      }).join('\n');

      return `📁 **${t().registeredGroups}** (${groups.length})

${groupList}

Legend: 🔍=Search 💬=Custom Prompt 📢=All Messages`;
    }

    case 'tasks': {
      const tasks = getAllTasks();
      if (tasks.length === 0) {
        return '📅 No scheduled tasks.';
      }

      const taskList = tasks.slice(0, 10).map((t, i) => {
        const status = t.status === 'active' ? '✅' : t.status === 'paused' ? '⏸️' : '✓';
        const nextRun = t.next_run ? new Date(t.next_run).toLocaleString() : 'N/A';
        return `${i + 1}. ${status} **${t.group_folder}**
   📋 ${t.prompt.slice(0, 50)}${t.prompt.length > 50 ? '...' : ''}
   ⏰ ${t.schedule_type}: ${t.schedule_value} | Next: ${nextRun}`;
      }).join('\n');

      const moreText = tasks.length > 10 ? `\n\n_...and ${tasks.length - 10} more tasks_` : '';

      return `📅 **Scheduled Tasks** (${tasks.length})

${taskList}${moreText}`;
    }

    case 'errors': {
      const errorStates = getAllErrorStates();

      if (errorStates.length === 0) {
        return t().noErrors;
      }

      const errorList = errorStates
        .filter(e => e.state.consecutiveFailures > 0)
        .map(e => {
          const group = registeredGroups[Object.keys(registeredGroups).find(
            k => registeredGroups[k].folder === e.group
          ) || ''];
          return `• **${group?.name || e.group}**: ${e.state.consecutiveFailures} failures\n  Last: ${e.state.lastError?.slice(0, 80)}...`;
        })
        .join('\n');

      return errorList
        ? `${t().groupsWithErrors}\n\n${errorList}`
        : t().noActiveErrors;
    }

    case 'report': {
      const { getDailyReportMessage } = await import('./daily-report.js');
      return getDailyReportMessage();
    }

    case 'export': {
      const targetFolder = args[0];
      if (!targetFolder) {
        return 'Usage: `/admin export <group_folder>`\nExports conversation as a file.';
      }

      // Find chatId for this folder
      let targetChatId: string | undefined;
      for (const [id, g] of Object.entries(registeredGroups)) {
        if (g.folder === targetFolder || g.name === targetFolder) {
          targetChatId = id;
          break;
        }
      }

      if (!targetChatId) {
        return `❌ Group not found: ${targetFolder}`;
      }

      const { getConversationExport, formatExportAsMarkdown } = await import('./db.js');
      const exportData = getConversationExport(targetChatId);

      if (exportData.messageCount === 0) {
        return `📭 No messages found for **${targetFolder}**.`;
      }

      const md = formatExportAsMarkdown(exportData);

      // Write to temp file and send via Telegram
      const tmpPath = path.join(DATA_DIR, `export-${targetFolder}-${Date.now()}.md`);
      fs.writeFileSync(tmpPath, md, 'utf-8');

      try {
        // Send the file. We need to find a main group chatId to send to.
        // The admin command is executed from the main group, so we use MAIN_GROUP_FOLDER
        const mainChatId = Object.entries(registeredGroups).find(
          ([, g]) => g.folder === MAIN_GROUP_FOLDER
        )?.[0];

        if (mainChatId && bot) {
          await bot.sendDocument(parseInt(mainChatId), tmpPath, {
            caption: `📤 Export: ${targetFolder} (${exportData.messageCount} messages)`,
          });
        }
      } catch (err) {
        logger.error({ err: formatError(err) }, 'Failed to send export file');
      } finally {
        // Clean up temp file
        try { fs.unlinkSync(tmpPath); } catch {}
      }

      return `✅ Exported **${exportData.messageCount}** messages for **${targetFolder}**.`;
    }

    case 'language': {
      const lang = args[0] as Language;
      if (availableLanguages.includes(lang)) {
        setLanguage(lang);
        saveState(); // Persist change
        return `✅ Language switched to: **${lang}**`;
      }
      return `❌ Invalid language. Available: ${availableLanguages.join(', ')}\nCurrent: ${getLanguage()}`;
    }

    case 'help':
    default: {
      const commandList = Object.entries(ADMIN_COMMANDS)
        .map(([cmd, desc]) => `• \`/admin ${cmd}\` - ${desc}`)
        .join('\n');

      return `${t().adminCommandsTitle}

${commandList}

${t().adminOnlyNote}`;
    }
  }
}

// ============================================================================
// Message Processing
// ============================================================================

/**
 * Process an incoming message.
 * Concurrency is handled at the container level (container-runner.ts).
 */
async function processMessage(msg: TelegramBot.Message): Promise<void> {
  const chatId = msg.chat.id.toString();
  const group = registeredGroups[chatId];
  if (!group) return;

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
      await sendMessage(chatId, '❌ Admin command failed. Check logs for details.');
    }
    return;
  }

  // Check if trigger prefix is required (main group always responds; others check requireTrigger setting)
  const needsTrigger = !isMainGroup && (group.requireTrigger !== false);
  if (needsTrigger && !TRIGGER_PATTERN.test(content)) return;

  // Rate limiting check
  const { checkRateLimit } = await import('./db.js');
  const { RATE_LIMIT } = await import('./config.js');
  const { t } = await import('./i18n.js');

  if (RATE_LIMIT.ENABLED) {
    const rateLimitKey = `group:${chatId}`;
    const windowMs = RATE_LIMIT.WINDOW_MINUTES * 60 * 1000;
    const result = checkRateLimit(rateLimitKey, RATE_LIMIT.MAX_REQUESTS, windowMs);

    if (!result.allowed) {
      const waitMinutes = Math.ceil(result.resetInMs / 60000);
      logger.warn({ chatId, remaining: result.remaining, waitMinutes }, 'Rate limited');
      await sendMessage(chatId, `${t().rateLimited} ${t().retryIn(waitMinutes)}`);
      return;
    }
  }

  // Extract reply context if this message is a reply to another
  let replyContext = '';
  if (msg.reply_to_message) {
    const replyMsg = msg.reply_to_message;
    const replySender = replyMsg.from?.first_name || 'Unknown';
    const replyContent = replyMsg.text || replyMsg.caption || '[非文字內容]';
    replyContext = `[回覆 ${replySender} 的訊息: "${replyContent.slice(0, 200)}${replyContent.length > 200 ? '...' : ''}"]\n`;
    content = replyContext + content;
    logger.info({ chatId, replyToId: replyMsg.message_id }, 'Processing reply context');
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

    mediaPath = await downloadMedia(mediaInfo.fileId, group.folder, mediaInfo.fileName);

    if (mediaPath) {
      const containerMediaPath = `/workspace/group/media/${path.basename(mediaPath)}`;

      if (mediaInfo.type === 'voice') {
        await bot.editMessageText(`🧠 ${t().transcribing}...`, {
          chat_id: chatId,
          message_id: statusMsg.message_id,
        });

        const { transcribeAudio } = await import('./stt.js');
        const transcription = await transcribeAudio(mediaPath);
        content = `[Voice message transcription: "${transcription}"]\n[Audio file: ${containerMediaPath}]\n${content}`;
        logger.info({ chatId, transcription: transcription.slice(0, 100) }, 'Voice message transcribed');
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

  await setTyping(chatId, true);
  ipcMessageSentChats.delete(chatId); // Reset before agent run
  const response = await runAgent(group, prompt, chatId, mediaPath, statusMsg);
  await setTyping(chatId, false);

  // Skip container output if agent already sent response via IPC
  const ipcAlreadySent = ipcMessageSentChats.has(chatId);
  ipcMessageSentChats.delete(chatId); // Clean up

  if (response && !ipcAlreadySent) {
    const timestamp = new Date(msg.date * 1000).toISOString();
    lastAgentTimestamp[chatId] = timestamp;

    // Clean up status message
    if (statusMsg) {
      await bot.deleteMessage(parseInt(chatId), statusMsg.message_id).catch(() => { });
    }

    // Send final response with retry button
    const buttons: QuickReplyButton[][] = [
      [
        { text: `🔄 ${t().retry}`, callbackData: `retry:${msg.message_id}` },
        { text: `💬 ${t().feedback}`, callbackData: `feedback_menu:${msg.message_id}` }
      ]
    ];

    await sendMessageWithButtons(chatId, `${ASSISTANT_NAME}: ${response}`, buttons);
  } else if (ipcAlreadySent && statusMsg) {
    // IPC handled the response; just clean up status message
    await bot.deleteMessage(parseInt(chatId), statusMsg.message_id).catch(() => { });
  } else if (statusMsg) {
    // If no response, update status message to error with retry button
    await bot.editMessageText(`❌ ${t().errorOccurred}`, {
      chat_id: parseInt(chatId),
      message_id: statusMsg.message_id,
      reply_markup: {
        inline_keyboard: [[
          { text: '🔄 Retry', callback_data: `retry:${msg.message_id}` }
        ]]
      }
    }).catch(() => { });
  }
}

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatId: string,
  mediaPath: string | null = null,
  statusMsg: TelegramBot.Message | null = null,
): Promise<string | null> {
  const isMain = group.folder === MAIN_GROUP_FOLDER;
  const sessionId = sessions[group.folder];

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

  // Create progress callback that updates Telegram statusMsg
  const onProgress = async (info: ProgressInfo) => {
    if (!statusMsg) return;
    try {
      let progressText = '🤖 思考中...';
      if (info.type === 'tool_use') {
        const toolEmoji: Record<string, string> = {
          'google_search': '🔍 正在搜尋網路...',
          'web_search': '🔍 正在搜尋網路...',
          'read_file': '📄 正在讀取檔案...',
          'write_file': '✍️ 正在寫入...',
          'generate_image': '🎨 正在生成圖片...',
          'execute_code': '⚙️ 正在執行程式...',
        };
        progressText = toolEmoji[info.toolName || ''] || `🔧 使用工具: ${info.toolName}...`;
      } else if (info.type === 'message' && info.content) {
        progressText = `💬 回應中...`;
      }
      await bot.editMessageText(progressText, {
        chat_id: chatId,
        message_id: statusMsg.message_id,
      }).catch(() => {});
    } catch {}
  };

  try {
    // Get memory context from conversation summaries
    const { getMemoryContext } = await import('./memory-summarizer.js');
    const memoryContext = getMemoryContext(group.folder);

    const output = await runContainerAgent(group, {
      prompt,
      sessionId,
      groupFolder: group.folder,
      chatJid: chatId, // Using chatId as chatJid for compatibility
      isMain,
      systemPrompt: group.systemPrompt,
      persona: group.persona,
      enableWebSearch: group.enableWebSearch ?? true, // Default: enabled
      mediaPath: mediaPath ? `/workspace/group/media/${path.basename(mediaPath)}` : undefined,
      memoryContext: memoryContext ?? undefined,
    }, onProgress);

    if (output.newSessionId) {
      sessions[group.folder] = output.newSessionId;
      saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);
    }

    if (output.status === 'error') {
      // Auto-retry without session if resume failed
      if (sessionId && output.error?.includes('No previous sessions found')) {
        logger.warn({ group: group.name }, 'Session resume failed, retrying without session');
        delete sessions[group.folder];
        saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);

        const retryOutput = await runContainerAgent(group, {
          prompt,
          sessionId: undefined,
          groupFolder: group.folder,
          chatJid: chatId,
          isMain,
          systemPrompt: group.systemPrompt,
          persona: group.persona,
          enableWebSearch: group.enableWebSearch ?? true,
          mediaPath: mediaPath ? `/workspace/group/media/${path.basename(mediaPath)}` : undefined,
          memoryContext: memoryContext ?? undefined,
        });

        if (retryOutput.newSessionId) {
          sessions[group.folder] = retryOutput.newSessionId;
          saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);
        }

        if (retryOutput.status === 'error') {
          logger.error({ group: group.name, error: retryOutput.error }, 'Container agent error (retry)');
          return null;
        }
        return retryOutput.result;
      }

      // Auto-retry on timeout or non-zero exit (fresh session)
      const isTimeout = output.error?.includes('Container timed out after');
      const isNonZeroExit = output.error?.includes('Container exited with code');

      if (isTimeout || isNonZeroExit) {
        logger.warn({ group: group.name, error: output.error }, 'Container timeout/error, retrying with fresh session');

        // Send retry status update to chat
        try {
          await bot.sendMessage(parseInt(chatId), '🔄 重試中...').catch(() => {});
        } catch {}

        // Wait 2 seconds before retry
        await new Promise(r => setTimeout(r, 2000));

        // Clear session for fresh start
        delete sessions[group.folder];
        saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);

        const retryOutput = await runContainerAgent(group, {
          prompt,
          sessionId: undefined,
          groupFolder: group.folder,
          chatJid: chatId,
          isMain,
          systemPrompt: group.systemPrompt,
          persona: group.persona,
          enableWebSearch: group.enableWebSearch ?? true,
          mediaPath: mediaPath ? `/workspace/group/media/${path.basename(mediaPath)}` : undefined,
          memoryContext: memoryContext ?? undefined,
        });

        if (retryOutput.newSessionId) {
          sessions[group.folder] = retryOutput.newSessionId;
          saveJson(path.join(DATA_DIR, 'sessions.json'), sessions);
        }

        if (retryOutput.status === 'error') {
          logger.error({ group: group.name, error: retryOutput.error }, 'Container agent error (retry after timeout)');
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
  }
}

// ============================================================================
// Telegram Helpers
// ============================================================================

// Typing indicator state (per chat)
const typingIntervals = new Map<string, NodeJS.Timeout>();

async function setTyping(chatId: string, isTyping: boolean): Promise<void> {
  if (isTyping) {
    // Clear any existing interval
    const existing = typingIntervals.get(chatId);
    if (existing) {
      clearInterval(existing);
    }

    // Send initial typing indicator
    try {
      await bot.sendChatAction(parseInt(chatId), 'typing');
    } catch {
      // Ignore typing errors
    }

    // Refresh typing indicator every 5 seconds (Telegram resets after ~5s)
    const interval = setInterval(async () => {
      try {
        await bot.sendChatAction(parseInt(chatId), 'typing');
      } catch {
        // Stop if error
        clearInterval(interval);
        typingIntervals.delete(chatId);
      }
    }, 5000);

    typingIntervals.set(chatId, interval);
  } else {
    // Stop typing indicator
    const interval = typingIntervals.get(chatId);
    if (interval) {
      clearInterval(interval);
      typingIntervals.delete(chatId);
    }
  }
}

async function sendMessage(chatId: string, text: string): Promise<void> {
  try {
    const chunks = splitMessageIntelligently(text, TELEGRAM.MAX_MESSAGE_LENGTH - 96);

    for (let i = 0; i < chunks.length; i++) {
      await bot.sendMessage(parseInt(chatId), chunks[i]);
      // Rate limiting: add delay between chunks to avoid Telegram limits
      if (i < chunks.length - 1) {
        await new Promise(r => setTimeout(r, TELEGRAM.RATE_LIMIT_DELAY_MS));
      }
    }
    logger.info({ chatId, length: text.length, chunks: chunks.length }, 'Message sent');
  } catch (err) {
    logger.error({ chatId, err: formatError(err) }, 'Failed to send message');
  }
}

/**
 * Quick reply button definition
 */
interface QuickReplyButton {
  text: string;
  callbackData: string;
}

/**
 * Send a message with inline keyboard buttons
 */
async function sendMessageWithButtons(
  chatId: string,
  text: string,
  buttons: QuickReplyButton[][],
): Promise<void> {
  try {
    const inlineKeyboard = buttons.map((row) =>
      row.map((btn) => ({
        text: btn.text,
        callback_data: btn.callbackData,
      })),
    );

    await bot.sendMessage(parseInt(chatId), text, {
      reply_markup: {
        inline_keyboard: inlineKeyboard,
      },
    });
    logger.info({ chatId, buttonRows: buttons.length }, 'Message with buttons sent');
  } catch (err) {
    logger.error({ chatId, err: formatError(err) }, 'Failed to send message with buttons');
  }
}

/**
 * Split a long message at natural breakpoints (paragraphs, then sentences)
 * while trying to preserve markdown code blocks.
 */
function splitMessageIntelligently(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Find the best split point within maxLen
    let splitPoint = findSplitPoint(remaining, maxLen);

    chunks.push(remaining.slice(0, splitPoint).trim());
    remaining = remaining.slice(splitPoint).trim();
  }

  return chunks;
}

/**
 * Find the best point to split a message, preferring:
 * 1. After a code block (```)
 * 2. After a paragraph break (double newline)
 * 3. After a single newline
 * 4. After a sentence (. ! ?)
 * 5. After a word boundary (space)
 * 6. Hard cut at maxLen (last resort)
 */
function findSplitPoint(text: string, maxLen: number): number {
  const searchText = text.slice(0, maxLen);

  // Priority 1: After code block closing
  const codeBlockEnd = searchText.lastIndexOf('\n```\n');
  if (codeBlockEnd > maxLen * 0.3) {
    return codeBlockEnd + 5;
  }

  // Priority 2: After paragraph break (double newline)
  const paragraphBreak = searchText.lastIndexOf('\n\n');
  if (paragraphBreak > maxLen * 0.5) {
    return paragraphBreak + 2;
  }

  // Priority 3: After single newline
  const lineBreak = searchText.lastIndexOf('\n');
  if (lineBreak > maxLen * 0.7) {
    return lineBreak + 1;
  }

  // Priority 4: After sentence ending
  const sentenceEnders = ['. ', '! ', '? ', '。', '！', '？'];
  let lastSentence = -1;
  for (const ender of sentenceEnders) {
    const pos = searchText.lastIndexOf(ender);
    if (pos > lastSentence) {
      lastSentence = pos;
    }
  }
  if (lastSentence > maxLen * 0.5) {
    return lastSentence + 2;
  }

  // Priority 5: After space (word boundary)
  const lastSpace = searchText.lastIndexOf(' ');
  if (lastSpace > maxLen * 0.7) {
    return lastSpace + 1;
  }

  // Priority 6: Hard cut (avoid breaking markdown)
  return maxLen;
}

function getAvailableGroups(): AvailableGroup[] {
  const chats = getAllChats();
  const registeredIds = new Set(Object.keys(registeredGroups));

  return chats
    .filter((c) => c.jid !== '__group_sync__')
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: registeredIds.has(c.jid),
    }));
}

// ============================================================================
// IPC Watcher
// ============================================================================

function startIpcWatcher(): void {
  const ipcBaseDir = path.join(DATA_DIR, 'ipc');
  fs.mkdirSync(ipcBaseDir, { recursive: true });

  // Track active watchers for cleanup
  const watchers: fs.FSWatcher[] = [];

  // Debounce mechanism to batch file system events
  let pendingProcess = false;
  let debounceTimer: NodeJS.Timeout | null = null;

  const scheduleProcess = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (!pendingProcess) {
        pendingProcess = true;
        processIpcFiles().finally(() => {
          pendingProcess = false;
        });
      }
    }, CONTAINER.IPC_DEBOUNCE_MS);
  };

  const processIpcFiles = async () => {
    let groupFolders: string[];
    try {
      groupFolders = fs.readdirSync(ipcBaseDir).filter((f) => {
        try {
          const stat = fs.statSync(path.join(ipcBaseDir, f));
          return stat.isDirectory() && f !== 'errors';
        } catch {
          return false;
        }
      });
    } catch (err) {
      logger.error({ err: formatError(err) }, 'Error reading IPC base directory');
      return;
    }

    for (const sourceGroup of groupFolders) {
      const isMain = sourceGroup === MAIN_GROUP_FOLDER;
      const messagesDir = path.join(ipcBaseDir, sourceGroup, 'messages');
      const tasksDir = path.join(ipcBaseDir, sourceGroup, 'tasks');

      // Ensure directories exist and watch them
      for (const dir of [messagesDir, tasksDir]) {
        fs.mkdirSync(dir, { recursive: true });
        setupWatcher(dir);
      }

      // Process messages
      try {
        if (fs.existsSync(messagesDir)) {
          const messageFiles = fs
            .readdirSync(messagesDir)
            .filter((f) => f.endsWith('.json'));
          for (const file of messageFiles) {
            const filePath = path.join(messagesDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              if (data.type === 'message' && data.chatJid && data.text) {
                const targetGroup = registeredGroups[data.chatJid];
                if (
                  isMain ||
                  (targetGroup && targetGroup.folder === sourceGroup)
                ) {
                  await sendMessage(
                    data.chatJid,
                    `${ASSISTANT_NAME}: ${data.text}`,
                  );
                  ipcMessageSentChats.add(data.chatJid);
                  logger.info(
                    { chatId: data.chatJid, sourceGroup },
                    'IPC message sent',
                  );
                } else {
                  logger.warn(
                    { chatId: data.chatJid, sourceGroup },
                    'Unauthorized IPC message attempt blocked',
                  );
                }
              }
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error(
                { file, sourceGroup, err: formatError(err) },
                'Error processing IPC message',
              );
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(
                filePath,
                path.join(errorDir, `${sourceGroup}-${file}`),
              );
            }
          }
        }
      } catch (err) {
        logger.error(
          { err: formatError(err), sourceGroup },
          'Error reading IPC messages directory',
        );
      }

      // Process tasks
      try {
        if (fs.existsSync(tasksDir)) {
          const taskFiles = fs
            .readdirSync(tasksDir)
            .filter((f) => f.endsWith('.json'));
          for (const file of taskFiles) {
            const filePath = path.join(tasksDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              await processTaskIpc(data, sourceGroup, isMain);
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error(
                { file, sourceGroup, err: formatError(err) },
                'Error processing IPC task',
              );
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(
                filePath,
                path.join(errorDir, `${sourceGroup}-${file}`),
              );
            }
          }
        }
      } catch (err) {
        logger.error({ err: formatError(err), sourceGroup }, 'Error reading IPC tasks directory');
      }
    }
  };

  // Set up fs.watch for a directory
  const watchedDirs = new Set<string>();
  const setupWatcher = (dir: string) => {
    if (watchedDirs.has(dir)) return;

    try {
      const watcher = fs.watch(dir, { persistent: false }, (eventType, filename) => {
        if (filename && filename.endsWith('.json')) {
          scheduleProcess();
        }
      });

      watcher.on('error', (err) => {
        logger.debug({ dir, err: formatError(err) }, 'Watch error, will use polling fallback');
      });

      watchers.push(watcher);
      watchedDirs.add(dir);
    } catch (err) {
      logger.debug({ dir, err: formatError(err) }, 'Failed to set up watcher');
    }
  };

  // Watch base directory for new group folders
  try {
    const baseWatcher = fs.watch(ipcBaseDir, { persistent: false }, () => {
      scheduleProcess();
    });
    watchers.push(baseWatcher);
  } catch (err) {
    logger.warn({ err: formatError(err) }, 'Failed to watch IPC base directory');
  }

  // Initial process and fallback polling (slower interval as safety net)
  processIpcFiles();
  setInterval(() => {
    if (!pendingProcess) {
      processIpcFiles();
    }
  }, IPC_POLL_INTERVAL * CONTAINER.IPC_FALLBACK_POLLING_MULTIPLIER);

  logger.info('IPC watcher started (using fs.watch with polling fallback)');
}

async function processTaskIpc(
  data: {
    type: string;
    taskId?: string;
    prompt?: string;
    schedule_type?: string;
    schedule_value?: string;
    context_mode?: string;
    groupFolder?: string;
    chatJid?: string;
    jid?: string;
    name?: string;
    folder?: string;
    trigger?: string;
    containerConfig?: RegisteredGroup['containerConfig'];
  },
  sourceGroup: string,
  isMain: boolean,
): Promise<void> {
  const {
    createTask,
    updateTask,
    deleteTask,
    getTaskById: getTask,
  } = await import('./db.js');
  const { CronExpressionParser } = await import('cron-parser');

  switch (data.type) {
    case 'schedule_task':
      if (
        data.prompt &&
        data.schedule_type &&
        data.schedule_value &&
        data.groupFolder
      ) {
        const targetGroup = data.groupFolder;
        if (!isMain && targetGroup !== sourceGroup) {
          logger.warn(
            { sourceGroup, targetGroup },
            'Unauthorized schedule_task attempt blocked',
          );
          break;
        }

        const targetChatId = Object.entries(registeredGroups).find(
          ([, group]) => group.folder === targetGroup,
        )?.[0];

        if (!targetChatId) {
          logger.warn(
            { targetGroup },
            'Cannot schedule task: target group not registered',
          );
          break;
        }

        const scheduleType = data.schedule_type as 'cron' | 'interval' | 'once';

        let nextRun: string | null = null;
        if (scheduleType === 'cron') {
          try {
            const interval = CronExpressionParser.parse(data.schedule_value, {
              tz: TIMEZONE,
            });
            nextRun = interval.next().toISOString();
          } catch {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid cron expression',
            );
            break;
          }
        } else if (scheduleType === 'interval') {
          const ms = parseInt(data.schedule_value, 10);
          if (isNaN(ms) || ms <= 0) {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid interval',
            );
            break;
          }
          nextRun = new Date(Date.now() + ms).toISOString();
        } else if (scheduleType === 'once') {
          const scheduled = new Date(data.schedule_value);
          if (isNaN(scheduled.getTime())) {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid timestamp',
            );
            break;
          }
          nextRun = scheduled.toISOString();
        }

        const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const contextMode =
          data.context_mode === 'group' || data.context_mode === 'isolated'
            ? data.context_mode
            : 'isolated';
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
          { taskId, sourceGroup, targetGroup, contextMode },
          'Task created via IPC',
        );
      }
      break;

    case 'pause_task':
      if (data.taskId) {
        const task = getTask(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'paused' });
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task paused via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task pause attempt',
          );
        }
      }
      break;

    case 'resume_task':
      if (data.taskId) {
        const task = getTask(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'active' });
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task resumed via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task resume attempt',
          );
        }
      }
      break;

    case 'cancel_task':
      if (data.taskId) {
        const task = getTask(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          deleteTask(data.taskId);
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task cancelled via IPC',
          );
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task cancel attempt',
          );
        }
      }
      break;

    case 'register_group':
      if (!isMain) {
        logger.warn(
          { sourceGroup },
          'Unauthorized register_group attempt blocked',
        );
        break;
      }
      if (data.jid && data.name && data.folder && data.trigger) {
        if (!/^[a-zA-Z0-9_-]+$/.test(data.folder)) {
          logger.warn({ folder: data.folder }, 'Invalid folder name in register_group IPC');
          break;
        }
        registerGroup(data.jid, {
          name: data.name,
          folder: data.folder,
          trigger: data.trigger,
          added_at: new Date().toISOString(),
          containerConfig: data.containerConfig,
        });
      } else {
        logger.warn(
          { data },
          'Invalid register_group request - missing required fields',
        );
      }
      break;

    case 'generate_image':
      if (data.prompt && data.chatJid) {
        const { generateImage } = await import('./image-gen.js');
        const targetGroup = Object.entries(registeredGroups).find(
          ([jid]) => jid === data.chatJid,
        )?.[1];

        if (!targetGroup) {
          logger.warn({ chatJid: data.chatJid }, 'Cannot generate image: group not found');
          break;
        }

        const outputDir = path.join(GROUPS_DIR, targetGroup.folder, 'media');
        const result = await generateImage(data.prompt, outputDir);

        if (result.success && result.imagePath) {
          // Send the generated image to Telegram
          await bot.sendPhoto(data.chatJid, result.imagePath, {
            caption: `🎨 Generated: ${data.prompt.slice(0, 100)}`,
          });
          logger.info({ chatJid: data.chatJid, prompt: data.prompt.slice(0, 50) }, 'Image generated and sent');
        } else {
          await sendMessage(data.chatJid, `❌ Image generation failed: ${result.error}`);
        }
      }
      break;

    default:
      logger.warn({ type: data.type }, 'Unknown IPC task type');
  }
}

// ============================================================================
// Telegram Connection
// ============================================================================

async function connectTelegram(): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error('╔══════════════════════════════════════════════════════════════╗');
    console.error('║  FATAL: TELEGRAM_BOT_TOKEN not set                           ║');
    console.error('║  Run: npm run setup:telegram                                 ║');
    console.error('╚══════════════════════════════════════════════════════════════╝');
    process.exit(1);
  }

  bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

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

    // Store message if registered group
    if (registeredGroups[chatId] && content) {
      // Feature #23: Intelligent Classification Tags
      const tags: string[] = [];
      if (content.includes('?')) tags.push('#question');
      if (content.startsWith('/')) tags.push('#command');
      if (content.match(/bug|error|fail|錯誤|失敗/i)) tags.push('#alert');
      if (content.match(/good|great|thanks|讚|謝謝/i)) tags.push('#feedback');

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

    // Process if registered (concurrency handled in container-runner)
    if (registeredGroups[chatId]) {
      try {
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

      // Route callback actions
      const [action, ...params] = data.split(':');
      const { t } = await import('./i18n.js');

      switch (action) {
        case 'confirm':
          await sendMessage(chatId, t().confirmed);
          break;
        case 'cancel':
          await sendMessage(chatId, t().cancelled);
          break;
        case 'retry': {
          const originalMsgId = params[0];

          // Validate originalMsgId is numeric
          if (!/^\d+$/.test(originalMsgId)) {
            await bot.answerCallbackQuery(query.id, { text: 'Invalid message ID' });
            return;
          }

          // Rate limit check
          const { getMessageById, checkRateLimit } = await import('./db.js');
          const rateCheck = checkRateLimit(`retry:${chatId}`, 5, 60000);
          if (!rateCheck.allowed) {
            await bot.answerCallbackQuery(query.id, { text: 'Rate limited. Please wait.' });
            return;
          }

          const originalMsg = getMessageById(chatId, originalMsgId);

          if (originalMsg) {
            // Re-trigger the processing logic
            await sendMessage(chatId, `🔄 ${t().retrying}`);

            // Construct a skeletal Telegram message for processMessage
            const fakeMsg: TelegramBot.Message = {
              message_id: parseInt(originalMsgId),
              chat: { id: parseInt(chatId), type: 'group' },
              date: Math.floor(new Date(originalMsg.timestamp).getTime() / 1000),
              text: originalMsg.content,
              from: { id: parseInt(originalMsg.sender), is_bot: false, first_name: originalMsg.sender_name },
            };

            await processMessage(fakeMsg);
          } else {
            await sendMessage(chatId, `❌ ${t().retrying}失敗：找不到原始訊息`);
          }
          break;
        }
        case 'feedback_menu': {
          const buttons: QuickReplyButton[][] = [
            [
              { text: '👍', callbackData: `feedback:up:${params[0]}` },
              { text: '👎', callbackData: `feedback:down:${params[0]}` }
            ]
          ];
          await sendMessageWithButtons(chatId, '您對這個回覆滿意嗎？', buttons);
          break;
        }
        case 'feedback':
          const rating = params[0];
          logger.info({ chatId, rating }, 'User feedback received');
          await sendMessage(chatId, rating === 'up' ? t().thanksFeedback : t().willImprove);
          break;
        default:
          // Pass through to agent if unknown action
          const group = registeredGroups[chatId];
          if (group) {
            await sendMessage(chatId, `處理中: ${data}...`);
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
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions,
  });
  startIpcWatcher();
  startMediaCleanupScheduler();
  const { startTaskCleanupScheduler } = await import('./task-tracker.js');
  startTaskCleanupScheduler();

  console.log(`\n✓ NanoGemClaw running (trigger: @${ASSISTANT_NAME})`);
  console.log(`  Bot: @${me.username}`);
  console.log(`  Registered groups: ${Object.keys(registeredGroups).length}\n`);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log('Starting NanoGemClaw...');

  // Initialize
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(STORE_DIR, { recursive: true });
  fs.mkdirSync(GROUPS_DIR, { recursive: true });

  initDatabase();

  // Initialize search index (after database init)
  const { initSearchIndex } = await import('./search.js');
  const { getDatabase } = await import('./db.js');
  const dbInstance = getDatabase();
  initSearchIndex(dbInstance);

  await loadState();
  loadMaintenanceState();

  // Load custom personas
  const { loadCustomPersonas } = await import('./personas.js');
  loadCustomPersonas();

  // Start health check server
  const { setHealthCheckDependencies, startHealthCheckServer } = await import('./health-check.js');
  setHealthCheckDependencies({
    getGroupCount: () => Object.keys(registeredGroups).length,
  });
  startHealthCheckServer();

  // Check system dependencies
  const { checkFFmpegAvailability, isSTTAvailable } = await import('./stt.js');
  if (isSTTAvailable()) {
    const hasFFmpeg = await checkFFmpegAvailability();
    if (!hasFFmpeg) {
      console.warn('╔══════════════════════════════════════════════════════════════╗');
      console.warn('║  WARNING: ffmpeg not found on host system                    ║');
      console.warn('║  STT audio conversion may fail.                              ║');
      console.warn('║  Please install: brew install ffmpeg                         ║');
      console.warn('╚══════════════════════════════════════════════════════════════╝');
    }
  }

  // Start Dashboard Server (Phase 2)
  const { startDashboardServer, setGroupsProvider } = await import('./server.js');
  const { getTaskById, getTasksForGroup, getAllTasks, getErrorState, getGroupMessageStats } = await import('./db.js');

  startDashboardServer();

  // Inject data provider
  setGroupsProvider(() => {
    return Object.entries(registeredGroups).map(([chatId, group]) => {
      const tasks = getTasksForGroup(group.folder);
      const activeTasks = tasks.filter(t => t.status === 'active').length;
      const errorState = getErrorState(group.folder);

      let status = 'idle';
      if (errorState && errorState.consecutiveFailures > 0) status = 'error';

      return {
        id: group.folder,
        name: group.name,
        status,
        messageCount: (() => {
          return chatId ? (getGroupMessageStats(chatId)?.message_count || 0) : 0;
        })(),
        activeTasks,
        // Extended fields
        persona: group.persona,
        requireTrigger: group.requireTrigger,
        enableWebSearch: group.enableWebSearch,
        folder: group.folder,
      };
    });
  });

  // Inject group registrar
  setGroupRegistrar((chatId: string, name: string) => {
    const folder = name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    registerGroup(chatId, {
      name,
      folder,
      trigger: `@${ASSISTANT_NAME}`,
      added_at: new Date().toISOString(),
    });
    return { chatId, name, folder };
  });

  // Inject group updater for dashboard settings API
  const { setGroupUpdater } = await import('./server.js');
  setGroupUpdater((folder: string, updates: Record<string, any>) => {
    // Find chatId by folder
    const entry = Object.entries(registeredGroups).find(([, g]) => g.folder === folder);
    if (!entry) return null;

    const [chatId, group] = entry;

    // Apply updates
    if (updates.persona !== undefined) group.persona = updates.persona;
    if (updates.enableWebSearch !== undefined) group.enableWebSearch = updates.enableWebSearch;
    if (updates.requireTrigger !== undefined) group.requireTrigger = updates.requireTrigger;
    if (updates.name !== undefined) group.name = updates.name;

    // Save
    registeredGroups[chatId] = group;
    saveJson(path.join(DATA_DIR, 'registered_groups.json'), registeredGroups);

    return group;
  });

  // Inject chat JID resolver for export API
  const { setChatJidResolver } = await import('./server.js');
  setChatJidResolver((folder: string) => {
    const entry = Object.entries(registeredGroups).find(([, g]) => g.folder === folder);
    return entry ? entry[0] : null;
  });

  // Start automatic database backup
  const { startBackupSchedule } = await import('./backup.js');
  startBackupSchedule();

  // Connect to Telegram
  await connectTelegram();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

// Graceful shutdown handlers
process.on('SIGINT', async () => {
  console.log('\nShutting down gracefully...');
  try {
    const { stopHealthCheckServer } = await import('./health-check.js');
    await stopHealthCheckServer();
    await bot?.stopPolling();
    const { stopBackupSchedule } = await import('./backup.js');
    stopBackupSchedule();
    saveState();
    closeDatabase();
    console.log('State saved & database closed. Goodbye!');
  } catch (err) {
    console.error('Error during shutdown:', err);
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down...');
  try {
    const { stopHealthCheckServer } = await import('./health-check.js');
    await stopHealthCheckServer();
    await bot?.stopPolling();
    const { stopBackupSchedule } = await import('./backup.js');
    stopBackupSchedule();
    saveState();
    closeDatabase();
  } catch (err) {
    console.error('Error during shutdown:', err);
  }
  process.exit(0);
});
