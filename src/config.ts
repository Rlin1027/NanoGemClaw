import path from 'path';

export const ASSISTANT_NAME = process.env.ASSISTANT_NAME || 'Andy';
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;

// Telegram Bot Configuration
export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

// Validate required environment variables at import time
if (!TELEGRAM_BOT_TOKEN) {
  console.error('╔══════════════════════════════════════════════════════════════╗');
  console.error('║  ERROR: TELEGRAM_BOT_TOKEN is required                       ║');
  console.error('╟──────────────────────────────────────────────────────────────╢');
  console.error('║  1. Get a token from @BotFather on Telegram                  ║');
  console.error('║  2. Create .env: echo "TELEGRAM_BOT_TOKEN=xxx" > .env        ║');
  console.error('║  3. Run: npm run setup:telegram                              ║');
  console.error('╚══════════════════════════════════════════════════════════════╝');
  process.exit(1);
}

// Absolute paths needed for container mounts
const PROJECT_ROOT = process.cwd();
const HOME_DIR = process.env.HOME || '/Users/user';

// Mount security: allowlist stored OUTSIDE project root, never mounted into containers
export const MOUNT_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'nanogemclaw',
  'mount-allowlist.json',
);
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const MAIN_GROUP_FOLDER = 'main';

function safeParseInt(value: string | undefined, defaultValue: number): number {
  const parsed = parseInt(value || String(defaultValue), 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

export const CONTAINER_IMAGE =
  process.env.CONTAINER_IMAGE || 'nanogemclaw-agent:latest';
export const CONTAINER_TIMEOUT = safeParseInt(process.env.CONTAINER_TIMEOUT, 300000);
export const CONTAINER_MAX_OUTPUT_SIZE = safeParseInt(process.env.CONTAINER_MAX_OUTPUT_SIZE, 10485760); // 10MB default
export const IPC_POLL_INTERVAL = 1000;

/**
 * Health check HTTP server configuration
 */
export const HEALTH_CHECK = {
  /** Enable health check HTTP server */
  ENABLED: process.env.HEALTH_CHECK_ENABLED !== 'false',
  /** Port for health check server */
  PORT: safeParseInt(process.env.HEALTH_CHECK_PORT, 8080),
} as const;

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const TRIGGER_PATTERN = new RegExp(
  `^@${escapeRegex(ASSISTANT_NAME)}\\b`,
  'i',
);

// Timezone for scheduled tasks (cron expressions, etc.)
// Uses system timezone by default
export const TIMEZONE =
  process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

// ============================================================================
// Organized Constants (for better discoverability)
// ============================================================================

/**
 * Media cleanup configuration
 */
export const CLEANUP = {
  /** Delete media files older than this many days */
  MEDIA_MAX_AGE_DAYS: 7,
  /** Run cleanup every N hours */
  MEDIA_CLEANUP_INTERVAL_HOURS: 6,
  /** Cleanup interval in milliseconds */
  get MEDIA_CLEANUP_INTERVAL_MS() {
    return this.MEDIA_CLEANUP_INTERVAL_HOURS * 60 * 60 * 1000;
  },
} as const;

/**
 * Telegram API configuration
 */
export const TELEGRAM = {
  /** Delay between message chunks to avoid rate limits (ms) */
  RATE_LIMIT_DELAY_MS: 100,
  /** Maximum message length before splitting */
  MAX_MESSAGE_LENGTH: 4096,
} as const;

/**
 * Error alerting configuration
 */
export const ALERTS = {
  /** Number of consecutive failures before sending alert */
  FAILURE_THRESHOLD: 3,
  /** Cooldown between alert messages (minutes) */
  ALERT_COOLDOWN_MINUTES: 30,
  /** Enable error alerts to main group */
  ENABLED: process.env.ALERTS_ENABLED !== 'false',
} as const;

/**
 * Rate limiting configuration
 */
export const RATE_LIMIT = {
  /** Maximum requests per window per group/user */
  MAX_REQUESTS: safeParseInt(process.env.RATE_LIMIT_MAX, 20),
  /** Window duration in minutes */
  WINDOW_MINUTES: safeParseInt(process.env.RATE_LIMIT_WINDOW, 5),
  /** Enable rate limiting */
  ENABLED: process.env.RATE_LIMIT_ENABLED !== 'false',
  /** Message to show when rate limited */
  MESSAGE: '⏳ 請求過於頻繁，請稍後再試。',
} as const;

/**
 * Container execution configuration
 */
export const CONTAINER = {
  /** Graceful shutdown delay before SIGKILL (ms) */
  GRACEFUL_SHUTDOWN_DELAY_MS: 5000,
  /** IPC debounce delay (ms) */
  IPC_DEBOUNCE_MS: 100,
  /** Fallback polling multiplier (use polling_interval * this) */
  IPC_FALLBACK_POLLING_MULTIPLIER: 5,
} as const;

/**
 * Webhook configuration
 */
export const WEBHOOK = {
  /** External webhook URL for notifications (Slack/Discord/IFTTT) */
  URL: process.env.WEBHOOK_URL || '',
  /** Events to trigger webhook: 'error', 'alert', 'system' */
  EVENTS: (process.env.WEBHOOK_EVENTS || 'error,alert').split(','),
  /** Enable webhook notifications */
  ENABLED: !!process.env.WEBHOOK_URL,
} as const;

/**
 * Multi-turn Task Tracking configuration
 */
export const TASK_TRACKING = {
  /** Maximum number of auto-follow-up turns for complex tasks */
  MAX_TURNS: 5,
  /** Timeout for a single task step (ms) */
  STEP_TIMEOUT_MS: 300000, // 5 minutes
} as const;

/**
 * Memory/conversation summary configuration
 */
export const MEMORY = {
  /** Approximate character count threshold to trigger summarization */
  SUMMARIZE_THRESHOLD_CHARS: 50000,
  /** Maximum messages to include in context before triggering summary */
  MAX_CONTEXT_MESSAGES: 100,
  /** How often to check for conversations needing summarization (hours) */
  CHECK_INTERVAL_HOURS: 4,
  /** Summary prompt template */
  SUMMARY_PROMPT: `Summarize the following conversation history concisely. Focus on:
1. Key topics discussed
2. Important decisions made
3. Open questions or tasks
4. User preferences learned

Keep the summary under 500 words. Output in the same language as the conversation.`,
} as const;

/**
 * Allowed environment variables to pass to containers
 */
export const ALLOWED_CONTAINER_ENV_KEYS = [
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_SYSTEM_PROMPT',
  'GEMINI_ENABLE_SEARCH',
  'CONTAINER_TIMEOUT',
  'TZ',
  'NODE_ENV',
  'LOG_LEVEL',
] as const;
