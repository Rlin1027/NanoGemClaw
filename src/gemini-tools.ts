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
import type { ToolResponse } from '@nanogemclaw/core';
import { logger } from './logger.js';
import { resolvePreferredPath } from './fast-path.js';
import { SAFE_FOLDER_RE } from '@nanogemclaw/core';
import { validateToolInput } from './zod-tools.js';
import type { ParseableSchema } from './zod-tools.js';

// TODO: consolidate FunctionCallResult types across packages/gemini and src/gemini-tools.ts

// ============================================================================
// Input Validation Helpers
// ============================================================================

function validateGroupFolder(
  name: string,
  folder: string,
): { name: string; response: { success: boolean; error: string } } | null {
  if (!SAFE_FOLDER_RE.test(folder)) {
    return {
      name,
      response: { success: false, error: 'Invalid group folder name' },
    };
  }
  return null;
}

function wrapToolResponse(
  success: boolean,
  dataOrError: Record<string, unknown> | string,
): ToolResponse {
  if (!success) {
    return {
      success: false,
      error:
        typeof dataOrError === 'string' ? dataOrError : String(dataOrError),
    };
  }
  if (typeof dataOrError === 'string') {
    return { success: true, data: { message: dataOrError } };
  }
  return { success: true, data: dataOrError };
}

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
export function registerPluginToolMetadata(
  name: string,
  metadata: ToolMetadata,
): void {
  pluginToolMetadataRegistry.set(name, metadata);
}

/**
 * Clear cached declarations (needed when plugin tools change the registry).
 */
export function clearDeclarationCache(): void {
  cachedMainDeclarations = null;
  cachedNonMainDeclarations = null;
  cachedAdminDeclarations = null;
}

// ============================================================================
// Input Schema Registry
// ============================================================================

/** Registry mapping tool names to their input schemas for validation */
const inputSchemaRegistry = new Map<string, ParseableSchema>();

/** Register an input schema for a tool. Called during plugin tool registration. */
export function registerInputSchema(
  toolName: string,
  schema: ParseableSchema,
): void {
  inputSchemaRegistry.set(toolName, schema);
}

/** Clear all registered input schemas. Called alongside clearDeclarationCache(). */
export function clearInputSchemaRegistry(): void {
  inputSchemaRegistry.clear();
}

/** Plugin tool declarations injected after plugin init */
let pluginToolDeclarations: any[] = [];

/** Inject plugin Gemini tool declarations (called from index.ts after initPlugins) */
export function registerPluginTools(tools: any[]): void {
  pluginToolDeclarations = tools;
  clearDeclarationCache();
}

// ============================================================================
// Function Declarations for Gemini
// ============================================================================

// Cached declarations (static, built once per permission level)
let cachedMainDeclarations: any[] | null = null;
let cachedNonMainDeclarations: any[] | null = null;
let cachedAdminDeclarations: any[] | null = null;

/**
 * Build the function declarations array based on group permissions.
 * Three tiers: non-main (basic), main (+ register_group), admin (global admin tools).
 * Results are cached since declarations are static.
 */
