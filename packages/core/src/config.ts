import path from 'path';
import { envSchema, type ParsedEnv } from './config-schema.js';

// ============================================================================
// Config Types
// ============================================================================

export interface NanoGemClawConfig {
  assistantName: string;
  telegramBotToken: string;
  geminiModel: string;
  pollInterval: number;
  schedulerPollInterval: number;
  containerImage: string;
  containerTimeout: number;
  containerMaxOutputSize: number;
  ipcPollInterval: number;
  storeDir: string;
  groupsDir: string;
  dataDir: string;
  mainGroupFolder: string;
  mountAllowlistPath: string;
  healthCheck: { enabled: boolean; port: number };
  timezone: string;
  cleanup: { mediaMaxAgeDays: number; mediaCleanupIntervalHours: number };
  telegram: { rateLimitDelayMs: number; maxMessageLength: number };
  alerts: {
    failureThreshold: number;
    alertCooldownMinutes: number;
    enabled: boolean;
  };
  rateLimit: {
    maxRequests: number;
    windowMinutes: number;
    enabled: boolean;
    message: string;
  };
  container: {
    gracefulShutdownDelayMs: number;
    ipcDebounceMs: number;
    ipcFallbackPollingMultiplier: number;
  };
  webhook: { url: string; events: string[]; enabled: boolean };
  taskTracking: { maxTurns: number; stepTimeoutMs: number };
  memory: {
    summarizeThresholdChars: number;
    maxContextMessages: number;
    checkIntervalHours: number;
    summaryPrompt: string;
  };
  fastPath: {
    enabled: boolean;
    cacheTtlSeconds: number;
    minCacheChars: number;
    streamingIntervalMs: number;
    maxHistoryMessages: number;
    timeoutMs: number;
  };
  allowedContainerEnvKeys: readonly string[];
}

// ============================================================================
// Helpers
// ============================================================================

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================================
// Factory: create config from env (no process.exit — caller handles validation)
// ============================================================================

