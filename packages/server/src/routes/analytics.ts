import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { getLogBuffer } from '@nanogemclaw/core/logger';

const SAFE_FILE_RE = /^[a-zA-Z0-9_.-]+$/;

interface AnalyticsRouterDeps {
    validateFolder: (folder: string) => boolean;
    groupsDir: string;
}

export function createAnalyticsRouter(deps: AnalyticsRouterDeps): Router {
    const router = Router();
    const { validateFolder, groupsDir } = deps;

    // GET /api/logs
    router.get('/logs', (_req, res) => {
        res.json({ data: getLogBuffer() });
    });

    // GET /api/logs/container/:group
    router.get('/logs/container/:group', (req, res) => {
        const { group } = req.params;
        if (!validateFolder(group)) {
            res.status(400).json({ error: 'Invalid group folder' });
            return;
        }
        const logsDir = path.join(groupsDir, group, 'logs');
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

    // GET /api/logs/container/:group/:file
    router.get('/logs/container/:group/:file', (req, res) => {
        const { group, file } = req.params;
        if (!validateFolder(group) || !SAFE_FILE_RE.test(file)) {
            res.status(400).json({ error: 'Invalid parameters' });
            return;
        }
        const filePath = path.join(groupsDir, group, 'logs', file);
        if (
            !path
                .resolve(filePath)
                .startsWith(path.resolve(path.join(groupsDir, group, 'logs')))
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

    // GET /api/errors
    router.get('/errors', async (_req, res) => {
        try {
            const { getAllErrorStates } = await import('@nanogemclaw/db');
            res.json({ data: getAllErrorStates() });
        } catch {
            res.status(500).json({ error: 'Failed to fetch errors' });
        }
    });

    // POST /api/errors/clear
    router.post('/errors/clear', async (_req, res) => {
        try {
            const { getAllErrorStates, resetErrors } = await import('@nanogemclaw/db');
            const errors = getAllErrorStates();
            for (const e of errors) {
                resetErrors(e.group);
            }
            const { logger } = await import('@nanogemclaw/core/logger');
            logger.info('All error states cleared via dashboard');
            res.json({ data: { cleared: errors.length } });
        } catch {
            res.status(500).json({ error: 'Failed to clear errors' });
        }
    });

    // GET /api/usage
    router.get('/usage', async (_req, res) => {
        try {
            const { getUsageStats } = await import('@nanogemclaw/db');
            res.json({ data: getUsageStats() });
        } catch {
            res.status(500).json({ error: 'Failed to fetch usage' });
        }
    });

    // GET /api/usage/recent
    router.get('/usage/recent', async (_req, res) => {
        try {
            const { getRecentUsage } = await import('@nanogemclaw/db');
            res.json({ data: getRecentUsage() });
        } catch {
            res.status(500).json({ error: 'Failed to fetch recent usage' });
        }
    });

    // GET /api/usage/timeseries
    router.get('/usage/timeseries', async (req, res) => {
        try {
            const { getUsageTimeseries } = await import('@nanogemclaw/db');
            const period = (req.query.period as string) || '7d';
            const granularity = (req.query.granularity as string) || 'day';
            const groupFolder = req.query.groupFolder as string | undefined;

            if (groupFolder && !validateFolder(groupFolder)) {
                res.status(400).json({ error: 'Invalid group folder' });
                return;
            }

            res.json({ data: getUsageTimeseries(period, granularity, groupFolder) });
        } catch {
            res.status(500).json({ error: 'Failed to fetch usage timeseries' });
        }
    });

    // GET /api/usage/groups
    router.get('/usage/groups', async (req, res) => {
        try {
            const { getUsageByGroup } = await import('@nanogemclaw/db');
            const since = req.query.since as string | undefined;

            res.json({ data: getUsageByGroup(since) });
        } catch {
            res.status(500).json({ error: 'Failed to fetch usage by group' });
        }
    });

    // GET /api/analytics/timeseries
    router.get('/analytics/timeseries', async (req, res) => {
        try {
            const { getUsageTimeseriesDaily } = await import('@nanogemclaw/db');
            const days = parseInt(req.query.days as string) || 30;
            res.json({ data: getUsageTimeseriesDaily(days) });
        } catch {
            res.status(500).json({ error: 'Failed to fetch timeseries data' });
        }
    });

    // GET /api/analytics/token-ranking
    router.get('/analytics/token-ranking', async (req, res) => {
        try {
            const { getGroupTokenRanking } = await import('@nanogemclaw/db');
            const limit = parseInt(req.query.limit as string) || 10;
            res.json({ data: getGroupTokenRanking(limit) });
        } catch {
            res.status(500).json({ error: 'Failed to fetch token ranking' });
        }
    });

    // GET /api/analytics/response-times
    router.get('/analytics/response-times', async (_req, res) => {
        try {
            const { getResponseTimePercentiles } = await import('@nanogemclaw/db');
            res.json({ data: getResponseTimePercentiles() });
        } catch {
            res.status(500).json({ error: 'Failed to fetch response times' });
        }
    });

    // GET /api/analytics/error-rate
    router.get('/analytics/error-rate', async (req, res) => {
        try {
            const { getErrorRateTimeseries } = await import('@nanogemclaw/db');
            const days = parseInt(req.query.days as string) || 30;
            res.json({ data: getErrorRateTimeseries(days) });
        } catch {
            res.status(500).json({ error: 'Failed to fetch error rate' });
        }
    });

    return router;
}
