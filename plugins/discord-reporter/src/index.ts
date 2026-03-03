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
  type WeeklyDataGenerator,
} from './scheduler.js';
import { formatTestEmbed, type WeeklyData } from './embed-formatter.js';

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
    pluginApi?.logger.info(
      `[discord-reporter] Config updated: ${JSON.stringify(updates)}`,
    );
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
      pluginApi?.logger.error(
        `[discord-reporter] Test send failed: ${String(err)}`,
      );
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
      await triggerReport(
        type,
        config.webhookUrl,
        pluginApi,
        dailyReportGenerator,
      );
      res.json({ data: { ok: true, type } });
    } catch (err) {
      pluginApi.logger.error(
        `[discord-reporter] Trigger failed: ${String(err)}`,
      );
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
    // Load the host app's daily-report module at runtime using an absolute
    // path from process.cwd() (project root) so the import works regardless
    // of where the plugin code lives.
    try {
      const { join } = await import('path');
      const reporterPath = join(process.cwd(), 'src', 'daily-report.js');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod = (await import(reporterPath)) as any;
      dailyReportGenerator = mod.generateDailyReport as DailyReportGenerator;
    } catch {
      api.logger.warn(
        '[discord-reporter] Could not load generateDailyReport — daily reports will be unavailable',
      );
    }

    // Build weekly data generator from host app's DB stats
    let generateWeeklyData: WeeklyDataGenerator | undefined;
    try {
      const { join } = await import('path');
      const dbPath = join(process.cwd(), 'src', 'db.js');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dbMod = (await import(dbPath)) as any;

      generateWeeklyData = (): WeeklyData => {
        const now = new Date();
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const since = weekAgo.toISOString();

        // Overall stats for the last 7 days
        const stats = dbMod.getUsageStats(undefined, since);
        const totalTokens =
          (stats.total_prompt_tokens || 0) +
          (stats.total_response_tokens || 0);

        // Per-day breakdown for peak day and avg daily requests
        const timeseries = (dbMod.getUsageTimeseriesDaily?.(7) ?? []) as Array<{
          date: string;
          request_count: number;
          total_tokens: number;
        }>;

        let peakDay = 'N/A';
        let peakDayRequests = 0;
        for (const day of timeseries) {
          if (day.request_count > peakDayRequests) {
            peakDay = day.date;
            peakDayRequests = day.request_count;
          }
        }
        const avgDailyRequests =
          timeseries.length > 0
            ? stats.total_requests / timeseries.length
            : 0;

        // Top groups by request count
        const groupStats = (dbMod.getUsageByGroup?.(since) ?? []) as Array<{
          group_folder: string;
          requests: number;
        }>;
        const topGroups = groupStats.slice(0, 5).map((g) => ({
          name: g.group_folder,
          requests: g.requests,
        }));

        // Error rate from in-memory error states
        const errorStates = (dbMod.getAllErrorStates?.() ?? []) as Array<{
          group: string;
          state: { consecutiveFailures: number };
        }>;
        const totalErrors = errorStates.reduce(
          (sum, e) => sum + e.state.consecutiveFailures,
          0,
        );
        const errorRate =
          stats.total_requests > 0
            ? totalErrors / stats.total_requests
            : 0;

        return {
          period: { start: since, end: now.toISOString() },
          totalRequests: stats.total_requests,
          totalTokens,
          avgDailyRequests,
          peakDay,
          peakDayRequests,
          errorRate,
          topGroups,
        };
      };
    } catch {
      api.logger.warn(
        '[discord-reporter] Could not load DB stats — weekly reports will use default data',
      );
    }

    startScheduler(api, api.dataDir, dailyReportGenerator, generateWeeklyData);
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
    if (
      config.webhookUrl &&
      !/^https:\/\/discord(app)?\.com\/api\/webhooks\//.test(config.webhookUrl)
    ) {
      api.logger.warn(
        '[discord-reporter] webhookUrl does not look like a Discord webhook URL',
      );
    }

    api.logger.info(
      `[discord-reporter] Initialized (enabled=${config.enabled})`,
    );
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
      prefix: '',
      createRouter: createConfigRouter,
    } satisfies RouteContribution,
  ],

  hooks: buildHooks(() => getSchedulerConfig()),
};

export default discordReporterPlugin;
