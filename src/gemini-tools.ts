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

import type { IpcContext } from './types.js';
import { logger } from './logger.js';

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
    },
    {
      name: 'pause_task',
      description: 'Pause an active scheduled task by its ID.',
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
    },
    {
      name: 'resume_task',
      description: 'Resume a paused scheduled task by its ID.',
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
    },
    {
      name: 'cancel_task',
      description: 'Cancel and delete a scheduled task by its ID.',
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
    },
    {
      name: 'set_preference',
      description:
        'Store a user preference for the group. Allowed keys: language, nickname, response_style, interests, timezone, custom_instructions.',
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
    },
  ];

  // Main-only functions
  if (isMain) {
    declarations.push({
      name: 'register_group',
      description:
        'Register a new Telegram group/chat for the assistant. Only available to the main group.',
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
    });
  }

  // Cache for reuse
  if (isMain) {
    cachedMainDeclarations = declarations;
  } else {
    cachedNonMainDeclarations = declarations;
  }

  return declarations;
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

      case 'pause_task': {
        const { updateTask: pauseUpdate } = await import('./db.js');
        pauseUpdate(args.task_id, { status: 'paused' });
        return {
          name,
          response: { success: true, task_id: args.task_id, status: 'paused' },
        };
      }

      case 'resume_task': {
        const { updateTask: resumeUpdate } = await import('./db.js');
        resumeUpdate(args.task_id, { status: 'active' });
        return {
          name,
          response: { success: true, task_id: args.task_id, status: 'active' },
        };
      }

      case 'cancel_task': {
        const { deleteTask } = await import('./db.js');
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
