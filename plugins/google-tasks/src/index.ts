/**
 * Google Tasks Plugin
 *
 * Integrates Google Tasks with NanoGemClaw via:
 * - Gemini tools: create, complete, and list tasks via natural language
 * - IPC handlers: programmatic task creation and completion
 * - Background service: periodic sync every 15 minutes
 * - Routes: REST API for dashboard access
 * - Hook: after scheduled task completion → mark matching Google Task done
 *
 * Requires the google-auth plugin to be installed and authorized first.
 */

import fs from 'fs';
import { Router } from 'express';
import { isAuthenticated } from 'nanogemclaw-plugin-google-auth';
import type {
  NanoPlugin,
  PluginApi,
  GeminiToolContribution,
  IpcHandlerContribution,
  RouteContribution,
  ServiceContribution,
  MessageHookContext,
} from '@nanogemclaw/plugin-api';
import {
  listTaskLists,
  listTasks,
  createTask,
  completeTask,
  deleteTask,
  findTaskListByName,
  getDefaultTaskList,
} from './tasks-api.js';
import {
  syncTasks,
  markGoogleTaskComplete,
  findGoogleTaskByTitle,
  upsertTaskMapping,
  loadSyncState,
} from './sync.js';

// ============================================================================
// Service state
// ============================================================================

let syncInterval: ReturnType<typeof setInterval> | null = null;
let pluginApi: PluginApi | null = null;

const SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// ============================================================================
// Gemini Tools
// ============================================================================

