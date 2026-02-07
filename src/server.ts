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
const ALLOWED_ORIGINS = (process.env.DASHBOARD_ORIGINS || `http://localhost:${DASHBOARD_PORT},http://127.0.0.1:${DASHBOARD_PORT},http://localhost:5173,http://localhost:3001`).split(',').map(s => s.trim());
const DASHBOARD_HOST = process.env.DASHBOARD_HOST || '127.0.0.1';
const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY;

// Application State
let io: Server;
let httpServer: ReturnType<typeof createServer> | null = null;
let groupsProvider: () => any[] = () => [];
let groupRegistrar: ((chatId: string, name: string) => any) | null = null;

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
    app.use(cors({
        origin: (origin, callback) => {
            if (!origin || ALLOWED_ORIGINS.includes(origin)) {
                callback(null, true);
            } else {
                callback(new Error('Not allowed by CORS'));
            }
        }
    }));
    app.use(express.json());

    // Optional API key authentication
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
            methods: ["GET", "POST"]
        }
    });

    // Optional Socket.io API key authentication
    if (DASHBOARD_API_KEY) {
        io.use((socket, next) => {
            const token = socket.handshake.auth?.token || socket.handshake.query?.apiKey;
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

    app.get('/api/tasks/:groupFolder', async (req, res) => {
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
            const files = fs.readdirSync(logsDir)
                .filter(f => f.endsWith('.log'))
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
        if (!path.resolve(filePath).startsWith(path.resolve(path.join(GROUPS_DIR, group, 'logs')))) {
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
                    res.status(409).json({ error: 'File was modified by another process. Please reload and try again.' });
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
                }
            });
        } catch {
            res.status(500).json({ error: 'Failed to fetch config' });
        }
    });

    app.put('/api/config', async (req, res) => {
        try {
            const { maintenanceMode, logLevel } = req.body;
            const { setMaintenanceMode, isMaintenanceMode } = await import('./maintenance.js');

            if (typeof maintenanceMode === 'boolean') {
                setMaintenanceMode(maintenanceMode);
                logger.info({ maintenanceMode }, 'Maintenance mode updated via dashboard');
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
                }
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

        const secrets = secretKeys.map(key => {
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
        console.log(`\n🌐 Dashboard Server running at http://${DASHBOARD_HOST}:${DASHBOARD_PORT}`);
        logger.info({ port: DASHBOARD_PORT, host: DASHBOARD_HOST }, 'Dashboard server started');
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
 * Emit a real-time event to the dashboard
 */
export function emitDashboardEvent(event: string, data: any) {
    if (io) {
        io.emit(event, data);
    }
}
