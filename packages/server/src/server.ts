import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger, logEmitter, getLogBuffer } from '@nanogemclaw/core/logger';
import { safeCompare } from '@nanogemclaw/core/safe-compare';
// Route modules
import { createAuthRouter } from './routes/auth.js';
import { createGroupsRouter } from './routes/groups.js';
import { createTasksRouter } from './routes/tasks.js';
import { createKnowledgeRouter } from './routes/knowledge.js';
import { createCalendarRouter } from './routes/calendar.js';
import { createSkillsRouter } from './routes/skills.js';
import { createConfigRouter } from './routes/config.js';
import { createAnalyticsRouter } from './routes/analytics.js';

/** API-layer group representation (subset of RegisteredGroup for dashboard responses) */
export interface DashboardGroup {
  id: string;
  folder: string;
  name: string;
  persona?: string;
  enableWebSearch?: boolean;
  requireTrigger?: boolean;
  geminiModel?: string;
  enableFastPath?: boolean;
  [key: string]: unknown; // Allow extra fields like status, messageCount, etc.
}

export interface ServerOptions {
  dashboardPort?: number;
  dashboardHost?: string;
  allowedOrigins?: string[];
  accessCode?: string;
  apiKey?: string;
  dashboardDistPath?: string;
  getGroups: () => DashboardGroup[];
  registerGroup?: ((chatId: string, name: string) => DashboardGroup) | null;
  updateGroup?: ((folder: string, updates: Record<string, any>) => DashboardGroup | null) | null;
  resolveChatJid?: ((folder: string) => string | null) | null;
  groupsDir: string;
}

// Path traversal protection
const SAFE_FOLDER_RE = /^[a-zA-Z0-9_-]+$/;

function validateFolder(folder: string): boolean {
  return SAFE_FOLDER_RE.test(folder);
}

function validateNumericParam(value: string, _name: string): number | null {
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 0) return null;
  return num;
}

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

export function createDashboardServer(options: ServerOptions) {
  const {
    dashboardPort = 3000,
    dashboardHost = '127.0.0.1',
    accessCode,
    apiKey,
    getGroups,
    registerGroup = null,
    updateGroup = null,
    resolveChatJid = null,
    groupsDir,
  } = options;

  const allowedOrigins = options.allowedOrigins ?? (
    process.env.DASHBOARD_ORIGINS ||
    `http://localhost:${dashboardPort},http://127.0.0.1:${dashboardPort},http://localhost:5173,http://localhost:3001`
  ).split(',').map((s) => s.trim());

  const dashboardDistPath = options.dashboardDistPath ?? path.resolve(process.cwd(), 'dashboard', 'dist');

  const app = express();
  const server = createServer(app);

  // Middleware
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  // Rate limiting
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
  });

  const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { error: 'Too many authentication attempts' },
  });

  app.use('/api', apiLimiter);
  app.use('/api/auth', authLimiter);

  // Mount auth router BEFORE global auth middleware
  app.use('/api', createAuthRouter({ accessCode }));

  const PUBLIC_PATHS = ['/api/health', '/api/auth/verify'];

  // Global Auth Middleware
  app.use('/api', (req, res, next) => {
    if (PUBLIC_PATHS.includes(req.path)) return next();

    if (accessCode) {
      const code = req.headers['x-access-code'];
      if (!safeCompare(String(code || ''), accessCode)) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
    }

    if (apiKey) {
      const key = req.headers['x-api-key'];
      if (!safeCompare(String(key || ''), apiKey)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
    }

    next();
  });

  // Socket.io Setup
  const io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      methods: ['GET', 'POST'],
    },
  });

  if (apiKey || accessCode) {
    io.use((socket, next) => {
      if (accessCode) {
        const code = String(socket.handshake.auth?.accessCode || '');
        if (!safeCompare(code, accessCode)) {
          next(new Error('Authentication required'));
          return;
        }
      }
      if (apiKey) {
        const token = String(socket.handshake.auth?.token || '');
        if (!safeCompare(token, apiKey)) {
          next(new Error('Authentication required'));
          return;
        }
      }
      next();
    });
  }

  const emitDashboardEvent = (event: string, data: unknown) => {
    io.emit(event, data);
  };

  io.on('connection', (socket) => {
    logger.info({ socketId: socket.id }, 'Dashboard client connected');
    socket.emit('groups:update', getGroups());
    socket.emit('logs:history', getLogBuffer());

    const onLog = (entry: unknown) => {
      socket.emit('logs:entry', entry);
    };
    logEmitter.on('log', onLog);

    socket.on('disconnect', () => {
      logEmitter.removeListener('log', onLog);
      logger.info({ socketId: socket.id }, 'Dashboard client disconnected');
    });
  });

  // Mount Route Modules
  app.use('/api', createConfigRouter({
    dashboardHost,
    dashboardPort,
    getConnectedClients: () => io.engine.clientsCount,
    accessCode,
  }));

  app.use('/api', createGroupsRouter({
    groupsProvider: getGroups,
    get groupRegistrar() { return registerGroup; },
    get groupUpdater() { return updateGroup; },
    get chatJidResolver() { return resolveChatJid; },
    validateFolder,
    validateNumericParam,
    emitDashboardEvent,
    groupsDir,
  }));

  app.use('/api', createTasksRouter({
    validateFolder,
    validateNumericParam,
  }));

  app.use('/api', createKnowledgeRouter({
    validateFolder,
    validateNumericParam,
  }));

  app.use('/api', createCalendarRouter({
    validateNumericParam,
  }));

  app.use('/api', createSkillsRouter({
    validateFolder,
    groupsDir,
  }));

  app.use('/api', createAnalyticsRouter({
    validateFolder,
    groupsDir,
  }));

  // Static file serving (production dashboard)
  if (fs.existsSync(dashboardDistPath)) {
    app.use(express.static(dashboardDistPath));
    app.get('{*path}', (_req, res) => {
      res.sendFile(path.join(dashboardDistPath, 'index.html'));
    });
    logger.info({ path: dashboardDistPath }, 'Serving dashboard static files');
  }

  function start() {
    const origins = [...allowedOrigins];

    if (dashboardHost === '0.0.0.0') {
      const lanIp = getLanIp();
      if (lanIp) {
        const lanOrigin = `http://${lanIp}:${dashboardPort}`;
        if (!origins.includes(lanOrigin)) {
          origins.push(lanOrigin);
        }
        console.log(`\n🌐 LAN URL: ${lanOrigin}`);
      }
    }

    server.listen(dashboardPort, dashboardHost, () => {
      console.log(`\n🌐 Dashboard Server running at http://${dashboardHost}:${dashboardPort}`);
      logger.info({ port: dashboardPort, host: dashboardHost }, 'Dashboard server started');
    });

    return { app, io };
  }

  function stop() {
    io.close();
    server.close();
    logger.info('Dashboard server stopped');
  }

  return { app, io, server, start, stop, emitDashboardEvent };
}