const geminiTools: GeminiToolContribution[] = [
  {
    name: 'create_google_task',
    description:
      'Create a new task in Google Tasks. Use when user wants to add a task or todo item.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'Task title' },
        notes: { type: 'STRING', description: 'Optional task details/notes' },
        due: {
          type: 'STRING',
          description: 'Optional due date in ISO 8601 format (YYYY-MM-DD)',
        },
        tasklist: {
          type: 'STRING',
          description: 'Task list name (default: primary list)',
        },
      },
      required: ['title'],
    },
    permission: 'any',

    async execute(args, context): Promise<string> {
      if (!isAuthenticated()) {
        return JSON.stringify({
          error:
            'Not authenticated with Google. Authorize via dashboard Settings → Google Account.',
        });
      }

      try {
        let listId: string;
        if (args['tasklist']) {
          const named = await findTaskListByName(String(args['tasklist']));
          if (!named) {
            return JSON.stringify({
              error: `Task list "${args['tasklist']}" not found.`,
            });
          }
          listId = named.id;
        } else {
          const defaultList = await getDefaultTaskList();
          listId = defaultList.id;
        }

        const task = await createTask(listId, {
          title: String(args['title']),
          notes: args['notes'] != null ? String(args['notes']) : undefined,
          due: args['due'] != null ? String(args['due']) : undefined,
        });

        pluginApi?.logger.info(
          `Google Tasks: created task "${task.title}" (${task.id}) via Gemini tool`,
        );

        return JSON.stringify({
          success: true,
          task: {
            id: task.id,
            title: task.title,
            due: task.due,
            notes: task.notes,
          },
        });
      } catch (err) {
        pluginApi?.logger.error(
          `Google Tasks create_google_task error: ${err}`,
        );
        return JSON.stringify({
          error: 'Failed to create task in Google Tasks.',
        });
      }
    },
  },

  {
    name: 'complete_google_task',
    description:
      'Mark a Google Task as completed. Use when the user says a task is done or finished.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: {
          type: 'STRING',
          description: 'Title of the task to mark as completed',
        },
        tasklist: {
          type: 'STRING',
          description:
            'Task list name to search in (default: search all lists)',
        },
      },
      required: ['title'],
    },
    permission: 'any',

    async execute(args, _context): Promise<string> {
      if (!isAuthenticated()) {
        return JSON.stringify({
          error:
            'Not authenticated with Google. Authorize via dashboard Settings → Google Account.',
        });
      }

      try {
        const title = String(args['title']);

        if (args['tasklist']) {
          // Search in the specified list
          const named = await findTaskListByName(String(args['tasklist']));
          if (!named) {
            return JSON.stringify({
              error: `Task list "${args['tasklist']}" not found.`,
            });
          }
          const tasks = await listTasks(named.id, { showCompleted: false });
          const match = tasks.find(
            (t) => t.title.toLowerCase() === title.toLowerCase(),
          );
          if (!match) {
            return JSON.stringify({
              error: `No active task named "${title}" found in list "${named.title}".`,
            });
          }
          await completeTask(named.id, match.id);
          return JSON.stringify({ success: true, title: match.title });
        }

        // Search across all lists
        const found = await findGoogleTaskByTitle(
          title,
          pluginApi?.logger ?? {
            info: () => {},
            warn: () => {},
            error: () => {},
            debug: () => {},
          },
        );
        if (!found) {
          return JSON.stringify({
            error: `No active task named "${title}" found.`,
          });
        }
        await completeTask(found.listId, found.task.id);
        pluginApi?.logger.info(
          `Google Tasks: completed task "${found.task.title}" via Gemini tool`,
        );
        return JSON.stringify({ success: true, title: found.task.title });
      } catch (err) {
        pluginApi?.logger.error(
          `Google Tasks complete_google_task error: ${err}`,
        );
        return JSON.stringify({
          error: 'Failed to complete task in Google Tasks.',
        });
      }
    },
  },

  {
    name: 'list_google_tasks',
    description:
      'List tasks from Google Tasks. Use when the user asks what tasks or todos they have.',
    parameters: {
      type: 'OBJECT',
      properties: {
        tasklist: {
          type: 'STRING',
          description: 'Task list name (default: primary list)',
        },
        showCompleted: {
          type: 'BOOLEAN',
          description: 'Include completed tasks (default: false)',
        },
        dueMin: {
          type: 'STRING',
          description: 'Only show tasks due on or after this date (YYYY-MM-DD)',
        },
        dueMax: {
          type: 'STRING',
          description:
            'Only show tasks due on or before this date (YYYY-MM-DD)',
        },
      },
      required: [],
    },
    permission: 'any',

    async execute(args, _context): Promise<string> {
      if (!isAuthenticated()) {
        return JSON.stringify({
          error:
            'Not authenticated with Google. Authorize via dashboard Settings → Google Account.',
        });
      }

      try {
        let listId: string;
        let listTitle: string;
        if (args['tasklist']) {
          const named = await findTaskListByName(String(args['tasklist']));
          if (!named) {
            return JSON.stringify({
              error: `Task list "${args['tasklist']}" not found.`,
            });
          }
          listId = named.id;
          listTitle = named.title;
        } else {
          const defaultList = await getDefaultTaskList();
          listId = defaultList.id;
          listTitle = defaultList.title;
        }

        const tasks = await listTasks(listId, {
          showCompleted: args['showCompleted'] === true,
          dueMin: args['dueMin'] != null ? String(args['dueMin']) : undefined,
          dueMax: args['dueMax'] != null ? String(args['dueMax']) : undefined,
        });

        return JSON.stringify({
          list: listTitle,
          count: tasks.length,
          tasks: tasks.map((t) => ({
            id: t.id,
            title: t.title,
            notes: t.notes,
            due: t.due,
            status: t.status,
          })),
        });
      } catch (err) {
        pluginApi?.logger.error(`Google Tasks list_google_tasks error: ${err}`);
        return JSON.stringify({
          error: 'Failed to list tasks from Google Tasks.',
        });
      }
    },
  },
];

// ============================================================================
// IPC Handlers
// ============================================================================

