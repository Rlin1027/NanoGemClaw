import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger, logEmitter, getLogBuffer } from './logger.js';
import { safeCompare } from './utils/safe-compare.js';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
} from './socket-events.js';
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
let groupsProvider: () => DashboardGroup[] = () => [];
let groupRegistrar: ((chatId: string, name: string) => DashboardGroup) | null =
  null;
let groupUpdater:
  | ((folder: string, updates: Record<string, any>) => DashboardGroup | null)
  | null = null;
let chatJidResolver: ((folder: string) => string | null) | null = null;

// Path traversal protection
const SAFE_FOLDER_RE = /^[a-zA-Z0-9_-]+$/;

function validateFolder(folder: string): boolean {
  return SAFE_FOLDER_RE.test(folder);
}

/**
 * Validate numeric parameter (docId, taskId, chatId, etc.)
 * Returns parsed number or null if invalid
 */
function validateNumericParam(value: string, name: string): number | null {
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 0) return null;
  return num;
}

/**
 * Validate request body has required fields
 * Returns error message or null if valid
 */
function validateBody(body: unknown, requiredFields: string[]): string | null {
  if (!body || typeof body !== 'object') return 'Invalid request body';
  const bodyObj = body as Record<string, unknown>;
  for (const field of requiredFields) {
    if (bodyObj[field] === undefined) return `Missing required field: ${field}`;
  }
  return null;
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
  app.use(express.json({ limit: '1mb' }));

  // Rate limiting
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 requests/min
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
  });

  const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10, // 10 requests/min
    message: { error: 'Too many authentication attempts' },
  });

  // Apply rate limiting to all API routes
  app.use('/api', apiLimiter);
  app.use('/api/auth', authLimiter);

  // Authentication
  const ACCESS_CODE = process.env.DASHBOARD_ACCESS_CODE;

  // Mount auth router BEFORE global auth middleware
  app.use('/api', createAuthRouter({ accessCode: ACCESS_CODE }));

  // Public endpoints that don't require authentication
  const PUBLIC_PATHS = ['/api/health', '/api/auth/verify'];

  // Global Auth Middleware - protect all API endpoints when auth is enabled
  app.use('/api', (req, res, next) => {
    // Skip auth for public endpoints
    if (PUBLIC_PATHS.includes(req.path)) return next();

    // If neither auth method is configured, allow all requests
    if (!ACCESS_CODE && !DASHBOARD_API_KEY) {
      return next();
    }

    // OR logic: authenticated if either credential matches
    let authenticated = false;

    if (ACCESS_CODE) {
      const code = req.headers['x-access-code'];
      if (safeCompare(String(code || ''), ACCESS_CODE)) {
        authenticated = true;
      }
    }

    if (!authenticated && DASHBOARD_API_KEY) {
      const apiKey = req.headers['x-api-key'];
      if (safeCompare(String(apiKey || ''), DASHBOARD_API_KEY)) {
        authenticated = true;
      }
    }

    if (!authenticated) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    next();
  });

  // Socket.io Setup
  io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
    cors: {
      origin: ALLOWED_ORIGINS,
      methods: ['GET', 'POST'],
    },
  });

  // Socket.io authentication - check both ACCESS_CODE and API key
  if (DASHBOARD_API_KEY || ACCESS_CODE) {
    io.use((socket, next) => {
      if (ACCESS_CODE) {
        const code = String(socket.handshake.auth?.accessCode || '');
        if (!safeCompare(code, ACCESS_CODE)) {
          next(new Error('Authentication required'));
          return;
        }
      }
      if (DASHBOARD_API_KEY) {
        const token = String(socket.handshake.auth?.token || '');
        if (!safeCompare(token, DASHBOARD_API_KEY)) {
          next(new Error('Authentication required'));
          return;
        }
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
    const onLog = (entry: unknown) => {
      socket.emit('logs:entry', entry);
    };
    logEmitter.on('log', onLog);

    socket.on('disconnect', () => {
      logEmitter.removeListener('log', onLog);
      logger.info({ socketId: socket.id }, 'Dashboard client disconnected');
    });
  });

  // ================================================================
  // Mount Route Modules
  // ================================================================
  app.use(
    '/api',
    createConfigRouter({
      dashboardHost: DASHBOARD_HOST,
      dashboardPort: DASHBOARD_PORT,
      getConnectedClients: () => (io ? io.engine.clientsCount : 0),
      accessCode: ACCESS_CODE,
    }),
  );

  app.use(
    '/api',
    createGroupsRouter({
      groupsProvider: () => groupsProvider(),
      get groupRegistrar() {
        return groupRegistrar;
      },
      get groupUpdater() {
        return groupUpdater;
      },
      get chatJidResolver() {
        return chatJidResolver;
      },
      validateFolder,
      validateNumericParam,
      emitDashboardEvent,
    }),
  );

  app.use(
    '/api',
    createTasksRouter({
      validateFolder,
      validateNumericParam,
    }),
  );

  app.use(
    '/api',
    createKnowledgeRouter({
      validateFolder,
      validateNumericParam,
    }),
  );

  app.use(
    '/api',
    createCalendarRouter({
      validateNumericParam,
    }),
  );

  app.use(
    '/api',
    createSkillsRouter({
      validateFolder,
    }),
  );

  app.use(
    '/api',
    createAnalyticsRouter({
      validateFolder,
    }),
  );

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
export function setGroupsProvider(provider: () => DashboardGroup[]) {
  groupsProvider = provider;
}

/**
 * Inject the group registration function
 */
export function setGroupRegistrar(
  fn: (chatId: string, name: string) => DashboardGroup,
) {
  groupRegistrar = fn;
}

/**
 * Inject the group update function
 */
export function setGroupUpdater(
  fn: (folder: string, updates: Record<string, any>) => DashboardGroup | null,
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
export function emitDashboardEvent(event: string, data: unknown) {
  if (io) {
    io.emit(event, data);
  }
}
