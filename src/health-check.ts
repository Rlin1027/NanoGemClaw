/**
 * Health Check HTTP Server
 * 
 * Provides /health and /ready endpoints for container orchestration
 * and external monitoring systems.
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { HEALTH_CHECK } from './config.js';
import { logger } from './logger.js';

// ============================================================================
// Types
// ============================================================================

interface HealthStatus {
    status: 'healthy' | 'degraded' | 'unhealthy';
    uptime: number;
    memory: {
        heapUsed: number;
        heapTotal: number;
        rss: number;
    };
    groups: number;
    version: string;
    timestamp: string;
}

// ============================================================================
// State (injected at startup)
// ============================================================================

let getGroupCount: () => number = () => 0;
let getActiveContainers: () => number = () => 0;

export function setHealthCheckDependencies(deps: {
    getGroupCount: () => number;
    getActiveContainers?: () => number;
}): void {
    getGroupCount = deps.getGroupCount;
    if (deps.getActiveContainers) {
        getActiveContainers = deps.getActiveContainers;
    }
}

// ============================================================================
// Health Status
// ============================================================================

function getHealthStatus(): HealthStatus {
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    const heapUsedPercent = memUsage.heapUsed / memUsage.heapTotal;

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (heapUsedPercent > 0.95) {
        status = 'unhealthy';
    } else if (heapUsedPercent > 0.85) {
        status = 'degraded';
    }

    return {
        status,
        uptime: process.uptime(),
        memory: {
            heapUsed: heapUsedMB,
            heapTotal: heapTotalMB,
            rss: Math.round(memUsage.rss / 1024 / 1024),
        },
        groups: getGroupCount(),
        version: process.env.npm_package_version || '1.0.0',
        timestamp: new Date().toISOString(),
    };
}

// ============================================================================
// HTTP Server
// ============================================================================

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url || '/';

    // CORS headers for browser access
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    if (url === '/health' || url === '/healthz') {
        const health = getHealthStatus();
        res.statusCode = health.status === 'healthy' ? 200 : 503;
        res.end(JSON.stringify(health, null, 2));
    } else if (url === '/ready' || url === '/readyz') {
        // Readiness check - are we ready to accept traffic?
        const ready = getGroupCount() > 0;
        res.statusCode = ready ? 200 : 503;
        res.end(JSON.stringify({
            ready,
            groups: getGroupCount(),
            activeContainers: getActiveContainers(),
        }));
    } else if (url === '/metrics') {
        // Prometheus-style metrics
        const health = getHealthStatus();
        res.setHeader('Content-Type', 'text/plain');
        res.end(`# HELP nanogemclaw_uptime_seconds Application uptime
# TYPE nanogemclaw_uptime_seconds gauge
nanogemclaw_uptime_seconds ${health.uptime.toFixed(0)}

# HELP nanogemclaw_memory_heap_bytes Heap memory used
# TYPE nanogemclaw_memory_heap_bytes gauge
nanogemclaw_memory_heap_bytes ${health.memory.heapUsed * 1024 * 1024}

# HELP nanogemclaw_groups_total Number of registered groups
# TYPE nanogemclaw_groups_total gauge
nanogemclaw_groups_total ${health.groups}
`);
    } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Not found' }));
    }
}

let server: ReturnType<typeof createServer> | null = null;

export function startHealthCheckServer(): void {
    if (!HEALTH_CHECK.ENABLED) {
        logger.info('Health check server disabled');
        return;
    }

    server = createServer(handleRequest);

    server.listen(HEALTH_CHECK.PORT, () => {
        logger.info(
            { port: HEALTH_CHECK.PORT },
            'Health check server started',
        );
    });

    server.on('error', (err) => {
        logger.error({ err }, 'Health check server error');
    });
}

export function stopHealthCheckServer(): Promise<void> {
    return new Promise((resolve) => {
        if (server) {
            server.close(() => {
                logger.info('Health check server stopped');
                resolve();
            });
        } else {
            resolve();
        }
    });
}
