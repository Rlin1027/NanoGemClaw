
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { logger } from './logger.js';

// Configuration
const DASHBOARD_PORT = 3000;
const ALLOWED_ORIGINS = (process.env.DASHBOARD_ORIGINS || 'http://localhost:5173,http://localhost:3001').split(',').map(s => s.trim());
const DASHBOARD_HOST = process.env.DASHBOARD_HOST || '127.0.0.1';
const DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY;

// Application State
let io: Server;
let httpServer: ReturnType<typeof createServer> | null = null;
let groupsProvider: () => any[] = () => [];

/**
 * Initialize the Web Dashboard Server
 * - Express: Serves the static assets and API endpoints
 * - Socket.io: Handles real-time logs and status updates
 */
export function startDashboardServer() {
    const app = express();
    const server = createServer(app);
    httpServer = server;

    // Middleware
    app.use(cors({
        origin: (origin, callback) => {
            // Allow requests with no origin (like mobile apps or curl)
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

    io.on('connection', (socket) => {
        logger.info({ socketId: socket.id }, 'Dashboard client connected');

        // Send initial state on connection
        socket.emit('groups:update', groupsProvider());

        socket.on('disconnect', () => {
            logger.info({ socketId: socket.id }, 'Dashboard client disconnected');
        });
    });

    // REST API: Health Check
    app.get('/api/health', (req, res) => {
        res.json({ status: 'ok', uptime: process.uptime() });
    });

    // REST API: Groups
    app.get('/api/groups', (req, res) => {
        const groups = groupsProvider ? groupsProvider() : [];
        res.json({ groups });
    });

    // Start Listener
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
 * Emit a real-time event to the dashboard
 */
export function emitDashboardEvent(event: string, data: any) {
    if (io) {
        io.emit(event, data);
    }
}
