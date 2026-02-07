/**
 * Simple console logger (replaces pino for simplicity)
 */

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

const levels: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(level: string): boolean {
  return levels[level] >= levels[LOG_LEVEL];
}

const SENSITIVE_KEYS = /key|token|secret|password|credential|auth/i;

function maskSensitiveData(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(maskSensitiveData);
  const masked: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    masked[k] = SENSITIVE_KEYS.test(k) && typeof v === 'string' ? '[REDACTED]' : v;
  }
  return masked;
}

function formatData(data: unknown): string {
  if (typeof data === 'string') return data;
  if (typeof data === 'object') return JSON.stringify(maskSensitiveData(data));
  return String(data);
}

export const logger = {
  debug: (data: unknown, msg?: string) => {
    if (shouldLog('debug')) {
      console.log(`[DEBUG] ${msg || ''} ${formatData(data)}`);
    }
  },
  info: (data: unknown, msg?: string) => {
    if (shouldLog('info')) {
      console.log(`[INFO] ${msg || ''} ${formatData(data)}`);
    }
  },
  warn: (data: unknown, msg?: string) => {
    if (shouldLog('warn')) {
      console.warn(`[WARN] ${msg || ''} ${formatData(data)}`);
    }
  },
  error: (data: unknown, msg?: string) => {
    if (shouldLog('error')) {
      console.error(`[ERROR] ${msg || ''} ${formatData(data)}`);
    }
  },
};