export function createConfig(
  overrides: Partial<NanoGemClawConfig> = {},
): NanoGemClawConfig {
  const PROJECT_ROOT = process.cwd();
  const HOME_DIR = process.env.HOME || '/Users/user';

  // Parse env vars through schema (provides type coercion and defaults)
  const parsed = envSchema.safeParse(process.env);
  const env: Partial<ParsedEnv> = parsed.success ? parsed.data : {};

  const defaults: NanoGemClawConfig = {
    assistantName: env.ASSISTANT_NAME ?? 'Andy',
    telegramBotToken: env.TELEGRAM_BOT_TOKEN ?? '',
    geminiModel: env.GEMINI_MODEL ?? 'gemini-2.5-flash',
    pollInterval: 2000,
    schedulerPollInterval: 60000,
    containerImage: env.CONTAINER_IMAGE ?? 'nanogemclaw-agent:latest',
    containerTimeout: env.CONTAINER_TIMEOUT ?? 300000,
    containerMaxOutputSize: env.CONTAINER_MAX_OUTPUT_SIZE ?? 10485760,
    ipcPollInterval: 1000,
    storeDir: path.resolve(PROJECT_ROOT, 'store'),
    groupsDir: path.resolve(PROJECT_ROOT, 'groups'),
    dataDir: path.resolve(PROJECT_ROOT, 'data'),
    mainGroupFolder: 'main',
    mountAllowlistPath: path.join(
      HOME_DIR,
      '.config',
      'nanogemclaw',
      'mount-allowlist.json',
    ),
    healthCheck: {
      enabled: env.HEALTH_CHECK_ENABLED ?? true,
      port: env.HEALTH_CHECK_PORT ?? 8080,
    },
    timezone: env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
    cleanup: { mediaMaxAgeDays: 7, mediaCleanupIntervalHours: 6 },
    telegram: { rateLimitDelayMs: 100, maxMessageLength: 4096 },
    alerts: {
      failureThreshold: 3,
      alertCooldownMinutes: 30,
      enabled: env.ALERTS_ENABLED ?? true,
    },
    rateLimit: {
      maxRequests: env.RATE_LIMIT_MAX ?? 20,
      windowMinutes: env.RATE_LIMIT_WINDOW ?? 5,
      enabled: env.RATE_LIMIT_ENABLED ?? true,
      message: '⏳ 請求過於頻繁，請稍後再試。',
    },
    container: {
      gracefulShutdownDelayMs: 5000,
      ipcDebounceMs: 100,
      ipcFallbackPollingMultiplier: 5,
    },
    webhook: {
      url: env.WEBHOOK_URL ?? '',
      events: (env.WEBHOOK_EVENTS ?? 'error,alert').split(','),
      enabled: !!env.WEBHOOK_URL,
    },
    taskTracking: { maxTurns: 5, stepTimeoutMs: 300000 },
    memory: {
      summarizeThresholdChars: 50000,
      maxContextMessages: 100,
      checkIntervalHours: 4,
      summaryPrompt: `Summarize the following conversation history concisely. Focus on:
1. Key topics discussed
2. Important decisions made
3. Open questions or tasks
4. User preferences learned

Keep the summary under 500 words. Output in the same language as the conversation.`,
    },
    fastPath: {
      enabled: env.FAST_PATH_ENABLED ?? true,
      cacheTtlSeconds: env.CACHE_TTL_SECONDS ?? 21600,
      minCacheChars: env.MIN_CACHE_CHARS ?? 100000,
      streamingIntervalMs: 500,
      maxHistoryMessages: 50,
      timeoutMs: env.FAST_PATH_TIMEOUT_MS ?? 180000,
    },
    allowedContainerEnvKeys: [
      'GEMINI_API_KEY',
      'GOOGLE_API_KEY',
      'GEMINI_SYSTEM_PROMPT',
      'GEMINI_ENABLE_SEARCH',
      'GEMINI_MODEL',
      'CONTAINER_TIMEOUT',
      'TZ',
      'NODE_ENV',
      'LOG_LEVEL',
    ],
  };

  return { ...defaults, ...overrides };
}

// ============================================================================
// Backward-compatible exports (singleton from env)
// ============================================================================

// Parse env once for all singleton exports
const _singletonEnv = (() => {
  const result = envSchema.safeParse(process.env);
  return result.success ? result.data : null;
})();

export const ASSISTANT_NAME =
  _singletonEnv?.ASSISTANT_NAME ?? process.env.ASSISTANT_NAME ?? 'Andy';
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;
let _resolvedDefaultModel: string | null = null;

/**
 * Set the resolved default model (called at startup after model discovery).
 * Only takes effect when GEMINI_MODEL env var is NOT explicitly set.
 */
export function setResolvedDefaultModel(modelId: string): void {
  _resolvedDefaultModel = modelId;
}

/**
 * Get the effective default model.
 * Priority: GEMINI_MODEL env var > auto-discovered > hardcoded fallback
 */
export function getDefaultModel(): string {
  return (
    _singletonEnv?.GEMINI_MODEL ??
    process.env.GEMINI_MODEL ??
    _resolvedDefaultModel ??
    'gemini-2.5-flash'
  );
}

export const GEMINI_MODEL =
  _singletonEnv?.GEMINI_MODEL ??
  process.env.GEMINI_MODEL ??
  'gemini-2.5-flash';

export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

const PROJECT_ROOT = process.cwd();
const HOME_DIR = process.env.HOME || '/Users/user';

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
  _singletonEnv?.CONTAINER_IMAGE ??
  process.env.CONTAINER_IMAGE ??
  'nanogemclaw-agent:latest';
export const CONTAINER_TIMEOUT = _singletonEnv?.CONTAINER_TIMEOUT ?? 300000;
export const CONTAINER_MAX_OUTPUT_SIZE =
  _singletonEnv?.CONTAINER_MAX_OUTPUT_SIZE ?? 10485760;
