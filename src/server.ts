import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger, logEmitter, getLogBuffer, setLogLevel } from './logger.js';
import { GROUPS_DIR } from './config.js';

// Configuration
const DASHBOARD_PORT = 3000;
const ALLOWED_ORIGINS = (
  process.env.DASHBOARD_ORIGINS ||
  `http://localhost:${DASHBOARD_PORT},http://127.0.0.1:${DASHBOARD_PORT},http://localhost:5173,http://localhost:3001`
)
  .split(',')
  .map((s) => s.trim());
const DASHBOARD_HOST = process.env.DASHBOARD_HOST || '127.0.0.1';
const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY;

// Application State
let io: Server;
let httpServer: ReturnType<typeof createServer> | null = null;
let groupsProvider: () => any[] = () => [];
let groupRegistrar: ((chatId: string, name: string) => any) | null = null;
let groupUpdater:
  | ((folder: string, updates: Record<string, any>) => any)
  | null = null;
let chatJidResolver: ((folder: string) => string | null) | null = null;

// Path traversal protection
const SAFE_FOLDER_RE = /^[a-zA-Z0-9_-]+$/;
const SAFE_FILE_RE = /^[a-zA-Z0-9_.-]+$/;

function validateFolder(folder: string): boolean {
  return SAFE_FOLDER_RE.test(folder);
}

/**
 * Detect LAN IP for 0.0.0.0 binds
 */
function getLanIp(): string | null {
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  return null;
}

/**
 * Initialize the Web Dashboard Server
 */
