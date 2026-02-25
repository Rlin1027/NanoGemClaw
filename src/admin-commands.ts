/**
 * Admin Commands - Admin command handlers and dispatcher for main group.
 */
import path from 'path';
import fs from 'fs';

import { DATA_DIR, MAIN_GROUP_FOLDER } from './config.js';
import { getAllTasks } from './db.js';
import type { ConversationExport } from './db/messages.js';
import { logger } from './logger.js';
import { getBot, getRegisteredGroups } from './state.js';
import { saveState } from './group-manager.js';
import { RegisteredGroup } from './types.js';
import { formatError, saveJson } from './utils.js';

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
    getUsageStats: () => {
      total_requests: number;
      avg_duration_ms: number;
      total_prompt_tokens: number;
      total_response_tokens: number;
    };
    getAllErrorStates: () => Array<{
      group: string;
      state: { consecutiveFailures: number; lastError: string | null };
    }>;
    getConversationExport: (chatId: string) => ConversationExport;
    formatExportAsMarkdown: (exportData: ConversationExport) => string;
  };
  i18n: {
    tf: (key: string, params?: Record<string, string | number>) => string;
    setLanguage: (lang: import('./i18n/index.js').Language) => void;
    availableLanguages: string[];
    getLanguage: () => string;
  };
  personas: {
    getAllPersonas: () => Record<string, { name: string; description: string }>;
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
    return `${ctx.i18n.tf('availablePersonasTitle')}\n\n${Object.entries(
      allPersonas,
    )
      .map(
        ([key, p]: [string, { name: string; description: string }]) =>
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
      return ctx.i18n.tf('groupNotFound', { group: targetGroup });
    }

    const allPersonas = ctx.personas.getAllPersonas();
    if (!allPersonas[key]) {
      return ctx.i18n.tf('invalidPersonaKey', { key });
    }

    ctx.registeredGroups[targetId].persona = key;
    saveState();
    return ctx.i18n.tf('personaSet', {
      group: ctx.registeredGroups[targetId].name,
      persona: allPersonas[key].name,
    });
  }

  return ctx.i18n.tf('personaUsage');
}

async function handleTriggerCommand(
  args: string[],
  ctx: AdminCommandContext,
): Promise<string> {
  const targetGroup = args[0];
  const mode = args[1]?.toLowerCase();

  if (!targetGroup || !mode || !['on', 'off'].includes(mode)) {
    return ctx.i18n.tf('triggerUsage');
  }

  let targetId: string | undefined;
  for (const [id, g] of Object.entries(ctx.registeredGroups)) {
    if (g.folder === targetGroup || g.name === targetGroup) {
      targetId = id;
      break;
    }
  }

  if (!targetId) {
    return ctx.i18n.tf('groupNotFound', { group: targetGroup });
  }

  ctx.registeredGroups[targetId].requireTrigger = mode === 'on';
  saveJson(path.join(DATA_DIR, 'registered_groups.json'), ctx.registeredGroups);
  const status =
    mode === 'on'
      ? ctx.i18n.tf('triggerModeRequired')
      : ctx.i18n.tf('triggerModeAll');
  return ctx.i18n.tf('triggerModeSet', {
    group: ctx.registeredGroups[targetId].name,
    mode,
    status,
  });
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

  return `${ctx.i18n.tf('statsTitle')}

• ${ctx.i18n.tf('registeredGroups')}: ${groupCount}
• ${ctx.i18n.tf('uptime')}: ${uptimeHours}h ${uptimeMinutes}m
• ${ctx.i18n.tf('memory')}: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB

${ctx.i18n.tf('usageAnalytics')}
• ${ctx.i18n.tf('totalRequests')}: ${usage.total_requests}
• ${ctx.i18n.tf('avgResponseTime')}: ${avgDuration}s
• ${ctx.i18n.tf('totalTokens')}: ${usage.total_prompt_tokens + usage.total_response_tokens}`;
}

async function handleGroupsCommand(
  args: string[],
  ctx: AdminCommandContext,
): Promise<string> {
  const groups = Object.values(ctx.registeredGroups);
  if (groups.length === 0) {
    return ctx.i18n.tf('noGroupsRegistered');
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

  return `📁 **${ctx.i18n.tf('registeredGroups')}** (${groups.length})

${groupList}

${ctx.i18n.tf('groupsLegend')}`;
}

async function handleTasksCommand(
  args: string[],
  ctx: AdminCommandContext,
): Promise<string> {
  const tasks = ctx.db.getAllTasks();
  if (tasks.length === 0) {
    return ctx.i18n.tf('noScheduledTasks');
  }

  const taskList = tasks
    .slice(0, 10)
    .map(
      (
        t: {
          status: string;
          group_folder: string;
          prompt: string;
          schedule_type: string;
          schedule_value: string;
          next_run: string | null;
        },
        i: number,
      ) => {
        const status =
          t.status === 'active' ? '✅' : t.status === 'paused' ? '⏸️' : '✓';
        const nextRun = t.next_run
          ? new Date(t.next_run).toLocaleString()
          : 'N/A';
        return `${i + 1}. ${status} **${t.group_folder}**
   📋 ${t.prompt.slice(0, 50)}${t.prompt.length > 50 ? '...' : ''}
   ⏰ ${t.schedule_type}: ${t.schedule_value} | Next: ${nextRun}`;
      },
    )
    .join('\n');

  const moreText =
    tasks.length > 10 ? `\n\n_...and ${tasks.length - 10} more tasks_` : '';

  return `${ctx.i18n.tf('scheduledTasksTitle', { count: tasks.length })}

${taskList}${moreText}`;
}

async function handleErrorsCommand(
  args: string[],
  ctx: AdminCommandContext,
): Promise<string> {
  const errorStates = ctx.db.getAllErrorStates();

  if (errorStates.length === 0) {
    return ctx.i18n.tf('noErrors');
  }

  const errorList = errorStates
    .filter(
      (e: {
        group: string;
        state: { consecutiveFailures: number; lastError: string | null };
      }) => e.state.consecutiveFailures > 0,
    )
    .map(
      (e: {
        group: string;
        state: { consecutiveFailures: number; lastError: string | null };
      }) => {
        const group =
          ctx.registeredGroups[
            Object.keys(ctx.registeredGroups).find(
              (k) => ctx.registeredGroups[k].folder === e.group,
            ) || ''
          ];
        return `• **${group?.name || e.group}**: ${e.state.consecutiveFailures} failures\n  Last: ${e.state.lastError?.slice(0, 80)}...`;
      },
    )
    .join('\n');

  return errorList
    ? `${ctx.i18n.tf('groupsWithErrors')}\n\n${errorList}`
    : ctx.i18n.tf('noActiveErrors');
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
    return ctx.i18n.tf('exportUsage');
  }

  let targetChatId: string | undefined;
  for (const [id, g] of Object.entries(ctx.registeredGroups)) {
    if (g.folder === targetFolder || g.name === targetFolder) {
      targetChatId = id;
      break;
    }
  }

  if (!targetChatId) {
    return ctx.i18n.tf('groupNotFound', { group: targetFolder });
  }

  const exportData = ctx.db.getConversationExport(targetChatId);

  if (exportData.messageCount === 0) {
    return ctx.i18n.tf('noMessagesFound', { folder: targetFolder });
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
    } catch (err) {
      logger.debug({ err }, 'Export temp file cleanup failed');
    }
  }

  return ctx.i18n.tf('exportSuccess', {
    count: exportData.messageCount,
    folder: targetFolder,
  });
}

async function handleLanguageCommand(
  args: string[],
  ctx: AdminCommandContext,
): Promise<string> {
  type Language = import('./i18n/index.js').Language;
  const lang = args[0] as Language;
  if (ctx.i18n.availableLanguages.includes(lang)) {
    ctx.i18n.setLanguage(lang);
    saveState();
    return ctx.i18n.tf('languageSwitched', { lang });
  }
  return ctx.i18n.tf('invalidLanguage', {
    available: ctx.i18n.availableLanguages.join(', '),
    current: ctx.i18n.getLanguage(),
  });
}

async function handleHelpCommand(
  args: string[],
  ctx: AdminCommandContext,
): Promise<string> {
  const commandList = Object.entries(ADMIN_COMMANDS)
    .map(([cmd, desc]) => `• \`/admin ${cmd}\` - ${desc}`)
    .join('\n');

  return `${ctx.i18n.tf('adminCommandsTitle')}

${commandList}

${ctx.i18n.tf('adminOnlyNote')}`;
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
export async function handleAdminCommand(
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
  const { tf, setLanguage, availableLanguages, getLanguage } =
    await import('./i18n/index.js');
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
      tf,
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
