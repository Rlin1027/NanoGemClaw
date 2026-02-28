/**
 * Gemini Function Calling Tools
 *
 * Converts existing IPC handlers into Gemini function declarations.
 * This enables the model to directly call backend functions (schedule tasks,
 * generate images, etc.) without file-based IPC polling.
 *
 * Each function declaration maps to an existing IPC handler, maintaining
 * the same permission model and validation logic.
 */

import type { IpcContext, ToolMetadata } from './types.js';
import { logger } from './logger.js';

// ============================================================================
// Tool Metadata Registry
// ============================================================================

/** Metadata registry for all built-in tools */
const toolMetadataRegistry = new Map<string, ToolMetadata>();

/** Plugin tool metadata registry (populated by plugin-loader) */
const pluginToolMetadataRegistry = new Map<string, ToolMetadata>();

/**
 * Get metadata for a tool by name.
 * Checks built-in tools first, then plugin tools.
 * Returns undefined for unknown tools.
 */
export function getToolMetadata(name: string): ToolMetadata | undefined {
  return toolMetadataRegistry.get(name) ?? pluginToolMetadataRegistry.get(name);
}

/**
 * Register metadata for a plugin tool.
 * Called by plugin-loader during plugin initialization.
 */
export function registerPluginToolMetadata(name: string, metadata: ToolMetadata): void {
  pluginToolMetadataRegistry.set(name, metadata);
}

/**
 * Clear cached declarations (needed when plugin tools change the registry).
 */
export function clearDeclarationCache(): void {
  cachedMainDeclarations = null;
  cachedNonMainDeclarations = null;
}

// ============================================================================
// Function Declarations for Gemini
// ============================================================================

// Cached declarations (static, built once per permission level)
let cachedMainDeclarations: any[] | null = null;
let cachedNonMainDeclarations: any[] | null = null;

/**
 * Build the function declarations array based on group permissions.
 * Main groups get access to all functions; other groups get a subset.
 * Results are cached since declarations are static.
 */