const ipcHandlers: IpcHandlerContribution[] = [
  {
    type: 'google_task_create',
    requiredPermission: 'main',

    async handle(data, _context): Promise<void> {
      if (!pluginApi) return;
      if (!isAuthenticated()) {
        pluginApi.logger.warn(
          'Google Tasks IPC google_task_create: not authenticated',
        );
        return;
      }

      const title = String(data['title'] ?? '');
      if (!title) {
        pluginApi.logger.warn(
          'Google Tasks IPC google_task_create: missing title',
        );
        return;
      }

      try {
        const defaultList = await getDefaultTaskList();
        const task = await createTask(defaultList.id, {
          title,
          notes: data['notes'] != null ? String(data['notes']) : undefined,
          due: data['due'] != null ? String(data['due']) : undefined,
        });

        // If caller supplied a localId, track the mapping for sync
        if (data['localId'] != null && pluginApi.dataDir) {
          upsertTaskMapping(pluginApi.dataDir, {
            localId: String(data['localId']),
            googleTaskId: task.id,
            googleListId: defaultList.id,
          });
        }

        pluginApi.logger.info(
          `Google Tasks: IPC created task "${task.title}" (${task.id})`,
        );
      } catch (err) {
        pluginApi.logger.error(
          `Google Tasks IPC google_task_create error: ${err}`,
        );
      }
    },
  },

  {
    type: 'google_task_complete',
    requiredPermission: 'main',

    async handle(data, _context): Promise<void> {
      if (!pluginApi) return;
      if (!isAuthenticated()) {
        pluginApi.logger.warn(
          'Google Tasks IPC google_task_complete: not authenticated',
        );
        return;
      }

      const localId = data['localId'] != null ? String(data['localId']) : null;
      const title = data['title'] != null ? String(data['title']) : null;

      if (!localId && !title) {
        pluginApi.logger.warn(
          'Google Tasks IPC google_task_complete: must provide localId or title',
        );
        return;
      }

      try {
        if (localId) {
          await markGoogleTaskComplete(
            pluginApi.dataDir,
            localId,
            pluginApi.logger,
          );
        } else if (title) {
          const found = await findGoogleTaskByTitle(title, pluginApi.logger);
          if (found) {
            await completeTask(found.listId, found.task.id);
            pluginApi.logger.info(
              `Google Tasks: IPC completed task "${found.task.title}"`,
            );
          } else {
            pluginApi.logger.warn(
              `Google Tasks: IPC could not find task titled "${title}"`,
            );
          }
        }
      } catch (err) {
        pluginApi.logger.error(
          `Google Tasks IPC google_task_complete error: ${err}`,
        );
      }
    },
  },
];

// ============================================================================
// Background Service
// ============================================================================

const syncService: ServiceContribution = {
  name: 'google-tasks-sync',

  async start(api: PluginApi): Promise<void> {
    pluginApi = api;

    // Run an initial sync shortly after startup
    setTimeout(() => {
      syncTasks(api).catch((err) =>
        api.logger.error(`Google Tasks: initial sync error — ${err}`),
      );
    }, 5000);

    syncInterval = setInterval(() => {
      syncTasks(api).catch((err) =>
        api.logger.error(`Google Tasks: periodic sync error — ${err}`),
      );
    }, SYNC_INTERVAL_MS);

    api.logger.info('Google Tasks sync service started (interval: 15 min)');
  },

  async stop(): Promise<void> {
    if (syncInterval !== null) {
      clearInterval(syncInterval);
      syncInterval = null;
    }
  },
};

// ============================================================================
// Routes
// ============================================================================