export function startDashboardServer() {
  const app = express();
  const server = createServer(app);
  httpServer = server;

  // Middleware
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || ALLOWED_ORIGINS.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
    }),
  );
  app.use(express.json());

  // Authentication
  const ACCESS_CODE = process.env.DASHBOARD_ACCESS_CODE;

  app.post('/api/auth/verify', (req, res) => {
    const { accessCode } = req.body;
    // Check header first (from LoginScreen), then body
    const code = req.headers['x-access-code'] || accessCode;

    if (ACCESS_CODE && code !== ACCESS_CODE) {
      res.status(401).json({ error: 'Invalid access code' });
      return;
    }
    res.json({ success: true });
  });

  // Global Auth Middleware for protective routes
  app.use((req, res, next) => {
    if (!ACCESS_CODE) return next();

    // Allow read-only GET requests without auth (mostly)
    // But strictly protect all mutation methods: POST, PUT, DELETE
    if (['POST', 'PUT', 'DELETE'].includes(req.method) && req.path !== '/api/auth/verify') {
      const code = req.headers['x-access-code'] || req.query.accessCode;
      if (code !== ACCESS_CODE) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
    }
    next();
  });
  if (DASHBOARD_API_KEY) {
    app.use((req, res, next) => {
      const apiKey = req.headers['x-api-key'] || req.query.apiKey;
      if (apiKey !== DASHBOARD_API_KEY) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      next();
    });
  }

  // Socket.io Setup
  io = new Server(server, {
    cors: {
      origin: ALLOWED_ORIGINS,
      methods: ['GET', 'POST'],
    },
  });

  // Optional Socket.io API key authentication
  if (DASHBOARD_API_KEY) {
    io.use((socket, next) => {
      const token =
        socket.handshake.auth?.token || socket.handshake.query?.apiKey;
      if (token !== DASHBOARD_API_KEY) {
        next(new Error('Authentication required'));
        return;
      }
      next();
    });
  }

  // ================================================================
  // Socket.io: Real-time connections + Log streaming
  // ================================================================
  io.on('connection', (socket) => {
    logger.info({ socketId: socket.id }, 'Dashboard client connected');

    // Send initial state
    socket.emit('groups:update', groupsProvider());

    // Send log history
    socket.emit('logs:history', getLogBuffer());

    // Stream new log entries
    const onLog = (entry: any) => {
      socket.emit('logs:entry', entry);
    };
    logEmitter.on('log', onLog);

    socket.on('disconnect', () => {
      logEmitter.removeListener('log', onLog);
      logger.info({ socketId: socket.id }, 'Dashboard client disconnected');
    });
  });

  // ================================================================
  // REST API: Health
  // ================================================================
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // ================================================================
  // REST API: Groups
  // ================================================================
  app.get('/api/groups', (_req, res) => {
    const groups = groupsProvider ? groupsProvider() : [];
    res.json({ groups });
  });

  app.get('/api/groups/discover', async (_req, res) => {
    try {
      const { getAllChats } = await import('./db.js');
      const chats = getAllChats();
      res.json({ data: chats });
    } catch (err) {
      res.status(500).json({ error: 'Failed to discover groups' });
    }
  });

  app.post('/api/groups/:chatId/register', async (req, res) => {
    try {
      const { chatId } = req.params;
      const { name } = req.body;
      if (!name || typeof name !== 'string') {
        res.status(400).json({ error: 'Name is required' });
        return;
      }
      if (!groupRegistrar) {
        res.status(503).json({ error: 'Group registration not available' });
        return;
      }
      const result = groupRegistrar(chatId, name);
      // Broadcast updated groups to all dashboard clients
      io.emit('groups:update', groupsProvider());
      res.json({ data: result });
    } catch (err) {
      res.status(500).json({ error: 'Registration failed' });
    }
  });

  // Get group detail by folder
  app.get('/api/groups/:folder/detail', async (req, res) => {
    const { folder } = req.params;
    if (!validateFolder(folder)) {
      res.status(400).json({ error: 'Invalid folder' });
      return;
    }
    try {
      const { getTasksForGroup, getUsageStats, getErrorState } =
        await import('./db.js');
      const groups = groupsProvider();
      const group = groups.find(
        (g: any) => g.id === folder || g.folder === folder,
      );
      if (!group) {
        res.status(404).json({ error: 'Group not found' });
        return;
      }
      const tasks = getTasksForGroup(folder);
      const usage = getUsageStats(folder);
      const errorState = getErrorState(folder);

      res.json({
        data: {
          ...group,
          tasks,
          usage,
          errorState,
        },
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch group detail' });
    }
  });

  // Update group settings
  app.put('/api/groups/:folder', async (req, res) => {
    const { folder } = req.params;
    if (!validateFolder(folder)) {
      res.status(400).json({ error: 'Invalid folder' });
      return;
    }

    if (!groupUpdater) {
      res.status(503).json({ error: 'Group updater not available' });
      return;
    }

    const { persona, enableWebSearch, requireTrigger, name, geminiModel } = req.body;

    // Validate persona if provided
    if (persona !== undefined) {
      const { getAllPersonas } = await import('./personas.js');
      if (!getAllPersonas()[persona]) {
        res.status(400).json({ error: `Invalid persona: ${persona}` });
        return;
      }
    }

    // Validate geminiModel if provided
    if (geminiModel !== undefined) {
      const validModels = ['gemini-3-flash-preview', 'gemini-3-pro-preview', 'gemini-2.5-flash', 'gemini-2.5-pro'];
      if (!validModels.includes(geminiModel)) {
        res.status(400).json({ error: `Invalid model: ${geminiModel}` });
        return;
      }
    }

    const updates: Record<string, any> = {};
    if (persona !== undefined) updates.persona = persona;
    if (enableWebSearch !== undefined)
      updates.enableWebSearch = enableWebSearch;
    if (requireTrigger !== undefined) updates.requireTrigger = requireTrigger;
    if (name !== undefined) updates.name = name;
    if (geminiModel !== undefined) updates.geminiModel = geminiModel;

    try {
      const result = groupUpdater(folder, updates);
      if (!result) {
        res.status(404).json({ error: 'Group not found' });
        return;
      }

      // Broadcast update to all dashboard clients
      io.emit('groups:update', groupsProvider());
      res.json({ data: result });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update group' });
    }
  });

  // Get available personas
  app.get('/api/personas', async (_req, res) => {
    try {
      const { getAllPersonas } = await import('./personas.js');
      res.json({ data: getAllPersonas() });
    } catch {
      res.status(500).json({ error: 'Failed to fetch personas' });
    }
  });

  // Create custom persona
  app.post('/api/personas', async (req, res) => {
    try {
      const { key, name, description, systemPrompt } = req.body;
      if (!key || !name || !systemPrompt) {
        res.status(400).json({ error: 'Missing required fields: key, name, systemPrompt' });
        return;
      }
      if (!SAFE_FOLDER_RE.test(key)) {
        res.status(400).json({ error: 'Invalid persona key (alphanumeric, dash, underscore only)' });
        return;
      }
      const { saveCustomPersona } = await import('./personas.js');
      saveCustomPersona(key, { name, description: description || '', systemPrompt });
      res.json({ data: { key } });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create persona';
      res.status(400).json({ error: message });
    }
  });

  // Delete custom persona
  app.delete('/api/personas/:key', async (req, res) => {
    try {
      const { key } = req.params;
      if (!SAFE_FOLDER_RE.test(key)) {
        res.status(400).json({ error: 'Invalid persona key' });
        return;
      }
      const { deleteCustomPersona } = await import('./personas.js');
      const deleted = deleteCustomPersona(key);
      if (!deleted) {
        res.status(404).json({ error: 'Persona not found' });
        return;
      }
      res.json({ data: { success: true } });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete persona';
      res.status(400).json({ error: message });
    }
  });

  // ================================================================
  // REST API: Tasks
  // ================================================================
  app.get('/api/tasks', async (_req, res) => {
    try {
      const { getAllTasks } = await import('./db.js');
      res.json({ data: getAllTasks() });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch tasks' });
    }
  });

  app.get('/api/tasks/group/:groupFolder', async (req, res) => {
    const { groupFolder } = req.params;
    if (!validateFolder(groupFolder)) {
      res.status(400).json({ error: 'Invalid group folder' });
      return;
    }
    try {
      const { getTasksForGroup } = await import('./db.js');
      res.json({ data: getTasksForGroup(groupFolder) });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch tasks' });
    }
  });

  // Create a new task
  app.post('/api/tasks', async (req, res) => {
    try {
      const { createTask } = await import('./db.js');
      const { CronExpressionParser } = await import('cron-parser');

      const {
        group_folder,
        prompt,
        schedule_type,
        schedule_value,
        context_mode,
        natural_schedule,
      } = req.body;

      // Parse natural schedule if provided
      let effectiveScheduleType = schedule_type;
      let effectiveScheduleValue = schedule_value;

      if (!schedule_type && !schedule_value && natural_schedule) {
        const { parseNaturalSchedule } = await import('./natural-schedule.js');
        const parsed = parseNaturalSchedule(natural_schedule);
        if (!parsed) {
          res.status(400).json({ error: 'Could not parse natural schedule text' });
          return;
        }
        effectiveScheduleType = parsed.schedule_type;
        effectiveScheduleValue = parsed.schedule_value;
      }

      if (!group_folder || !prompt || !effectiveScheduleType || !effectiveScheduleValue) {
        res.status(400).json({
          error:
            'Missing required fields: group_folder, prompt, schedule_type, schedule_value',
        });
        return;
      }

      if (!validateFolder(group_folder)) {
        res.status(400).json({ error: 'Invalid group folder' });
        return;
      }

      // Calculate next_run
      let next_run: string | null = null;
      if (effectiveScheduleType === 'cron') {
        try {
          const interval = CronExpressionParser.parse(effectiveScheduleValue);
          next_run = interval.next().toISOString();
        } catch {
          res.status(400).json({ error: 'Invalid cron expression' });
          return;
        }
      } else if (effectiveScheduleType === 'interval') {
        const ms = parseInt(effectiveScheduleValue, 10);
        if (isNaN(ms) || ms <= 0) {
          res.status(400).json({ error: 'Invalid interval value' });
          return;
        }
        next_run = new Date(Date.now() + ms).toISOString();
      } else if (effectiveScheduleType === 'once') {
        const scheduled = new Date(effectiveScheduleValue);
        if (isNaN(scheduled.getTime())) {
          res.status(400).json({ error: 'Invalid date' });
          return;
        }
        next_run = scheduled.toISOString();
      } else {
        res.status(400).json({
          error: 'Invalid schedule_type. Must be: cron, interval, or once',
        });
        return;
      }

      const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      createTask({
        id: taskId,
        group_folder,
        chat_jid: '', // Will be resolved by scheduler
        prompt,
        schedule_type: effectiveScheduleType,
        schedule_value: effectiveScheduleValue,
        context_mode: context_mode || 'isolated',
        next_run,
        status: 'active',
        created_at: new Date().toISOString(),
      });

      res.json({ data: { id: taskId } });
    } catch (err) {
      res.status(500).json({ error: 'Failed to create task' });
    }
  });

  // Update a task
  app.put('/api/tasks/:taskId', async (req, res) => {
    try {
      const { updateTask, getTaskById } = await import('./db.js');
      const { taskId } = req.params;

      const task = getTaskById(taskId);
      if (!task) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }

      const { prompt, schedule_type, schedule_value, status } = req.body;
      const updates: Record<string, any> = {};
      if (prompt !== undefined) updates.prompt = prompt;
      if (schedule_type !== undefined) updates.schedule_type = schedule_type;
      if (schedule_value !== undefined) updates.schedule_value = schedule_value;
      if (status !== undefined) updates.status = status;

      // Recalculate next_run if schedule changed
      if (schedule_type || schedule_value) {
        const type = schedule_type || task.schedule_type;
        const value = schedule_value || task.schedule_value;

        if (type === 'cron') {
          const { CronExpressionParser } = await import('cron-parser');
          try {
            const interval = CronExpressionParser.parse(value);
            updates.next_run = interval.next().toISOString();
          } catch {
            res.status(400).json({ error: 'Invalid cron expression' });
            return;
          }
        } else if (type === 'interval') {
          const ms = parseInt(value, 10);
          if (!isNaN(ms) && ms > 0) {
            updates.next_run = new Date(Date.now() + ms).toISOString();
          }
        }
      }

      updateTask(taskId, updates);
      res.json({ data: { success: true } });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update task' });
    }
  });

  // Delete a task
  app.delete('/api/tasks/:taskId', async (req, res) => {
    try {
      const { deleteTask, getTaskById } = await import('./db.js');
      const { taskId } = req.params;

      const task = getTaskById(taskId);
      if (!task) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }

      deleteTask(taskId);
      res.json({ data: { success: true } });
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete task' });
    }
  });

  // Update task status (pause/resume)
  app.put('/api/tasks/:taskId/status', async (req, res) => {
    try {
      const { updateTask, getTaskById } = await import('./db.js');
      const { taskId } = req.params;
      const { status } = req.body;

      if (!['active', 'paused'].includes(status)) {
        res.status(400).json({ error: 'Status must be: active or paused' });
        return;
      }

      const task = getTaskById(taskId);
      if (!task) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }

      updateTask(taskId, { status });
      res.json({ data: { success: true } });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update task status' });
    }
  });

  // Get task run logs
  app.get('/api/tasks/:taskId/runs', async (req, res) => {
    try {
      const { getTaskRunLogs } = await import('./db.js');
      const { taskId } = req.params;
      const limit = parseInt(req.query.limit as string) || 10;

      res.json({ data: getTaskRunLogs(taskId, limit) });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch task runs' });
    }
  });

  // ================================================================
  // REST API: Logs
  // ================================================================
  app.get('/api/logs', (_req, res) => {
    res.json({ data: getLogBuffer() });
  });

  app.get('/api/logs/container/:group', (req, res) => {
    const { group } = req.params;
    if (!validateFolder(group)) {
      res.status(400).json({ error: 'Invalid group folder' });
      return;
    }
    const logsDir = path.join(GROUPS_DIR, group, 'logs');
    try {
      if (!fs.existsSync(logsDir)) {
        res.json({ data: [] });
        return;
      }
      const files = fs
        .readdirSync(logsDir)
        .filter((f) => f.endsWith('.log'))
        .sort()
        .reverse();
      res.json({ data: files });
    } catch {
      res.status(500).json({ error: 'Failed to list container logs' });
    }
  });

  app.get('/api/logs/container/:group/:file', (req, res) => {
    const { group, file } = req.params;
    if (!validateFolder(group) || !SAFE_FILE_RE.test(file)) {
      res.status(400).json({ error: 'Invalid parameters' });
      return;
    }
    const filePath = path.join(GROUPS_DIR, group, 'logs', file);
    // Double-check path is within expected directory
    if (
      !path
        .resolve(filePath)
        .startsWith(path.resolve(path.join(GROUPS_DIR, group, 'logs')))
    ) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    try {
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: 'Log file not found' });
        return;
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      res.json({ data: { content } });
    } catch {
      res.status(500).json({ error: 'Failed to read log file' });
    }
  });

  // ================================================================
  // REST API: Prompt & Memory
  // ================================================================
  app.get('/api/prompt/:groupFolder', (req, res) => {
    const { groupFolder } = req.params;
    if (!validateFolder(groupFolder)) {
      res.status(400).json({ error: 'Invalid group folder' });
      return;
    }
    const filePath = path.join(GROUPS_DIR, groupFolder, 'GEMINI.md');
    try {
      if (!fs.existsSync(filePath)) {
        res.json({ data: { content: '', mtime: 0 } });
        return;
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      const stat = fs.statSync(filePath);
      res.json({ data: { content, mtime: stat.mtimeMs } });
    } catch {
      res.status(500).json({ error: 'Failed to read prompt' });
    }
  });

  app.put('/api/prompt/:groupFolder', (req, res) => {
    const { groupFolder } = req.params;
    if (!validateFolder(groupFolder)) {
      res.status(400).json({ error: 'Invalid group folder' });
      return;
    }
    const { content, expectedMtime } = req.body;
    if (typeof content !== 'string') {
      res.status(400).json({ error: 'Content is required' });
      return;
    }
    const filePath = path.join(GROUPS_DIR, groupFolder, 'GEMINI.md');
    const groupDir = path.join(GROUPS_DIR, groupFolder);
    try {
      // Optimistic locking: check mtime
      if (expectedMtime && fs.existsSync(filePath)) {
        const currentMtime = fs.statSync(filePath).mtimeMs;
        if (Math.abs(currentMtime - expectedMtime) > 1) {
          res.status(409).json({
            error:
              'File was modified by another process. Please reload and try again.',
          });
          return;
        }
      }
      fs.mkdirSync(groupDir, { recursive: true });
      fs.writeFileSync(filePath, content, 'utf-8');
      const newStat = fs.statSync(filePath);
      res.json({ data: { mtime: newStat.mtimeMs } });
    } catch {
      res.status(500).json({ error: 'Failed to save prompt' });
    }
  });

  app.get('/api/memory/:groupFolder', async (req, res) => {
    const { groupFolder } = req.params;
    if (!validateFolder(groupFolder)) {
      res.status(400).json({ error: 'Invalid group folder' });
      return;
    }
    try {
      const { getMemorySummary } = await import('./db.js');
      const summary = getMemorySummary(groupFolder);
      res.json({ data: summary ?? null });
    } catch {
      res.status(500).json({ error: 'Failed to fetch memory' });
    }
  });

  // Get user preferences for a group
  app.get('/api/groups/:folder/preferences', async (req, res) => {
    const folder = req.params.folder;
    if (!SAFE_FOLDER_RE.test(folder)) {
      res.status(400).json({ error: 'Invalid folder' });
      return;
    }
    try {
      const db = await import('./db.js');
      const prefs = db.getPreferences(folder);
      res.json({ data: prefs });
    } catch {
      res.status(500).json({ error: 'Failed to fetch preferences' });
    }
  });

  // Set a user preference for a group
  app.put('/api/groups/:folder/preferences', async (req, res) => {
    const folder = req.params.folder;
    if (!SAFE_FOLDER_RE.test(folder)) {
      res.status(400).json({ error: 'Invalid folder' });
      return;
    }
    const { key, value } = req.body;
    if (!key || typeof key !== 'string') {
      res.status(400).json({ error: 'Key required' });
      return;
    }
    // Only allow specific preference keys
    const ALLOWED_KEYS = ['language', 'nickname', 'response_style', 'interests', 'timezone', 'custom_instructions'];
    if (!ALLOWED_KEYS.includes(key)) {
      res.status(400).json({ error: `Invalid key. Allowed: ${ALLOWED_KEYS.join(', ')}` });
      return;
    }
    try {
      const db = await import('./db.js');
      db.setPreference(folder, key, String(value));
      res.json({ data: { key, value } });
    } catch {
      res.status(500).json({ error: 'Failed to save preference' });
    }
  });

  // ================================================================
  // REST API: Search
  // ================================================================
  app.get('/api/search', async (req, res) => {
    try {
      const q = req.query.q as string;
      const group = req.query.group as string | undefined;
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = parseInt(req.query.offset as string) || 0;

      if (!q || q.trim().length === 0) {
        res.status(400).json({ error: 'Query parameter "q" is required' });
        return;
      }

      const { searchMessages } = await import('./search.js');
      const { getDatabase } = await import('./db.js');
      const db = getDatabase();
      const results = searchMessages(db, q, { group, limit, offset });
      res.json({ data: results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ================================================================
  // REST API: Knowledge Base
  // ================================================================
  app.get('/api/groups/:folder/knowledge', async (req, res) => {
    const { folder } = req.params;
    if (!validateFolder(folder)) {
      res.status(400).json({ error: 'Invalid folder' });
      return;
    }

    try {
      const { getKnowledgeDocs } = await import('./knowledge.js');
      const { getDatabase } = await import('./db.js');
      const db = getDatabase();
      const docs = getKnowledgeDocs(db, folder);
      res.json({ data: docs });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/groups/:folder/knowledge', async (req, res) => {
    const { folder } = req.params;
    if (!validateFolder(folder)) {
      res.status(400).json({ error: 'Invalid folder' });
      return;
    }

    const { filename, title, content } = req.body;
    if (!filename || !title || typeof content !== 'string') {
      res.status(400).json({ error: 'Missing or invalid fields: filename, title, content required' });
      return;
    }

    if (!/^[a-zA-Z0-9_-]+\.md$/.test(filename)) {
      res.status(400).json({ error: 'Invalid filename: must match [a-zA-Z0-9_-]+.md' });
      return;
    }

    try {
      const { addKnowledgeDoc } = await import('./knowledge.js');
      const { getDatabase } = await import('./db.js');
      const db = getDatabase();
      const doc = addKnowledgeDoc(db, folder, filename, title, content);
      res.json({ data: doc });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/groups/:folder/knowledge/search', async (req, res) => {
    const { folder } = req.params;
    const { q } = req.query;
    if (!validateFolder(folder)) {
      res.status(400).json({ error: 'Invalid folder' });
      return;
    }

    if (!q || typeof q !== 'string') {
      res.status(400).json({ error: 'Missing or invalid query parameter: q' });
      return;
    }

    try {
      const { searchKnowledge } = await import('./knowledge.js');
      const { getDatabase } = await import('./db.js');
      const db = getDatabase();
      const results = searchKnowledge(db, q, folder);
      res.json({ data: results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/groups/:folder/knowledge/:docId', async (req, res) => {
    const { folder, docId } = req.params;
    if (!validateFolder(folder)) {
      res.status(400).json({ error: 'Invalid folder' });
      return;
    }

    try {
      const { getKnowledgeDoc } = await import('./knowledge.js');
      const { getDatabase } = await import('./db.js');
      const db = getDatabase();
      const doc = getKnowledgeDoc(db, parseInt(docId, 10));
      if (!doc || doc.group_folder !== folder) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }
      res.json({ data: doc });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/groups/:folder/knowledge/:docId', async (req, res) => {
    const { folder, docId } = req.params;
    const { title, content } = req.body;
    if (!validateFolder(folder)) {
      res.status(400).json({ error: 'Invalid folder' });
      return;
    }

    if (!title || typeof content !== 'string') {
      res.status(400).json({ error: 'Missing or invalid fields: title, content required' });
      return;
    }

    try {
      const { getKnowledgeDoc, updateKnowledgeDoc } = await import('./knowledge.js');
      const { getDatabase } = await import('./db.js');
      const db = getDatabase();
      const doc = getKnowledgeDoc(db, parseInt(docId, 10));
      if (!doc || doc.group_folder !== folder) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }
      const updated = updateKnowledgeDoc(db, parseInt(docId, 10), title, content);
      res.json({ data: updated });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/groups/:folder/knowledge/:docId', async (req, res) => {
    const { folder, docId } = req.params;
    if (!validateFolder(folder)) {
      res.status(400).json({ error: 'Invalid folder' });
      return;
    }

    try {
      const { getKnowledgeDoc, deleteKnowledgeDoc } = await import('./knowledge.js');
      const { getDatabase } = await import('./db.js');
      const db = getDatabase();
      const doc = getKnowledgeDoc(db, parseInt(docId, 10));
      if (!doc || doc.group_folder !== folder) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }
      deleteKnowledgeDoc(db, parseInt(docId, 10));
      res.json({ data: { success: true } });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ================================================================
  // REST API: Calendar
  // ================================================================
  app.get('/api/calendar/configs', async (_req, res) => {
    try {
      const { getCalendarConfigs } = await import('./google-calendar.js');
      const configs = getCalendarConfigs();
      res.json({ data: configs });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/calendar/configs', async (req, res) => {
    try {
      const { url, name } = req.body;
      if (!url || !name || typeof url !== 'string' || typeof name !== 'string') {
        res.status(400).json({ error: 'Missing or invalid fields: url and name required' });
        return;
      }
      const { saveCalendarConfig } = await import('./google-calendar.js');
      saveCalendarConfig({ url, name });
      res.json({ data: { success: true } });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/calendar/configs', async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== 'string') {
        res.status(400).json({ error: 'Missing or invalid field: url required' });
        return;
      }
      const { removeCalendarConfig } = await import('./google-calendar.js');
      const removed = removeCalendarConfig(url);
      res.json({ data: { removed } });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/calendar/events', async (req, res) => {
    try {
      const { getCalendarConfigs, fetchCalendarEvents } = await import('./google-calendar.js');
      const days = parseInt(req.query.days as string) || 7;
      const configs = getCalendarConfigs();

      const allEvents = [];
      for (const config of configs) {
        try {
          const events = await fetchCalendarEvents(config, days);
          allEvents.push(...events);
        } catch (err) {
          logger.warn({ config: config.name, err }, 'Failed to fetch calendar events');
        }
      }

      // Sort by start time
      allEvents.sort((a, b) => a.start.getTime() - b.start.getTime());

      res.json({ data: allEvents });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ================================================================
  // REST API: Skills
  // ================================================================
  app.get('/api/skills', async (_req, res) => {
    try {
      const { scanAvailableSkills } = await import('./skills.js');
      const skillsDir = path.join(GROUPS_DIR, '..', 'container', 'skills');
      const skills = scanAvailableSkills(skillsDir);
      res.json({ data: skills });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/groups/:folder/skills', async (req, res) => {
    const { folder } = req.params;
    if (!validateFolder(folder)) {
      res.status(400).json({ error: 'Invalid folder' });
      return;
    }
    try {
      const { getGroupSkills } = await import('./skills.js');
      const skillIds = getGroupSkills(folder);
      res.json({ data: skillIds });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/groups/:folder/skills', async (req, res) => {
    const { folder } = req.params;
    if (!validateFolder(folder)) {
      res.status(400).json({ error: 'Invalid folder' });
      return;
    }
    const { skillId, enabled } = req.body;
    if (!skillId || typeof skillId !== 'string' || typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'Missing or invalid fields: skillId (string) and enabled (boolean) required' });
      return;
    }
    try {
      const { enableGroupSkill, disableGroupSkill } = await import('./skills.js');
      if (enabled) {
        enableGroupSkill(folder, skillId);
      } else {
        disableGroupSkill(folder, skillId);
      }
      res.json({ data: { success: true } });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ================================================================
  // REST API: Conversation Export
  // ================================================================
  app.get('/api/groups/:folder/export', async (req, res) => {
    const { folder } = req.params;
    if (!validateFolder(folder)) {
      res.status(400).json({ error: 'Invalid folder' });
      return;
    }

    try {
      const { getConversationExport, formatExportAsMarkdown } = await import('./db.js');
      const format = (req.query.format as string) || 'json';
      const since = req.query.since as string | undefined;

      // Resolve chatJid from folder using the injected resolver
      if (!chatJidResolver) {
        res.status(503).json({ error: 'Chat resolver not available' });
        return;
      }
      const chatJid = chatJidResolver(folder);
      if (!chatJid) {
        res.status(404).json({ error: 'Could not resolve chat for this group' });
        return;
      }

      const exportData = getConversationExport(chatJid, since);

      if (format === 'md' || format === 'markdown') {
        const md = formatExportAsMarkdown(exportData);
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${folder}-export.md"`);
        res.send(md);
      } else {
        res.json({ data: exportData });
      }
    } catch (err) {
      res.status(500).json({ error: 'Failed to export conversation' });
    }
  });

  // ================================================================
  // REST API: Config
  // ================================================================
  app.get('/api/config', async (_req, res) => {
    try {
      const { isMaintenanceMode } = await import('./maintenance.js');
      const currentLogLevel = process.env.LOG_LEVEL || 'info';

      res.json({
        data: {
          maintenanceMode: isMaintenanceMode(),
          logLevel: currentLogLevel,
          dashboardHost: DASHBOARD_HOST,
          dashboardPort: DASHBOARD_PORT,
          uptime: process.uptime(),
          connectedClients: io ? io.engine.clientsCount : 0,
          authRequired: !!process.env.DASHBOARD_ACCESS_CODE,
        },
      });
    } catch {
      res.status(500).json({ error: 'Failed to fetch config' });
    }
  });

  app.put('/api/config', async (req, res) => {
    try {
      const { maintenanceMode, logLevel } = req.body;
      const { setMaintenanceMode, isMaintenanceMode } =
        await import('./maintenance.js');

      if (typeof maintenanceMode === 'boolean') {
        setMaintenanceMode(maintenanceMode);
        logger.info(
          { maintenanceMode },
          'Maintenance mode updated via dashboard',
        );
      }

      if (typeof logLevel === 'string') {
        setLogLevel(logLevel);
        // Update process.env so GET /api/config reflects the change
        process.env.LOG_LEVEL = logLevel;
        logger.info({ logLevel }, 'Log level updated via dashboard');
      }

      res.json({
        data: {
          maintenanceMode: isMaintenanceMode(),
          logLevel: process.env.LOG_LEVEL || 'info',
        },
      });
    } catch {
      res.status(500).json({ error: 'Failed to update config' });
    }
  });

  app.get('/api/config/secrets', (_req, res) => {
    const secretKeys = [
      'GEMINI_API_KEY',
      'TELEGRAM_BOT_TOKEN',
      'WEBHOOK_URL',
      'DASHBOARD_API_KEY',
    ];

    const secrets = secretKeys.map((key) => {
      const value = process.env[key];
      return {
        key,
        configured: !!value,
        masked: value ? '***' + value.slice(-4) : null,
      };
    });

    res.json({ data: secrets });
  });

  // ================================================================
  // REST API: Errors
  // ================================================================
  app.get('/api/errors', async (_req, res) => {
    try {
      const { getAllErrorStates } = await import('./db.js');
      res.json({ data: getAllErrorStates() });
    } catch {
      res.status(500).json({ error: 'Failed to fetch errors' });
    }
  });

  app.post('/api/errors/clear', async (_req, res) => {
    try {
      const { getAllErrorStates, resetErrors } = await import('./db.js');
      const errors = getAllErrorStates();
      for (const e of errors) {
        resetErrors(e.group);
      }
      logger.info('All error states cleared via dashboard');
      res.json({ data: { cleared: errors.length } });
    } catch {
      res.status(500).json({ error: 'Failed to clear errors' });
    }
  });

  // ================================================================
  // REST API: Usage
  // ================================================================
  app.get('/api/usage', async (_req, res) => {
    try {
      const { getUsageStats } = await import('./db.js');
      res.json({ data: getUsageStats() });
    } catch {
      res.status(500).json({ error: 'Failed to fetch usage' });
    }
  });

  app.get('/api/usage/recent', async (_req, res) => {
    try {
      const { getRecentUsage } = await import('./db.js');
      res.json({ data: getRecentUsage() });
    } catch {
      res.status(500).json({ error: 'Failed to fetch recent usage' });
    }
  });

  // Usage timeseries
  app.get('/api/usage/timeseries', async (req, res) => {
    try {
      const { getUsageTimeseries } = await import('./db.js');
      const period = (req.query.period as string) || '7d';
      const granularity = (req.query.granularity as string) || 'day';
      const groupFolder = req.query.groupFolder as string | undefined;

      if (groupFolder && !validateFolder(groupFolder)) {
        res.status(400).json({ error: 'Invalid group folder' });
        return;
      }

      res.json({ data: getUsageTimeseries(period, granularity, groupFolder) });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch usage timeseries' });
    }
  });

  // Usage by group
  app.get('/api/usage/groups', async (req, res) => {
    try {
      const { getUsageByGroup } = await import('./db.js');
      const since = req.query.since as string | undefined;

      res.json({ data: getUsageByGroup(since) });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch usage by group' });
    }
  });

  // ================================================================
  // Static file serving (production dashboard)
  // ================================================================
  const dashboardDist = path.resolve(process.cwd(), 'dashboard', 'dist');
  if (fs.existsSync(dashboardDist)) {
    app.use(express.static(dashboardDist));
    // SPA fallback: serve index.html for all non-API routes
    app.get('{*path}', (_req, res) => {
      res.sendFile(path.join(dashboardDist, 'index.html'));
    });
    logger.info({ path: dashboardDist }, 'Serving dashboard static files');
  }

  // ================================================================
  // Start Listener
  // ================================================================

  // LAN access: auto-detect IP and add to allowed origins
  if (DASHBOARD_HOST === '0.0.0.0') {
    const lanIp = getLanIp();
    if (lanIp) {
      const lanOrigin = `http://${lanIp}:${DASHBOARD_PORT}`;
      if (!ALLOWED_ORIGINS.includes(lanOrigin)) {
        ALLOWED_ORIGINS.push(lanOrigin);
      }
      console.log(`\n🌐 LAN URL: ${lanOrigin}`);
    }
  }

  server.listen(DASHBOARD_PORT, DASHBOARD_HOST, () => {
    console.log(
      `\n🌐 Dashboard Server running at http://${DASHBOARD_HOST}:${DASHBOARD_PORT}`,
    );
    logger.info(
      { port: DASHBOARD_PORT, host: DASHBOARD_HOST },
      'Dashboard server started',
    );
  });

  return { app, io };
}

/**
 * Stop the dashboard server gracefully
 */
export function stopDashboardServer(): void {
  if (io) {
    io.close();
  }
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
  logger.info('Dashboard server stopped');
}

/**
 * Inject the data source for groups
 */
export function setGroupsProvider(provider: () => any[]) {
  groupsProvider = provider;
}

/**
 * Inject the group registration function
 */
export function setGroupRegistrar(fn: (chatId: string, name: string) => any) {
  groupRegistrar = fn;
}

/**
 * Inject the group update function
 */
export function setGroupUpdater(
  fn: (folder: string, updates: Record<string, any>) => any,
) {
  groupUpdater = fn;
}

/**
 * Inject the chatJid resolver function
 */
export function setChatJidResolver(fn: (folder: string) => string | null) {
  chatJidResolver = fn;
}

/**
 * Emit a real-time event to the dashboard
 */
export function emitDashboardEvent(event: string, data: any) {
  if (io) {
    io.emit(event, data);
  }
}