export function buildFunctionDeclarations(isMain: boolean): any[] {
  if (isMain && cachedMainDeclarations) return cachedMainDeclarations;
  if (!isMain && cachedNonMainDeclarations) return cachedNonMainDeclarations;

  const declarations: any[] = [
    {
      name: 'schedule_task',
      description:
        'Schedule a recurring, interval-based, or one-time task for the group. ' +
        'ONLY call this when the user EXPLICITLY asks to schedule, set up, or create a recurring/timed task in their CURRENT message.',
      parameters: {
        type: 'OBJECT',
        properties: {
          prompt: {
            type: 'STRING',
            description: 'The task prompt/instruction to execute on schedule',
          },
          schedule_type: {
            type: 'STRING',
            description:
              'Type of schedule: "cron" for cron expressions, "interval" for millisecond intervals, "once" for one-time execution',
            enum: ['cron', 'interval', 'once'],
          },
          schedule_value: {
            type: 'STRING',
            description:
              'Schedule value: cron expression (e.g. "0 9 * * *" for daily 9am), interval in ms (e.g. "3600000" for hourly), or ISO timestamp for once',
          },
          context_mode: {
            type: 'STRING',
            description:
              'Context mode: "group" to include group conversation context, "isolated" for independent execution',
            enum: ['group', 'isolated'],
          },
        },
        required: ['prompt', 'schedule_type', 'schedule_value'],
      },
      _metadata: { readOnly: false, requiresExplicitIntent: true, dangerLevel: 'moderate' } as ToolMetadata,
    },
    {
      name: 'pause_task',
      description:
        'Pause an active scheduled task by its ID. ' +
        'You MUST call list_tasks first to get the correct task ID. ' +
        'ONLY call this when the user EXPLICITLY asks to pause a specific task in their CURRENT message.',
      parameters: {
        type: 'OBJECT',
        properties: {
          task_id: {
            type: 'STRING',
            description: 'The ID of the task to pause',
          },
        },
        required: ['task_id'],
      },
      _metadata: { readOnly: false, requiresExplicitIntent: true, dangerLevel: 'moderate' } as ToolMetadata,
    },
    {
      name: 'resume_task',
      description:
        'Resume a paused scheduled task by its ID. ' +
        'You MUST call list_tasks first to get the correct task ID. ' +
        'ONLY call this when the user EXPLICITLY asks to resume a specific task in their CURRENT message.',
      parameters: {
        type: 'OBJECT',
        properties: {
          task_id: {
            type: 'STRING',
            description: 'The ID of the task to resume',
          },
        },
        required: ['task_id'],
      },
      _metadata: { readOnly: false, requiresExplicitIntent: true, dangerLevel: 'moderate' } as ToolMetadata,
    },
    {
      name: 'list_tasks',
      description:
        'List all scheduled tasks for this group. Call this FIRST before pause_task, resume_task, or cancel_task to get the correct task ID. ' +
        'Returns task IDs, prompts, schedules, and statuses.',
      parameters: {
        type: 'OBJECT',
        properties: {},
      },
      _metadata: { readOnly: true, requiresExplicitIntent: false, dangerLevel: 'safe' } as ToolMetadata,
    },
    {
      name: 'cancel_task',
      description:
        'Cancel and delete a scheduled task by its ID. ' +
        'You MUST call list_tasks first to get the correct task ID. ' +
        'ONLY call this when the user EXPLICITLY asks to cancel or delete a specific task in their CURRENT message.',
      parameters: {
        type: 'OBJECT',
        properties: {
          task_id: {
            type: 'STRING',
            description: 'The ID of the task to cancel',
          },
        },
        required: ['task_id'],
      },
      _metadata: { readOnly: false, requiresExplicitIntent: true, dangerLevel: 'destructive' } as ToolMetadata,
    },
    {
      name: 'generate_image',
      description:
        'Generate an image based on a text description. ' +
        'ONLY call this when the user EXPLICITLY asks to create, draw, or generate an image in their CURRENT message. ' +
        'Do NOT call this based on previous conversation history or when the user is asking a text question.',
      parameters: {
        type: 'OBJECT',
        properties: {
          prompt: {
            type: 'STRING',
            description: 'A detailed description of the image to generate',
          },
        },
        required: ['prompt'],
      },
      _metadata: { readOnly: false, requiresExplicitIntent: true, dangerLevel: 'moderate' } as ToolMetadata,
    },
    {
      name: 'set_preference',
      description:
        'Store a user preference for the group. Allowed keys: language, nickname, response_style, interests, timezone, custom_instructions. ' +
        'ONLY call this when the user EXPLICITLY asks to change a setting or preference in their CURRENT message. ' +
        'Do NOT infer preferences from conversation context or history.',
      parameters: {
        type: 'OBJECT',
        properties: {
          key: {
            type: 'STRING',
            description: 'Preference key',
            enum: [
              'language',
              'nickname',
              'response_style',
              'interests',
              'timezone',
              'custom_instructions',
            ],
          },
          value: {
            type: 'STRING',
            description: 'Preference value',
          },
        },
        required: ['key', 'value'],
      },
      _metadata: { readOnly: false, requiresExplicitIntent: true, dangerLevel: 'moderate' } as ToolMetadata,
    },
    {
      name: 'remember_fact',
      description:
        'Store a fact about the user or group for future reference. Use this to remember important information ' +
        'the user shares, such as their name, preferences, pets, location, birthday, etc. ' +
        'The fact will be available in future conversations.',
      parameters: {
        type: 'OBJECT',
        properties: {
          key: {
            type: 'STRING',
            description:
              'A short descriptive key for the fact (e.g. "user_name", "pet_name", "favorite_food", "birthday", "location")',
          },
          value: {
            type: 'STRING',
            description: 'The fact value to remember',
          },
        },
        required: ['key', 'value'],
      },
      _metadata: { readOnly: true, requiresExplicitIntent: false, dangerLevel: 'safe' } as ToolMetadata,
    },
  ];

  // Main-only functions
  if (isMain) {
    declarations.push({
      name: 'register_group',
      description:
        'Register a new Telegram group/chat for the assistant. Only available to the main group. ' +
        'ONLY call this when the user EXPLICITLY asks to register a new group in their CURRENT message.',
      parameters: {
        type: 'OBJECT',
        properties: {
          chat_id: {
            type: 'STRING',
            description: 'Telegram chat ID to register',
          },
          name: {
            type: 'STRING',
            description: 'Display name for the group',
          },
        },
        required: ['chat_id', 'name'],
      },
      _metadata: { readOnly: false, requiresExplicitIntent: true, dangerLevel: 'moderate' } as ToolMetadata,
    });
  }

  // Register all metadata into the registry (strip _metadata before sending to Gemini)
  for (const decl of declarations) {
    if (decl._metadata) {
      toolMetadataRegistry.set(decl.name, decl._metadata);
    }
  }

  // Strip _metadata from declarations (Gemini API doesn't understand it)
  const cleanDeclarations = declarations.map(({ _metadata, ...rest }) => rest);

  // Cache for reuse
  if (isMain) {
    cachedMainDeclarations = cleanDeclarations;
  } else {
    cachedNonMainDeclarations = cleanDeclarations;
  }

  return cleanDeclarations;
}

