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

export const CONTAINER_IMAGE =
  process.env.CONTAINER_IMAGE || 'nanogemclaw-agent:latest';
export const CONTAINER_TIMEOUT = parseInt(
  process.env.CONTAINER_TIMEOUT || '300000',
  10,
);
export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(
  process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760',
  10,
); // 10MB default
export const IPC_POLL_INTERVAL = 1000;

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
 * Allowed environment variables to pass to containers
 */
export const ALLOWED_CONTAINER_ENV_KEYS = [
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'TZ',
  'NODE_ENV',
  'LOG_LEVEL',
] as const;