const taskRoutes: RouteContribution = {
  prefix: '',

  createRouter(): Router {
    const router = Router();

    // GET /api/plugins/google-tasks/lists
    router.get('/lists', async (_req, res) => {
      if (!isAuthenticated()) {
        res.status(401).json({ error: 'Not authenticated with Google' });
        return;
      }
      try {
        const lists = await listTaskLists();
        res.json({ data: lists });
      } catch (err) {
        pluginApi?.logger.error(`Google Tasks route GET /lists error: ${err}`);
        res.status(500).json({ error: 'Failed to fetch task lists' });
      }
    });

    // GET /api/plugins/google-tasks/lists/:listId/tasks
    router.get('/lists/:listId/tasks', async (req, res) => {
      if (!isAuthenticated()) {
        res.status(401).json({ error: 'Not authenticated with Google' });
        return;
      }
      const listId = req.params['listId'];
      if (!listId || !/^[a-zA-Z0-9_-]+$/.test(listId)) {
        res.status(400).json({ error: 'Invalid list ID format' });
        return;
      }
      try {
        const showCompleted = req.query['showCompleted'] === 'true';
        const dueMin =
          typeof req.query['dueMin'] === 'string'
            ? req.query['dueMin']
            : undefined;
        const dueMax =
          typeof req.query['dueMax'] === 'string'
            ? req.query['dueMax']
            : undefined;
        const tasks = await listTasks(listId, {
          showCompleted,
          dueMin,
          dueMax,
        });
        res.json({ data: tasks });
      } catch (err) {
        pluginApi?.logger.error(
          `Google Tasks route GET /lists/:listId/tasks error: ${err}`,
        );
        res.status(500).json({ error: 'Failed to fetch tasks' });
      }
    });

    // POST /api/plugins/google-tasks/lists/:listId/tasks
    router.post('/lists/:listId/tasks', async (req, res) => {
      if (!isAuthenticated()) {
        res.status(401).json({ error: 'Not authenticated with Google' });
        return;
      }
      const postListId = req.params['listId'];
      if (!postListId || !/^[a-zA-Z0-9_-]+$/.test(postListId)) {
        res.status(400).json({ error: 'Invalid list ID format' });
        return;
      }
      const body = req.body as Record<string, unknown>;
      const title = typeof body['title'] === 'string' ? body['title'] : '';
      if (!title) {
        res.status(400).json({ error: 'title is required' });
        return;
      }
      // Validate due date format if provided (YYYY-MM-DD or ISO 8601)
      const due = typeof body['due'] === 'string' ? body['due'] : undefined;
      if (due && !/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(due)) {
        res.status(400).json({
          error: 'Invalid due date format. Use YYYY-MM-DD or ISO 8601.',
        });
        return;
      }
      try {
        const task = await createTask(postListId, {
          title,
          notes: typeof body['notes'] === 'string' ? body['notes'] : undefined,
          due,
        });
        res.status(201).json({ data: task });
      } catch (err) {
        pluginApi?.logger.error(
          `Google Tasks route POST /lists/:listId/tasks error: ${err}`,
        );
        res.status(500).json({ error: 'Failed to create task' });
      }
    });

    // PATCH /api/plugins/google-tasks/lists/:listId/tasks/:taskId/complete
    router.patch('/lists/:listId/tasks/:taskId/complete', async (req, res) => {
      if (!isAuthenticated()) {
        res.status(401).json({ error: 'Not authenticated with Google' });
        return;
      }
      const patchListId = req.params['listId'];
      const patchTaskId = req.params['taskId'];
      if (
        !patchListId ||
        !/^[a-zA-Z0-9_-]+$/.test(patchListId) ||
        !patchTaskId ||
        !/^[a-zA-Z0-9_-]+$/.test(patchTaskId)
      ) {
        res.status(400).json({ error: 'Invalid list or task ID format' });
        return;
      }
      try {
        const task = await completeTask(patchListId, patchTaskId);
        res.json({ data: task });
      } catch (err) {
        pluginApi?.logger.error(
          `Google Tasks route PATCH complete error: ${err}`,
        );
        res.status(500).json({ error: 'Failed to complete task' });
      }
    });

    // DELETE /api/plugins/google-tasks/lists/:listId/tasks/:taskId
    router.delete('/lists/:listId/tasks/:taskId', async (req, res) => {
      if (!isAuthenticated()) {
        res.status(401).json({ error: 'Not authenticated with Google' });
        return;
      }
      const delListId = req.params['listId'];
      const delTaskId = req.params['taskId'];
      if (
        !delListId ||
        !/^[a-zA-Z0-9_-]+$/.test(delListId) ||
        !delTaskId ||
        !/^[a-zA-Z0-9_-]+$/.test(delTaskId)
      ) {
        res.status(400).json({ error: 'Invalid list or task ID format' });
        return;
      }
      try {
        await deleteTask(delListId, delTaskId);
        res.json({ data: { deleted: true } });
      } catch (err) {
        pluginApi?.logger.error(`Google Tasks route DELETE task error: ${err}`);
        res.status(500).json({ error: 'Failed to delete task' });
      }
    });

    // GET /api/plugins/google-tasks/sync-state
    router.get('/sync-state', (req, res) => {
      if (!pluginApi) {
        res.status(503).json({ error: 'Plugin not initialized' });
        return;
      }
      try {
        const state = loadSyncState(pluginApi.dataDir);
        res.json({ data: state });
      } catch (err) {
        pluginApi.logger.error(
          `Google Tasks route GET /sync-state error: ${err}`,
        );
        res.status(500).json({ error: 'Failed to load sync state' });
      }
    });

    // POST /api/plugins/google-tasks/sync
    router.post('/sync', async (_req, res) => {
      if (!pluginApi) {
        res.status(503).json({ error: 'Plugin not initialized' });
        return;
      }
      if (!isAuthenticated()) {
        res.status(401).json({ error: 'Not authenticated with Google' });
        return;
      }
      try {
        await syncTasks(pluginApi);
        const state = loadSyncState(pluginApi.dataDir);
        res.json({ data: { lastSync: state.lastSync } });
      } catch (err) {
        pluginApi.logger.error(`Google Tasks route POST /sync error: ${err}`);
        res.status(500).json({ error: 'Sync failed' });
      }
    });

    return router;
  },
};

