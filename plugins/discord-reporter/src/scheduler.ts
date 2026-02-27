/**
 * Discord Report Scheduler
 *
 * Manages cron-like scheduling of daily and weekly reports.
 * Uses setInterval (1-minute tick) to check configured fire times.
 * Handles HTTP POST to Discord webhooks with rate-limit awareness.
 */

import fs from 'fs';
import path from 'path';
import type { PluginApi } from '@nanogemclaw/plugin-api';
import type {
  DiscordPayload,
  DailyReport,
  WeeklyData,
} from './embed-formatter.js';
import { formatDailyEmbed, formatWeeklyEmbed } from './embed-formatter.js';

// ============================================================================
// Config Types
// ============================================================================

export interface DiscordConfig {
  /** Discord webhook URL */
  webhookUrl: string;
  /** HH:MM in 24-hour format for daily report, default "09:00" */
  dailyTime: string;
  /** 0=Sunday … 6=Saturday, default 1 (Monday) */
  weeklyDay: number;
  /** HH:MM in 24-hour format for weekly report, default "09:00" */
  weeklyTime: string;
  /** Whether scheduling is enabled */
  enabled: boolean;
}

const DEFAULT_CONFIG: DiscordConfig = {
  webhookUrl: '',
  dailyTime: '09:00',
  weeklyDay: 1,
  weeklyTime: '09:00',
  enabled: false,
};

// ============================================================================
// Rate Limiter
// ============================================================================

/** Max Discord webhook requests per minute */
const RATE_LIMIT_PER_MIN = 30;

interface RateLimiter {
  timestamps: number[];
}

const rateLimiter: RateLimiter = { timestamps: [] };

function canSendNow(): boolean {
  const now = Date.now();
  const windowStart = now - 60_000;
  rateLimiter.timestamps = rateLimiter.timestamps.filter(
    (t) => t > windowStart,
  );
  return rateLimiter.timestamps.length < RATE_LIMIT_PER_MIN;
}

function recordSend(): void {
  rateLimiter.timestamps.push(Date.now());
}

// ============================================================================
// Debounce
// ============================================================================

const DEBOUNCE_MS = 500;
const pendingDebounce = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Debounce a keyed async fn by DEBOUNCE_MS.
 */
export function debounced(key: string, fn: () => void): void {
  const existing = pendingDebounce.get(key);
  if (existing) clearTimeout(existing);
  const handle = setTimeout(() => {
    pendingDebounce.delete(key);
    fn();
  }, DEBOUNCE_MS);
  pendingDebounce.set(key, handle);
}

// ============================================================================
// HTTP Send
// ============================================================================

/** Allowed Discord webhook URL hostnames */
const DISCORD_WEBHOOK_HOSTS = new Set([
  'discord.com',
  'discordapp.com',
  'canary.discord.com',
  'ptb.discord.com',
]);

/**
 * Validate that a URL is a legitimate Discord webhook endpoint.
 * Prevents SSRF by restricting to known Discord hostnames and paths.
 */
function isValidDiscordWebhookUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    if (url.protocol !== 'https:') return false;
    if (!DISCORD_WEBHOOK_HOSTS.has(url.hostname)) return false;
    if (!url.pathname.startsWith('/api/webhooks/')) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * POST a payload to a Discord webhook URL.
 * Validates URL against known Discord hostnames to prevent SSRF.
 * Respects rate limit and throws on non-2xx responses.
 */
