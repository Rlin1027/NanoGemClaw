/**
 * Admin Context Builder
 *
 * Builds dynamic system prompts for the admin private chat.
 * Rebuilt per-message with live stats — NOT cacheable.
 */
import { ASSISTANT_NAME } from './config.js';
import {
  getActiveTaskCountsBatch,
  getAllTasks,
  getMessageCountsBatch,
} from './db.js';
import { getFacts } from './db/facts.js';
import { getPreferences } from './db/preferences.js';
import { getRegisteredGroups } from './state.js';
import { readGroupGeminiMd } from './group-manager.js';
import { isAdminGroup } from './admin-auth.js';

/**
 * Build a dynamic system prompt for the admin private chat.
 * Includes live data: all groups, tasks, stats, and errors.
 */
export function buildAdminSystemPrompt(): string {
  const registeredGroups = getRegisteredGroups();
  const taskCounts = getActiveTaskCountsBatch();
  const messageCounts = getMessageCountsBatch();
  const allTasks = getAllTasks();

  // Build group summary
  const groupEntries = Object.entries(registeredGroups)
    .filter(([, g]) => !isAdminGroup(g.folder))
    .map(([chatId, g]) => {
      const msgCount = messageCounts.get(chatId) || 0;
      const taskCount = taskCounts.get(g.folder) || 0;
      return `- **${g.name}** (folder: \`${g.folder}\`): ${msgCount} msgs, ${taskCount} active tasks, persona: ${g.persona || 'default'}, trigger: ${g.requireTrigger !== false ? 'required' : 'always respond'}, model: ${g.geminiModel || 'auto'}`;
    });

  // Build task summary
  const activeTasks = allTasks.filter(
    (t) => t.status === 'active' || t.status === 'paused',
  );
  const taskSummary =
    activeTasks.length > 0
      ? activeTasks
          .slice(0, 20)
          .map(
            (t) =>
              `- [${t.status}] **${t.group_folder}**: "${t.prompt.slice(0, 80)}" (${t.schedule_type}: ${t.schedule_value}, next: ${t.next_run || 'N/A'})`,
          )
          .join('\n')
      : 'No active tasks.';

  return `You are ${ASSISTANT_NAME}, a global admin assistant for the NanoGemClaw Telegram bot system.
You are in a PRIVATE CHAT with the bot owner/admin. You have full access to manage all groups.

## Your Capabilities
- View and manage all registered groups
- Read and write group system prompts (GEMINI.md)
- View, pause, resume, and cancel tasks across all groups
- Update group settings (persona, trigger, model, web search)
- Send messages to any group
- View system statistics and health

## Current System State

### Registered Groups (${groupEntries.length})
${groupEntries.length > 0 ? groupEntries.join('\n') : 'No groups registered.'}

### Active/Paused Tasks (${activeTasks.length})
${taskSummary}

### System Info
- Uptime: ${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m
- Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB

## Instructions
- Respond in the same language the admin uses.
- Use your tools (function calling) to perform actions when the admin asks.
- For read operations, use tools to fetch live data rather than relying on the snapshot above.
- Be concise and actionable.
- When modifying settings, confirm the change after executing.
- The admin may use natural language OR /admin commands — handle both.`;
}

/**
 * Get detailed context for a specific group (deep query).
 */
export function getGroupDetailContext(folder: string): string {
  const registeredGroups = getRegisteredGroups();
  const entry = Object.entries(registeredGroups).find(
    ([, g]) => g.folder === folder,
  );
  if (!entry) return `Group "${folder}" not found.`;

  const [chatId, group] = entry;
  const parts: string[] = [`## Group: ${group.name} (${folder})`];
  parts.push(`- Chat ID: ${chatId}`);
  parts.push(`- Persona: ${group.persona || 'default'}`);
  parts.push(
    `- Trigger: ${group.requireTrigger !== false ? 'required' : 'always respond'}`,
  );
  parts.push(
    `- Web Search: ${group.enableWebSearch !== false ? 'enabled' : 'disabled'}`,
  );
  parts.push(
    `- Fast Path: ${group.enableFastPath !== false ? 'enabled' : 'disabled'}`,
  );
  parts.push(`- Model: ${group.geminiModel || 'auto'}`);

  // GEMINI.md content
  const geminiMd = readGroupGeminiMd(folder);
  if (geminiMd) {
    parts.push(`\n### GEMINI.md\n\`\`\`\n${geminiMd.slice(0, 2000)}\n\`\`\``);
  }

  // Preferences
  try {
    const prefs = getPreferences(folder);
    const prefKeys = Object.keys(prefs);
    if (prefKeys.length > 0) {
      parts.push(`\n### Preferences`);
      for (const key of prefKeys) {
        parts.push(`- ${key}: ${prefs[key]}`);
      }
    }
  } catch {
    // Preferences may not exist
  }

  // Facts
  try {
    const facts = getFacts(folder);
    if (facts.length > 0) {
      parts.push(`\n### Known Facts`);
      for (const f of facts) {
        parts.push(`- ${f.key}: ${f.value}`);
      }
    }
  } catch {
    // Facts may not exist
  }

  return parts.join('\n');
}
