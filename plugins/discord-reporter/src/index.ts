/**
 * Discord Reporter Plugin
 *
 * Sends daily and weekly usage reports to a Discord channel via webhook.
 * Provides config, test, and trigger endpoints under /api/plugins/discord-reporter/.
 */

import { Router } from 'express';
import type {
    NanoPlugin,
    PluginApi,
    RouteContribution,
    ServiceContribution,
    HookContributions,
    MessageHookContext,
} from '@nanogemclaw/plugin-api';
import {
    loadConfig,
    updateSchedulerConfig,
    startScheduler,
    stopScheduler,
    getSchedulerConfig,
    sendToDiscord,
    heartbeat,
    triggerReport,
    debounced,
    type DiscordConfig,
} from './scheduler.js';
import { formatTestEmbed } from './embed-formatter.js';

// ============================================================================
// Plugin-level state
// ============================================================================

import type { DailyReportGenerator } from './scheduler.js';

let pluginApi: PluginApi | null = null;
let dataDir = '';
let dailyReportGenerator: DailyReportGenerator = () => {
    throw new Error('[discord-reporter] generateDailyReport not yet loaded');
};

// ============================================================================
// Config Route  (/api/plugins/discord-reporter/config)
// ============================================================================

function createConfigRouter(): Router {
    const router = Router();

    /** GET /config — return current config (mask webhook URL partially) */
    router.get('/config', (_req, res) => {
        const config = getSchedulerConfig() ?? loadConfig(dataDir);
        const safe = {
            ...config,
            webhookUrl: config.webhookUrl
                ? config.webhookUrl.replace(/\/[^/]{8,}$/, '/***')
                : '',
        };
        res.json({ data: safe });
    });

    /** PUT /config — update config fields */
    router.put('/config', (req, res) => {
        const body = req.body as Partial<DiscordConfig>;
        const allowed: (keyof DiscordConfig)[] = [
            'webhookUrl',
            'dailyTime',
            'weeklyDay',
            'weeklyTime',
            'enabled',
        ];
        const updates: Partial<DiscordConfig> = {};
        for (const key of allowed) {
            if (key in body) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (updates as any)[key] = (body as any)[key];
            }
        }

        // Validate dailyTime / weeklyTime format HH:MM
        for (const field of ['dailyTime', 'weeklyTime'] as const) {
            if (field in updates) {
                if (!/^\d{2}:\d{2}$/.test(updates[field] as string)) {
                    res.status(400).json({ error: `${field} must be HH:MM` });
                    return;
                }
            }
        }

        // Validate weeklyDay 0-6
        if ('weeklyDay' in updates) {
            const d = Number(updates.weeklyDay);
            if (!Number.isInteger(d) || d < 0 || d > 6) {
                res.status(400).json({ error: 'weeklyDay must be 0-6' });
                return;
            }
            updates.weeklyDay = d;
        }

        const next = updateSchedulerConfig(dataDir, updates);
        pluginApi?.logger.info(`[discord-reporter] Config updated: ${JSON.stringify(updates)}`);
        res.json({ data: { ...next, webhookUrl: next.webhookUrl ? '***' : '' } });
    });

    /** POST /test — send a test embed to verify the webhook */
    router.post('/test', async (_req, res) => {
        const config = getSchedulerConfig() ?? loadConfig(dataDir);
        if (!config.webhookUrl) {
            res.status(400).json({ error: 'webhookUrl is not configured' });
            return;
        }
        try {
            const payload = formatTestEmbed();
            await sendToDiscord(config.webhookUrl, payload);
            res.json({ data: { ok: true, message: 'Test embed sent' } });
        } catch (err) {
            pluginApi?.logger.error(`[discord-reporter] Test send failed: ${String(err)}`);
            res.status(502).json({ error: 'Failed to send test embed' });
        }
    });

    /** POST /trigger — manually trigger a daily or weekly report */
    router.post('/trigger', async (req, res) => {
        const config = getSchedulerConfig() ?? loadConfig(dataDir);
        if (!config.webhookUrl) {
            res.status(400).json({ error: 'webhookUrl is not configured' });
            return;
        }
        const type = (req.body as { type?: string }).type;
        if (type !== 'daily' && type !== 'weekly') {
            res.status(400).json({ error: 'type must be "daily" or "weekly"' });
            return;
        }
        if (!pluginApi) {
            res.status(503).json({ error: 'Plugin not ready' });
            return;
        }
        try {
            await triggerReport(type, config.webhookUrl, pluginApi, dailyReportGenerator);
            res.json({ data: { ok: true, type } });
        } catch (err) {
            pluginApi.logger.error(`[discord-reporter] Trigger failed: ${String(err)}`);
            res.status(502).json({ error: 'Failed to send report' });
        }
    });

    /** POST /heartbeat — verify webhook is reachable */
    router.post('/heartbeat', async (_req, res) => {
        const config = getSchedulerConfig() ?? loadConfig(dataDir);
        if (!config.webhookUrl) {
            res.status(400).json({ error: 'webhookUrl is not configured' });
            return;
        }
        const alive = await heartbeat(config.webhookUrl);
        res.json({ data: { alive } });
    });

    return router;
}