export async function sendToDiscord(
  webhookUrl: string,
  payload: DiscordPayload,
): Promise<void> {
  if (!isValidDiscordWebhookUrl(webhookUrl)) {
    throw new Error(
      'Invalid Discord webhook URL. Must be https://discord.com/api/webhooks/... or equivalent.',
    );
  }

  if (!canSendNow()) {
    throw new Error(
      'Discord rate limit reached (30 req/min). Try again shortly.',
    );
  }

  const body = JSON.stringify(payload);
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  recordSend();

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Discord webhook returned ${response.status}: ${text}`);
  }
}

// ============================================================================
// Config Persistence
// ============================================================================

export function loadConfig(dataDir: string): DiscordConfig {
  const configPath = path.join(dataDir, 'discord-config.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) } as DiscordConfig;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(dataDir: string, config: DiscordConfig): void {
  const configPath = path.join(dataDir, 'discord-config.json');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

// ============================================================================
// Time Helpers
// ============================================================================

function parseHHMM(hhmm: string): { hour: number; minute: number } {
  const [h, m] = hhmm.split(':').map(Number);
  const hour = Number.isFinite(h) ? h : 9;
  const minute = Number.isFinite(m) ? m : 0;
  return { hour, minute };
}

function nowLocal(): { hour: number; minute: number; day: number } {
  const d = new Date();
  return { hour: d.getHours(), minute: d.getMinutes(), day: d.getDay() };
}

// ============================================================================
// Scheduler State
// ============================================================================

export type DailyReportGenerator = () => DailyReport;
export type WeeklyDataGenerator = () => WeeklyData;

interface SchedulerState {
  api: PluginApi;
  config: DiscordConfig;
  dataDir: string;
  tickInterval: ReturnType<typeof setInterval> | null;
  lastDailyFire: string; // "YYYY-MM-DD"
  lastWeeklyFire: string; // "YYYY-WW" (year-weekday)
  generateDailyReport: DailyReportGenerator;
  generateWeeklyData: WeeklyDataGenerator;
}

let state: SchedulerState | null = null;

// ============================================================================
// Weekly Data Builder
// ============================================================================

/** Fallback weekly data when no generator is injected */
function defaultWeeklyData(): WeeklyData {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return {
    period: { start: weekAgo.toISOString(), end: now.toISOString() },
    totalRequests: 0,
    totalTokens: 0,
    avgDailyRequests: 0,
    peakDay: 'N/A',
    peakDayRequests: 0,
    errorRate: 0,
    topGroups: [],
  };
}

/**
 * Build weekly aggregate data.
 * Delegates to the injected WeeklyDataGenerator (provided by the host app
 * which has access to the DB stats module).  Falls back to a zeroed-out
 * stub if no generator is available.
 */
function buildWeeklyData(): WeeklyData {
  if (state) {
    try {
      return state.generateWeeklyData();
    } catch {
      // Fall through to default on error
    }
  }
  return defaultWeeklyData();
}

// ============================================================================
// Tick Handler
// ============================================================================

async function tick(): Promise<void> {
  if (!state) return;
  const { config, api } = state;
  if (!config.enabled || !config.webhookUrl) return;

  const { hour, minute, day } = nowLocal();
  const now_ = new Date();
  const today = now_.toISOString().slice(0, 10);
  // Use ISO week number for dedup so the report fires once per actual week,
  // not once per day-of-week per year.
  const oneJan = new Date(now_.getFullYear(), 0, 1);
  const dayOfYear =
    Math.floor((now_.getTime() - oneJan.getTime()) / 86_400_000) + 1;
  const weekNum = Math.ceil(dayOfYear / 7);
  const weekKey = `${now_.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;

  // --- Daily ---
  const { hour: dh, minute: dm } = parseHHMM(config.dailyTime);
  if (hour === dh && minute === dm && state.lastDailyFire !== today) {
    state.lastDailyFire = today;
    try {
      const report: DailyReport = state.generateDailyReport();
      const payload = formatDailyEmbed(report);
      await sendToDiscord(config.webhookUrl, payload);
      api.logger.info('[discord-reporter] Daily report sent to Discord');
    } catch (err) {
      api.logger.error(
        `[discord-reporter] Failed to send daily report: ${String(err)}`,
      );
    }
  }

  // --- Weekly ---
  const { hour: wh, minute: wm } = parseHHMM(config.weeklyTime);
  if (
    day === config.weeklyDay &&
    hour === wh &&
    minute === wm &&
    state.lastWeeklyFire !== weekKey
  ) {
    state.lastWeeklyFire = weekKey;
    try {
      const weeklyData = buildWeeklyData();
      const payload = formatWeeklyEmbed(weeklyData);
      await sendToDiscord(config.webhookUrl, payload);
      api.logger.info('[discord-reporter] Weekly report sent to Discord');
    } catch (err) {
      api.logger.error(
        `[discord-reporter] Failed to send weekly report: ${String(err)}`,
      );
    }
  }
}

// ============================================================================
// Public API
// ============================================================================

export function startScheduler(
  api: PluginApi,
  dataDir: string,
  generateDailyReport: DailyReportGenerator,
  generateWeeklyData?: WeeklyDataGenerator,
): void {
  const config = loadConfig(dataDir);
  state = {
    api,
    config,
    dataDir,
    tickInterval: null,
    lastDailyFire: '',
    lastWeeklyFire: '',
    generateDailyReport,
    generateWeeklyData: generateWeeklyData ?? defaultWeeklyData,
  };
  // Tick every minute
  state.tickInterval = setInterval(() => {
    void tick();
  }, 60_000);
  api.logger.info(
    `[discord-reporter] Scheduler started (enabled=${config.enabled})`,
  );
}

export function stopScheduler(): void {
  if (state?.tickInterval) {
    clearInterval(state.tickInterval);
    state.tickInterval = null;
  }
  // Clear any pending debounce timers
  for (const handle of pendingDebounce.values()) {
    clearTimeout(handle);
  }
  pendingDebounce.clear();
  state = null;
}

export function getSchedulerConfig(): DiscordConfig | null {
  return state ? { ...state.config } : null;
}

export function updateSchedulerConfig(
  dataDir: string,
  updates: Partial<DiscordConfig>,
): DiscordConfig {
  const current = loadConfig(dataDir);
  const next: DiscordConfig = { ...current, ...updates };
  saveConfig(dataDir, next);
  if (state) state.config = next;
  return next;
}

/**
 * Verify webhook is reachable by sending a GET request.
 * Discord webhooks respond with 200 and webhook info on GET.
 * Uses GET instead of POST to avoid sending empty messages.
 * Validates URL against known Discord hostnames to prevent SSRF.
 */
export async function heartbeat(webhookUrl: string): Promise<boolean> {
  if (!isValidDiscordWebhookUrl(webhookUrl)) {
    return false;
  }
  try {
    const response = await fetch(webhookUrl, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Manually trigger a daily or weekly report immediately.
 * Pass generateDailyReport explicitly so the scheduler module has no
 * compile-time dependency on the host application's source tree.
 */
export async function triggerReport(
  type: 'daily' | 'weekly',
  webhookUrl: string,
  api: PluginApi,
  generateDailyReport: DailyReportGenerator,
): Promise<void> {
  if (type === 'daily') {
    const report: DailyReport = generateDailyReport();
    const payload = formatDailyEmbed(report);
    await sendToDiscord(webhookUrl, payload);
    api.logger.info('[discord-reporter] Manual daily report triggered');
  } else {
    const weeklyData = buildWeeklyData();
    const payload = formatWeeklyEmbed(weeklyData);
    await sendToDiscord(webhookUrl, payload);
    api.logger.info('[discord-reporter] Manual weekly report triggered');
  }
}