export function buildFunctionDeclarations(
  isMain: boolean,
  isAdmin?: boolean,
): any[] {
  if (isAdmin && cachedAdminDeclarations) return cachedAdminDeclarations;
  if (isMain && !isAdmin && cachedMainDeclarations)
    return cachedMainDeclarations;
  if (!isMain && !isAdmin && cachedNonMainDeclarations)
    return cachedNonMainDeclarations;

  // ========================================================================
  // Admin-only declarations (completely separate tool set)
  // ========================================================================
  if (isAdmin) {
    const adminDeclarations: any[] = [
      {
        name: 'list_all_groups',
        description:
          'List all registered groups with their stats, settings, and chat IDs.',
        parameters: { type: 'OBJECT', properties: {} },
        _metadata: {
          readOnly: true,
          requiresExplicitIntent: false,
          dangerLevel: 'safe',
        } as ToolMetadata,
      },
      {
        name: 'get_group_detail',
        description:
          'Get detailed info for a specific group including GEMINI.md, preferences, and facts.',
        parameters: {
          type: 'OBJECT',
          properties: {
            group_folder: {
              type: 'STRING',
              description: 'The group folder name (e.g. "main", "family-chat")',
            },
          },
          required: ['group_folder'],
        },
        _metadata: {
          readOnly: true,
          requiresExplicitIntent: false,
          dangerLevel: 'safe',
        } as ToolMetadata,
      },
      {
        name: 'update_group_settings',
        description:
          'Update settings for a group. Supported fields: persona, requireTrigger (boolean), enableWebSearch (boolean), preferredPath (\'fast\' | \'container\'), geminiModel (string), name (string).',
        parameters: {
          type: 'OBJECT',
          properties: {
            group_folder: {
              type: 'STRING',
              description: 'The group folder name',
            },
            settings: {
              type: 'STRING',
              description:
                'JSON string of settings to update, e.g. {"persona":"coder","requireTrigger":false}',
            },
          },
          required: ['group_folder', 'settings'],
        },
        _metadata: {
          readOnly: false,
          requiresExplicitIntent: true,
          dangerLevel: 'moderate',
        } as ToolMetadata,
      },
      {
        name: 'read_group_prompt',
        description: 'Read the GEMINI.md system prompt file for a group.',
        parameters: {
          type: 'OBJECT',
          properties: {
            group_folder: {
              type: 'STRING',
              description: 'The group folder name',
            },
          },
          required: ['group_folder'],
        },
        _metadata: {
          readOnly: true,
          requiresExplicitIntent: false,
          dangerLevel: 'safe',
        } as ToolMetadata,
      },
      {
        name: 'write_group_prompt',
        description:
          'Write/replace the GEMINI.md system prompt file for a group. This is destructive — the entire file will be replaced.',
        parameters: {
          type: 'OBJECT',
          properties: {
            group_folder: {
              type: 'STRING',
              description: 'The group folder name',
            },
            content: {
              type: 'STRING',
              description: 'The new GEMINI.md content',
            },
          },
          required: ['group_folder', 'content'],
        },
        _metadata: {
          readOnly: false,
          requiresExplicitIntent: true,
          dangerLevel: 'destructive',
        } as ToolMetadata,
      },
      {
        name: 'list_all_tasks',
        description:
          'List all scheduled tasks across all groups, with group folder, status, schedule, and next run time.',
        parameters: { type: 'OBJECT', properties: {} },
        _metadata: {
          readOnly: true,
          requiresExplicitIntent: false,
          dangerLevel: 'safe',
        } as ToolMetadata,
      },
      {
        name: 'manage_cross_group_task',
        description:
          'Pause, resume, or cancel a scheduled task by ID. Works across all groups. ' +
          'ONLY call this when the admin EXPLICITLY asks to pause/resume/cancel a task.',
        parameters: {
          type: 'OBJECT',
          properties: {
            task_id: { type: 'STRING', description: 'The task ID' },
            action: {
              type: 'STRING',
              description: 'Action to perform',
              enum: ['pause', 'resume', 'cancel'],
            },
          },
          required: ['task_id', 'action'],
        },
        _metadata: {
          readOnly: false,
          requiresExplicitIntent: true,
          dangerLevel: 'destructive',
        } as ToolMetadata,
      },
      {
        name: 'send_message_to_group',
        description:
          'Send a text message to a specific group. Uses group_folder to identify the target.',
        parameters: {
          type: 'OBJECT',
          properties: {
            group_folder: {
              type: 'STRING',
              description: 'The target group folder name',
            },
            message: {
              type: 'STRING',
              description: 'The message text to send',
            },
          },
          required: ['group_folder', 'message'],
        },
        _metadata: {
          readOnly: false,
          requiresExplicitIntent: true,
          dangerLevel: 'moderate',
        } as ToolMetadata,
      },
      // Admin also gets generate_image
      {
        name: 'generate_image',
        description:
          'Generate an image based on a text description. ' +
          'ONLY call this when the admin EXPLICITLY asks to create, draw, or generate an image.',
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
        _metadata: {
          readOnly: false,
          requiresExplicitIntent: true,
          dangerLevel: 'moderate',
        } as ToolMetadata,
      },
    ];

    // Register metadata
    for (const decl of adminDeclarations) {
      if (decl._metadata) toolMetadataRegistry.set(decl.name, decl._metadata);
    }
    const cleanAdmin = adminDeclarations.map(({ _metadata, ...rest }) => rest);
    cachedAdminDeclarations = cleanAdmin;
    return cleanAdmin;
  }

  // ========================================================================
  // Regular (non-admin) declarations
  // ========================================================================
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
      _metadata: {
        readOnly: false,
        requiresExplicitIntent: true,
        dangerLevel: 'moderate',
      } as ToolMetadata,
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
      _metadata: {
        readOnly: false,
        requiresExplicitIntent: true,
        dangerLevel: 'moderate',
      } as ToolMetadata,
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
      _metadata: {
        readOnly: false,
        requiresExplicitIntent: true,
        dangerLevel: 'moderate',
      } as ToolMetadata,
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
      _metadata: {
        readOnly: true,
        requiresExplicitIntent: false,
        dangerLevel: 'safe',
      } as ToolMetadata,
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
      _metadata: {
        readOnly: false,
        requiresExplicitIntent: true,
        dangerLevel: 'destructive',
      } as ToolMetadata,
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
      _metadata: {
        readOnly: false,
        requiresExplicitIntent: true,
        dangerLevel: 'moderate',
      } as ToolMetadata,
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
      _metadata: {
        readOnly: false,
        requiresExplicitIntent: true,
        dangerLevel: 'moderate',
      } as ToolMetadata,
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
      _metadata: {
        readOnly: true,
        requiresExplicitIntent: false,
        dangerLevel: 'safe',
      } as ToolMetadata,
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
      _metadata: {
        readOnly: false,
        requiresExplicitIntent: true,
        dangerLevel: 'moderate',
      } as ToolMetadata,
    });
  }

  // Append plugin tool declarations
  for (const tool of pluginToolDeclarations) {
    if (tool.permission === 'main' && !isMain) continue;
    declarations.push({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      _metadata: tool.metadata ?? {
        readOnly: false,
        requiresExplicitIntent: false,
        dangerLevel: 'moderate',
      },
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

  // Cache for reuse (admin is handled above, this is main vs non-main)
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

  // Run beforeToolCall hooks
  const hookCtx = {
    toolName: name,
    args: args as Record<string, unknown>,
    chatJid,
    groupFolder,
    isMain: context.isMain,
  };
  {
    const pluginLoaderPath = '../app/src/plugin-loader.js';
    const { runBeforeToolCallHooks } = await import(pluginLoaderPath);
    const blockResult = await runBeforeToolCallHooks(hookCtx);
    if (blockResult) {
      return {
        name,
        response: {
          success: false,
          error: `Tool call blocked: ${blockResult.reason}`,
        },
      };
    }
  }

  // Validate tool input if a schema is registered
  {
    const inputSchema = inputSchemaRegistry.get(name);
    if (inputSchema) {
      const validation = validateToolInput(inputSchema, args as Record<string, unknown>);
      if (!validation.valid) {
        return {
          name,
          response: {
            success: false,
            error: `Validation failed: ${validation.error}`,
          },
        };
      }
      // Use parsed/transformed data (enables Zod transforms)
      args = (validation.data ?? args) as Record<string, any>;
    }
  }

  const executeSwitch = async (): Promise<FunctionCallResult> => {
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
          response: wrapToolResponse(true, { task_id: taskId, next_run: nextRun }),
        };
      }

      case 'list_tasks': {
        const { getTasksForGroup } = await import('./db.js');
        const tasks = getTasksForGroup(groupFolder);
        return {
          name,
          response: wrapToolResponse(true, {
            tasks: tasks.map((t) => ({
              id: t.id,
              prompt: t.prompt.slice(0, 100),
              schedule_type: t.schedule_type,
              schedule_value: t.schedule_value,
              status: t.status,
              next_run: t.next_run,
            })),
          }),
        };
      }

      case 'pause_task': {
        const { updateTask: pauseUpdate, getTaskById: pauseLookup } =
          await import('./db.js');
        const pauseTarget = pauseLookup(args.task_id);
        if (!pauseTarget) {
          return {
            name,
            response: {
              success: false,
              error: `Task not found: ${args.task_id}. Use list_tasks to get valid task IDs.`,
            },
          };
        }
        if (pauseTarget.status !== 'active') {
          return {
            name,
            response: {
              success: false,
              error: `Task is not active (current status: ${pauseTarget.status}). Only active tasks can be paused.`,
            },
          };
        }
        pauseUpdate(args.task_id, { status: 'paused' });
        return {
          name,
          response: { success: true, task_id: args.task_id, status: 'paused' },
        };
      }

      case 'resume_task': {
        const { updateTask: resumeUpdate, getTaskById: resumeLookup } =
          await import('./db.js');
        const resumeTarget = resumeLookup(args.task_id);
        if (!resumeTarget) {
          return {
            name,
            response: {
              success: false,
              error: `Task not found: ${args.task_id}. Use list_tasks to get valid task IDs.`,
            },
          };
        }
        if (resumeTarget.status !== 'paused') {
          return {
            name,
            response: {
              success: false,
              error: `Task is not paused (current status: ${resumeTarget.status}). Only paused tasks can be resumed.`,
            },
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
            response: {
              success: false,
              error: `Task not found: ${args.task_id}. Use list_tasks to get valid task IDs.`,
            },
          };
        }
        deleteTask(args.task_id);
        return {
          name,
          response: wrapToolResponse(true, { task_id: args.task_id, deleted: true }),
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
        const factKey = String(args.key)
          .slice(0, 50)
          .replace(/[^\w_-]/g, '_');
        const factValue = String(args.value).slice(0, 500);
        upsertFact(groupFolder, factKey, factValue, 'user_set', 1.0);
        return {
          name,
          response: wrapToolResponse(true, { key: factKey, remembered: true }),
        };
      }

      // ================================================================
      // Admin-only tool handlers
      // ================================================================

      case 'list_all_groups': {
        const { getRegisteredGroups } = await import('./state.js');
        const { isAdminGroup } = await import('./admin-auth.js');
        const { getActiveTaskCountsBatch, getMessageCountsBatch } =
          await import('./db.js');
        const groups = getRegisteredGroups();
        const taskCounts = getActiveTaskCountsBatch();
        const msgCounts = getMessageCountsBatch();

        const groupList = Object.entries(groups)
          .filter(([, g]) => !isAdminGroup(g.folder))
          .map(([chatId, g]) => ({
            folder: g.folder,
            name: g.name,
            chatId,
            persona: g.persona || 'default',
            requireTrigger: g.requireTrigger !== false,
            enableWebSearch: g.enableWebSearch !== false,
            preferredPath: resolvePreferredPath(g),
            geminiModel: g.geminiModel || 'auto',
            messageCount: msgCounts.get(chatId) || 0,
            activeTaskCount: taskCounts.get(g.folder) || 0,
          }));

        return {
          name,
          response: {
            success: true,
            groups: groupList,
            count: groupList.length,
          },
        };
      }

      case 'get_group_detail': {
        const invalid = validateGroupFolder(name, args.group_folder);
        if (invalid) return invalid;
        const { getGroupDetailContext } = await import('./admin-context.js');
        const detail = getGroupDetailContext(args.group_folder);
        return { name, response: { success: true, detail } };
      }

      case 'update_group_settings': {
        const invalid = validateGroupFolder(name, args.group_folder);
        if (invalid) return invalid;
        const { getRegisteredGroups: getGroups } = await import('./state.js');
        const { isAdminGroup: isAdminCheck } = await import('./admin-auth.js');
        const groups = getGroups();

        if (isAdminCheck(args.group_folder)) {
          return {
            name,
            response: {
              success: false,
              error: 'Cannot modify admin chat settings',
            },
          };
        }

        const entry = Object.entries(groups).find(
          ([, g]) => g.folder === args.group_folder,
        );
        if (!entry) {
          return {
            name,
            response: {
              success: false,
              error: `Group "${args.group_folder}" not found`,
            },
          };
        }

        let settings: Record<string, any>;
        try {
          settings = JSON.parse(args.settings);
        } catch {
          return {
            name,
            response: { success: false, error: 'Invalid JSON in settings' },
          };
        }

        const [, targetGroup] = entry;
        const ALLOWED_SETTINGS = [
          'persona',
          'requireTrigger',
          'enableWebSearch',
          'preferredPath',
          'geminiModel',
          'name',
        ];
        const BOOL_FIELDS = new Set([
          'requireTrigger',
          'enableWebSearch',
        ]);
        const applied: string[] = [];
        for (const key of Object.keys(settings)) {
          if (!ALLOWED_SETTINGS.includes(key)) continue;
          let value = settings[key];
          if (BOOL_FIELDS.has(key)) value = Boolean(value);
          if (key === 'preferredPath' && !['fast', 'container'].includes(value)) continue;
          (targetGroup as any)[key] = value;
          applied.push(key);
        }

        if (applied.length > 0) {
          const { DATA_DIR: dataDir } = await import('./config.js');
          const pathMod = await import('path');
          const { saveJson: save } = await import('./utils.js');
          save(pathMod.join(dataDir, 'registered_groups.json'), groups);
        }

        return {
          name,
          response: { success: true, applied, group_folder: args.group_folder },
        };
      }

      case 'read_group_prompt': {
        const invalid = validateGroupFolder(name, args.group_folder);
        if (invalid) return invalid;
        const { readGroupGeminiMd } = await import('./group-manager.js');
        const content = readGroupGeminiMd(args.group_folder);
        return {
          name,
          response: {
            success: true,
            content: content || '(No GEMINI.md found)',
          },
        };
      }

      case 'write_group_prompt': {
        const invalid = validateGroupFolder(name, args.group_folder);
        if (invalid) return invalid;
        const fsMod = await import('fs');
        const pathMod = await import('path');
        const { GROUPS_DIR: groupsDir } = await import('./config.js');
        const filePath = pathMod.join(
          groupsDir,
          args.group_folder,
          'GEMINI.md',
        );
        const dir = pathMod.dirname(filePath);

        if (!fsMod.existsSync(dir)) {
          return {
            name,
            response: {
              success: false,
              error: `Group folder "${args.group_folder}" does not exist`,
            },
          };
        }

        fsMod.writeFileSync(filePath, args.content, 'utf-8');

        // Invalidate context cache for this group
        try {
          const { invalidateCache } = await import('./context-cache.js');
          await invalidateCache(args.group_folder);
        } catch {
          /* best effort */
        }

        return {
          name,
          response: {
            success: true,
            group_folder: args.group_folder,
            written: true,
          },
        };
      }

      case 'list_all_tasks': {
        const { getAllTasks: getTasks } = await import('./db.js');
        const tasks = getTasks();
        return {
          name,
          response: {
            success: true,
            tasks: tasks.map((t) => ({
              id: t.id,
              group_folder: t.group_folder,
              prompt: t.prompt.slice(0, 100),
              schedule_type: t.schedule_type,
              schedule_value: t.schedule_value,
              status: t.status,
              next_run: t.next_run,
            })),
            count: tasks.length,
          },
        };
      }

      case 'manage_cross_group_task': {
        const {
          getTaskById: lookupTask,
          updateTask: modifyTask,
          deleteTask: removeTask,
        } = await import('./db.js');
        const task = lookupTask(args.task_id);
        if (!task) {
          return {
            name,
            response: {
              success: false,
              error: `Task not found: ${args.task_id}`,
            },
          };
        }

        switch (args.action) {
          case 'pause':
            if (task.status !== 'active') {
              return {
                name,
                response: {
                  success: false,
                  error: `Task is ${task.status}, not active`,
                },
              };
            }
            modifyTask(args.task_id, { status: 'paused' });
            return {
              name,
              response: {
                success: true,
                task_id: args.task_id,
                status: 'paused',
              },
            };
          case 'resume':
            if (task.status !== 'paused') {
              return {
                name,
                response: {
                  success: false,
                  error: `Task is ${task.status}, not paused`,
                },
              };
            }
            modifyTask(args.task_id, { status: 'active' });
            return {
              name,
              response: {
                success: true,
                task_id: args.task_id,
                status: 'active',
              },
            };
          case 'cancel':
            removeTask(args.task_id);
            return {
              name,
              response: { success: true, task_id: args.task_id, deleted: true },
            };
          default:
            return {
              name,
              response: {
                success: false,
                error: `Unknown action: ${args.action}`,
              },
            };
        }
      }

      case 'send_message_to_group': {
        const invalid = validateGroupFolder(name, args.group_folder);
        if (invalid) return invalid;
        const { getRegisteredGroups: allGroups } = await import('./state.js');
        const { isAdminGroup: isAdminFolderCheck } =
          await import('./admin-auth.js');
        const groups = allGroups();

        if (isAdminFolderCheck(args.group_folder)) {
          return {
            name,
            response: { success: false, error: 'Cannot send to admin chat' },
          };
        }

        const entry = Object.entries(groups).find(
          ([, g]) => g.folder === args.group_folder,
        );
        if (!entry) {
          return {
            name,
            response: {
              success: false,
              error: `Group "${args.group_folder}" not found`,
            },
          };
        }

        const [targetChatId] = entry;
        await context.sendMessage(targetChatId, args.message);
        return {
          name,
          response: { success: true, sent_to: args.group_folder },
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

      default: {
        const pluginLoaderPath = '../app/src/plugin-loader.js';
        const { dispatchPluginToolCall } = await import(pluginLoaderPath);
        const pluginResult = await dispatchPluginToolCall(name, args, {
          groupFolder,
          chatJid,
          isMain: context.isMain,
          sendMessage: async (id: string, text: string) => {
            if (context.bot) await context.bot.sendMessage(parseInt(id), text);
          },
        });
        if (pluginResult !== null) {
          if (typeof pluginResult === 'string') {
            try {
              return { name, response: JSON.parse(pluginResult) };
            } catch {
              return { name, response: { success: true, data: { text: pluginResult } } };
            }
          }
          return { name, response: pluginResult };
        }
        return {
          name,
          response: {
            success: false,
            error: `Unknown function: ${name}. This function is not available. Respond with text directly.`,
          },
        };
      }
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
  };

  const result = await executeSwitch();

  // Run afterToolCall hooks (skipped if beforeToolCall blocked above)
  {
    const pluginLoaderPath = '../app/src/plugin-loader.js';
    const { runAfterToolCallHooks } = await import(pluginLoaderPath);
    const afterCtx = { ...hookCtx, result: result.response as Record<string, unknown> };
    const modifiedResponse = await runAfterToolCallHooks(afterCtx);
    if (modifiedResponse) {
      return { name, response: modifiedResponse };
    }
  }

  return result;
}