export const IPC_POLL_INTERVAL = 1000;

export const HEALTH_CHECK = {
  ENABLED: _singletonEnv?.HEALTH_CHECK_ENABLED ?? true,
  PORT: _singletonEnv?.HEALTH_CHECK_PORT ?? 8080,
} as const;

export const TRIGGER_PATTERN = new RegExp(
  `^@${escapeRegex(ASSISTANT_NAME)}\\b`,
  'i',
);

export const TIMEZONE =
  _singletonEnv?.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

export const CLEANUP = {
  MEDIA_MAX_AGE_DAYS: 7,
  MEDIA_CLEANUP_INTERVAL_HOURS: 6,
  get MEDIA_CLEANUP_INTERVAL_MS() {
    return this.MEDIA_CLEANUP_INTERVAL_HOURS * 60 * 60 * 1000;
  },
} as const;

export const TELEGRAM = {
  RATE_LIMIT_DELAY_MS: 100,
  MAX_MESSAGE_LENGTH: 4096,
} as const;

export const ALERTS = {
  FAILURE_THRESHOLD: 3,
  ALERT_COOLDOWN_MINUTES: 30,
  ENABLED: _singletonEnv?.ALERTS_ENABLED ?? true,
} as const;

export const RATE_LIMIT = {
  MAX_REQUESTS: _singletonEnv?.RATE_LIMIT_MAX ?? 20,
  WINDOW_MINUTES: _singletonEnv?.RATE_LIMIT_WINDOW ?? 5,
  ENABLED: _singletonEnv?.RATE_LIMIT_ENABLED ?? true,
  MESSAGE: '⏳ 請求過於頻繁，請稍後再試。',
} as const;

export const CONTAINER = {
  GRACEFUL_SHUTDOWN_DELAY_MS: 5000,
  IPC_DEBOUNCE_MS: 100,
  IPC_FALLBACK_POLLING_MULTIPLIER: 5,
} as const;

export const WEBHOOK = {
  URL: _singletonEnv?.WEBHOOK_URL ?? '',
  EVENTS: (_singletonEnv?.WEBHOOK_EVENTS ?? 'error,alert').split(','),
  ENABLED: !!_singletonEnv?.WEBHOOK_URL,
} as const;

export const TASK_TRACKING = {
  MAX_TURNS: 5,
  STEP_TIMEOUT_MS: 300000,
} as const;

export const MEMORY = {
  SUMMARIZE_THRESHOLD_CHARS: 50000,
  MAX_CONTEXT_MESSAGES: 100,
  CHECK_INTERVAL_HOURS: 4,
  SUMMARY_PROMPT: `Summarize the following conversation history concisely. Focus on:
1. Key topics discussed
2. Important decisions made
3. Open questions or tasks
4. User preferences learned

Keep the summary under 500 words. Output in the same language as the conversation.`,
} as const;

export const FAST_PATH = {
  ENABLED: _singletonEnv?.FAST_PATH_ENABLED ?? true,
  CACHE_TTL_SECONDS: _singletonEnv?.CACHE_TTL_SECONDS ?? 21600,
  MIN_CACHE_CHARS: _singletonEnv?.MIN_CACHE_CHARS ?? 100000,
  STREAMING_INTERVAL_MS: 500,
  MAX_HISTORY_MESSAGES: 50,
  TIMEOUT_MS: _singletonEnv?.FAST_PATH_TIMEOUT_MS ?? 180000,
} as const;

export const ALLOWED_CONTAINER_ENV_KEYS = [
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_SYSTEM_PROMPT',
  'GEMINI_ENABLE_SEARCH',
  'GEMINI_MODEL',
  'CONTAINER_TIMEOUT',
  'TZ',
  'NODE_ENV',
  'LOG_LEVEL',
] as const;