// ============================================================================
// Service
// ============================================================================

const schedulerService: ServiceContribution = {
    name: 'discord-report-scheduler',

    async start(api: PluginApi): Promise<void> {
        // Load the host app's daily-report module at runtime via a URL-relative
        // dynamic import so tsc does not attempt to resolve it cross-package.
        try {
            const reporterUrl = new URL(
                '../../../../src/daily-report.js',
                import.meta.url,
            ).href;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const mod = await import(reporterUrl) as any;
            dailyReportGenerator = mod.generateDailyReport as DailyReportGenerator;
        } catch {
            api.logger.warn(
                '[discord-reporter] Could not load generateDailyReport — daily reports will be unavailable',
            );
        }
        startScheduler(api, api.dataDir, dailyReportGenerator);
    },

    stop(): Promise<void> {
        stopScheduler();
        return Promise.resolve();
    },
};

// ============================================================================
// Hooks
// ============================================================================

const DEBOUNCE_KEY = 'afterMessage';

function buildHooks(getConfig: () => DiscordConfig | null): HookContributions {
    return {
        afterMessage: async (
            context: MessageHookContext & { reply: string },
        ): Promise<void> => {
            const config = getConfig();
            if (!config?.enabled || !config.webhookUrl) return;

            // Only forward messages from main group to avoid noise
            if (!context.isMain) return;

            debounced(DEBOUNCE_KEY, () => {
                if (!pluginApi) return;
                // Fire-and-forget: log but don't throw
                void (async () => {
                    try {
                        const payload = {
                            embeds: [
                                {
                                    title: '💬 New Message',
                                    description: context.reply.slice(0, 2000),
                                    color: 0x60a5fa,
                                    fields: [
                                        {
                                            name: 'From',
                                            value: context.senderName || context.sender,
                                            inline: true,
                                        },
                                        {
                                            name: 'Group',
                                            value: context.groupFolder,
                                            inline: true,
                                        },
                                    ],
                                    timestamp: context.timestamp,
                                },
                            ],
                        };
                        await sendToDiscord(config!.webhookUrl, payload);
                    } catch (err) {
                        pluginApi!.logger.error(
                            `[discord-reporter] afterMessage hook failed: ${String(err)}`,
                        );
                    }
                })();
            });
        },
    };
}

// ============================================================================
// Plugin Definition
// ============================================================================

const discordReporterPlugin: NanoPlugin = {
    id: 'discord-reporter',
    name: 'Discord Reporter',
    version: '0.1.0',
    description: 'Sends daily and weekly usage reports to Discord via webhook',

    async init(api: PluginApi): Promise<void | false> {
        pluginApi = api;
        dataDir = api.dataDir;

        // Ensure data directory exists
        const { mkdirSync } = await import('fs');
        mkdirSync(dataDir, { recursive: true });

        const config = loadConfig(dataDir);
        if (config.webhookUrl && !/^https:\/\/discord(app)?\.com\/api\/webhooks\//.test(config.webhookUrl)) {
            api.logger.warn('[discord-reporter] webhookUrl does not look like a Discord webhook URL');
        }

        api.logger.info(`[discord-reporter] Initialized (enabled=${config.enabled})`);
    },

    async start(api: PluginApi): Promise<void> {
        pluginApi = api;
        api.logger.info('[discord-reporter] Started');
    },

    async stop(_api: PluginApi): Promise<void> {
        stopScheduler();
        pluginApi = null;
    },

    services: [schedulerService],

    routes: [
        {
            prefix: 'config',
            createRouter: createConfigRouter,
        } satisfies RouteContribution,
    ],

    hooks: buildHooks(() => getSchedulerConfig()),
};

export default discordReporterPlugin;