// ============================================================================
// Function Call Execution
// ============================================================================

export interface FunctionCallResult {
  name: string;
  response: Record<string, any>;
}

/**
 * Execute a function call from Gemini and return the result.
 * Routes to existing IPC handler logic for consistency.
 */
export async function executeFunctionCall(
  name: string,
  args: Record<string, any>,
  context: IpcContext,
  groupFolder: string,
  chatJid: string,
): Promise<FunctionCallResult> {
  logger.info(
    { functionName: name, groupFolder },
    'Executing Gemini function call',
  );

  try {
    switch (name) {
      case 'schedule_task': {
        const { createTask } = await import('./db.js');
        const { TIMEZONE } = await import('./config.js');

        const scheduleType = args.schedule_type as 'cron' | 'interval' | 'once';
        let nextRun: string | null = null;

        if (scheduleType === 'cron') {
          const { CronExpressionParser } = await import('cron-parser');
          const interval = CronExpressionParser.parse(args.schedule_value, {
            tz: TIMEZONE,
          });
          nextRun = interval.next().toISOString();
        } else if (scheduleType === 'interval') {
          const ms = parseInt(args.schedule_value, 10);
          if (isNaN(ms) || ms <= 0) {
            return {
              name,
              response: { success: false, error: 'Invalid interval value' },
            };
          }
          nextRun = new Date(Date.now() + ms).toISOString();
        } else if (scheduleType === 'once') {
          const scheduled = new Date(args.schedule_value);
          if (isNaN(scheduled.getTime())) {
            return {
              name,
              response: { success: false, error: 'Invalid timestamp' },
            };
          }
          nextRun = scheduled.toISOString();
        }

        const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        createTask({
          id: taskId,
          group_folder: groupFolder,
          chat_jid: chatJid,
          prompt: args.prompt,
          schedule_type: scheduleType,
          schedule_value: args.schedule_value,
          context_mode: args.context_mode || 'isolated',
          next_run: nextRun,
          status: 'active',
          created_at: new Date().toISOString(),
        });

        return {
          name,
          response: { success: true, task_id: taskId, next_run: nextRun },
        };
      }

      case 'list_tasks': {
        const { getTasksForGroup } = await import('./db.js');
        const tasks = getTasksForGroup(groupFolder);
        return {
          name,
          response: {
            success: true,
            tasks: tasks.map(t => ({
              id: t.id,
              prompt: t.prompt.slice(0, 100),
              schedule_type: t.schedule_type,
              schedule_value: t.schedule_value,
              status: t.status,
              next_run: t.next_run,
            })),
          },
        };
      }

      case 'pause_task': {
        const { updateTask: pauseUpdate, getTaskById: pauseLookup } = await import('./db.js');
        const pauseTarget = pauseLookup(args.task_id);
        if (!pauseTarget) {
          return {
            name,
            response: { success: false, error: `Task not found: ${args.task_id}. Use list_tasks to get valid task IDs.` },
          };
        }
        if (pauseTarget.status !== 'active') {
          return {
            name,
            response: { success: false, error: `Task is not active (current status: ${pauseTarget.status}). Only active tasks can be paused.` },
          };
        }
        pauseUpdate(args.task_id, { status: 'paused' });
        return {
          name,
          response: { success: true, task_id: args.task_id, status: 'paused' },
        };
      }

      case 'resume_task': {
        const { updateTask: resumeUpdate, getTaskById: resumeLookup } = await import('./db.js');
        const resumeTarget = resumeLookup(args.task_id);
        if (!resumeTarget) {
          return {
            name,
            response: { success: false, error: `Task not found: ${args.task_id}. Use list_tasks to get valid task IDs.` },
          };
        }
        if (resumeTarget.status !== 'paused') {
          return {
            name,
            response: { success: false, error: `Task is not paused (current status: ${resumeTarget.status}). Only paused tasks can be resumed.` },
          };
        }
        resumeUpdate(args.task_id, { status: 'active' });
        return {
          name,
          response: { success: true, task_id: args.task_id, status: 'active' },
        };
      }

      case 'cancel_task': {
        const { deleteTask, getTaskById } = await import('./db.js');
        const task = getTaskById(args.task_id);
        if (!task) {
          return {
            name,
            response: { success: false, error: `Task not found: ${args.task_id}. Use list_tasks to get valid task IDs.` },
          };
        }
        deleteTask(args.task_id);
        return {
          name,
          response: { success: true, task_id: args.task_id, deleted: true },
        };
      }

      case 'generate_image': {
        const { generateImage } = await import('./image-gen.js');
        const { GROUPS_DIR } = await import('./config.js');
        const path = await import('path');
        const outputDir = path.join(GROUPS_DIR, groupFolder, 'media');
        const result = await generateImage(args.prompt, outputDir);

        if (result.success && result.imagePath && context.bot) {
          await context.bot.sendPhoto(chatJid, result.imagePath, {
            caption: `🎨 Generated: ${args.prompt.slice(0, 100)}`,
          });
          return { name, response: { success: true, sent: true } };
        }

        return {
          name,
          response: {
            success: result.success,
            error: result.error || 'No bot instance available',
          },
        };
      }

      case 'set_preference': {
        const ALLOWED_KEYS = [
          'language',
          'nickname',
          'response_style',
          'interests',
          'timezone',
          'custom_instructions',
        ];
        if (!ALLOWED_KEYS.includes(args.key)) {
          return {
            name,
            response: { success: false, error: `Invalid key: ${args.key}` },
          };
        }

        const { setPreference } = await import('./db.js');
        setPreference(groupFolder, args.key, String(args.value));
        return { name, response: { success: true, key: args.key } };
      }

      case 'remember_fact': {
        const { upsertFact } = await import('./db.js');
        const factKey = String(args.key).slice(0, 50).replace(/[^\w_-]/g, '_');
        const factValue = String(args.value).slice(0, 500);
        upsertFact(groupFolder, factKey, factValue, 'user_set', 1.0);
        return {
          name,
          response: { success: true, key: factKey, remembered: true },
        };
      }

      case 'register_group': {
        if (!context.isMain) {
          return {
            name,
            response: { success: false, error: 'Permission denied' },
          };
        }
        if (context.registerGroup) {
          context.registerGroup(args.chat_id, {
            name: args.name,
            folder: args.name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase(),
            trigger: `@${process.env.ASSISTANT_NAME || 'Andy'}`,
            added_at: new Date().toISOString(),
          });
          return { name, response: { success: true, chat_id: args.chat_id } };
        }
        return {
          name,
          response: { success: false, error: 'Registrar not available' },
        };
      }

      default:
        return {
          name,
          response: { success: false, error: `Unknown function: ${name}. This function is not available. Respond with text directly.` },
        };
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      { functionName: name, err: errorMsg },
      'Function call execution error',
    );
    return {
      name,
      response: { success: false, error: 'Function execution failed' },
    };
  }
}