// ============================================================================
// Plugin Definition
// ============================================================================

const googleTasksPlugin: NanoPlugin = {
  id: 'google-tasks',
  name: 'Google Tasks',
  version: '0.1.0',
  description: 'Manage Google Tasks via Gemini tools and dashboard API',

  async init(api: PluginApi): Promise<void | false> {
    pluginApi = api;

    // Ensure data directory exists for sync-state.json
    fs.mkdirSync(api.dataDir, { recursive: true });

    if (!isAuthenticated()) {
      api.logger.info(
        'Google Tasks: Google Auth not yet authorized — ' +
          'task creation will be unavailable until you authorize via dashboard Settings → Google Account.',
      );
      // We do not return false: the plugin loads so tools and routes
      // are registered; they return auth-error messages gracefully.
    } else {
      api.logger.info('Google Tasks plugin initialized (authenticated)');
    }
  },

  async start(api: PluginApi): Promise<void> {
    pluginApi = api;
    api.logger.info('Google Tasks plugin started');
  },

  async stop(_api: PluginApi): Promise<void> {
    // syncInterval is cleaned up by syncService.stop() — no need to duplicate
    pluginApi?.logger.info('Google Tasks plugin stopped');
    pluginApi = null;
  },

  geminiTools,
  ipcHandlers,
  services: [syncService],
  routes: [taskRoutes],

  hooks: {
    /**
     * After a message is processed, check if it signals a local scheduled task
     * completing (content contains a completion sentinel). If so, attempt to
     * find and complete the matching Google Task.
     *
     * Convention: reply may contain "@task-complete:<localId>" injected by the
     * scheduler or IPC layer. This hook picks that up and propagates completion
     * to Google Tasks.
     */
    async afterMessage(
      context: MessageHookContext & { reply: string },
    ): Promise<void> {
      if (!pluginApi) return;
      if (!isAuthenticated()) return;

      // Look for completion sentinel in the bot reply
      const SENTINEL_RE = /@task-complete:([^\s]+)/g;
      let match: RegExpExecArray | null;
      while ((match = SENTINEL_RE.exec(context.reply)) !== null) {
        const localId = match[1];
        if (localId) {
          await markGoogleTaskComplete(
            pluginApi.dataDir,
            localId,
            pluginApi.logger,
          ).catch((err) =>
            pluginApi?.logger.warn(
              `Google Tasks afterMessage hook error for localId "${localId}": ${err}`,
            ),
          );
        }
      }
    },
  },
};

export default googleTasksPlugin;
