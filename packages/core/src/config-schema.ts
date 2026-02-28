import { z } from 'zod';

// ============================================================================
// Transform helpers
// ============================================================================

/**
 * Parse an env string as an integer, falling back to defaultValue.
 */
function envInt(defaultValue: number) {
  return z
    .string()
    .optional()
    .transform((val) => {
      if (val === undefined || val === '') return defaultValue;
      const parsed = parseInt(val, 10);
      return Number.isNaN(parsed) ? defaultValue : parsed;
    });
}

/**
 * Parse an env string as a boolean that defaults to true.
 * Only the string 'false' disables it.
 */
function envBoolDefaultTrue() {
  return z
    .string()
    .optional()
    .transform((val) => val !== 'false');
}

// ============================================================================
// Environment schema
// ============================================================================

export const envSchema = z.object({
  // Required
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),

  // Assistant
  ASSISTANT_NAME: z.string().optional().default('Andy'),

  // Gemini
  GEMINI_MODEL: z.string().optional().default('gemini-3-flash-preview'),
  GEMINI_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),

  // Container
  CONTAINER_IMAGE: z.string().optional().default('nanogemclaw-agent:latest'),
  CONTAINER_TIMEOUT: envInt(300000),
  CONTAINER_MAX_OUTPUT_SIZE: envInt(10485760),

  // Health check
  HEALTH_CHECK_ENABLED: envBoolDefaultTrue(),
  HEALTH_CHECK_PORT: envInt(8080),

  // Timezone
  TZ: z.string().optional(),

  // Rate limiting
  RATE_LIMIT_MAX: envInt(20),
  RATE_LIMIT_WINDOW: envInt(5),
  RATE_LIMIT_ENABLED: envBoolDefaultTrue(),

  // Alerts
  ALERTS_ENABLED: envBoolDefaultTrue(),

  // Webhook
  WEBHOOK_URL: z.string().optional().default(''),
  WEBHOOK_EVENTS: z.string().optional().default('error,alert'),

  // Fast path
  FAST_PATH_ENABLED: envBoolDefaultTrue(),
  CACHE_TTL_SECONDS: envInt(21600),
  MIN_CACHE_CHARS: envInt(100000),
  FAST_PATH_TIMEOUT_MS: envInt(180000),

  // Logging
  LOG_LEVEL: z.string().optional(),
  NODE_ENV: z.string().optional(),
});

export type ParsedEnv = z.infer<typeof envSchema>;
