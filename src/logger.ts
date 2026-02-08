/**
 * Simple console logger (replaces pino for simplicity)
 */

import { EventEmitter } from 'node:events';

export interface LogEntry {
  id: number;
  timestamp: string;
  level: string;
  message: string;
  data?: unknown;
}

let currentLogLevel = process.env.LOG_LEVEL || 'info';

const levels: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MAX_BUFFER_SIZE = 500;
const logBuffer: LogEntry[] = [];
let logIdCounter = 0;

export const logEmitter = new EventEmitter();

function shouldLog(level: string): boolean {
  return levels[level] >= levels[currentLogLevel];
}

const SENSITIVE_KEYS = /key|token|secret|password|credential|auth/i;

function maskSensitiveData(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(maskSensitiveData);
  const masked: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    masked[k] =
      SENSITIVE_KEYS.test(k) && typeof v === 'string' ? '[REDACTED]' : v;
  }
  return masked;
}

function formatData(data: unknown): string {
  if (typeof data === 'string') return data;
  if (typeof data === 'object') return JSON.stringify(maskSensitiveData(data));
  return String(data);
}

function addToBuffer(entry: LogEntry): void {
  logBuffer.push(entry);
  if (logBuffer.length > MAX_BUFFER_SIZE) {
    logBuffer.shift();
  }
  logEmitter.emit('log', entry);
}

export function getLogBuffer(): LogEntry[] {
  return [...logBuffer];
}

export function setLogLevel(level: string): void {
  if (levels[level] !== undefined) {
    currentLogLevel = level;
  }
}

export const logger = {
  debug: (data: unknown, msg?: string) => {
    if (shouldLog('debug')) {
      const message = `[DEBUG] ${msg || ''} ${formatData(data)}`;
      console.log(message);
      addToBuffer({
        id: ++logIdCounter,
        timestamp: new Date().toISOString(),
        level: 'debug',
        message,
        data,
      });
    }
  },
  info: (data: unknown, msg?: string) => {
    if (shouldLog('info')) {
      const message = `[INFO] ${msg || ''} ${formatData(data)}`;
      console.log(message);
      addToBuffer({
        id: ++logIdCounter,
        timestamp: new Date().toISOString(),
        level: 'info',
        message,
        data,
      });
    }
  },
  warn: (data: unknown, msg?: string) => {
    if (shouldLog('warn')) {
      const message = `[WARN] ${msg || ''} ${formatData(data)}`;
      console.warn(message);
      addToBuffer({
        id: ++logIdCounter,
        timestamp: new Date().toISOString(),
        level: 'warn',
        message,
        data,
      });
    }
  },
  error: (data: unknown, msg?: string) => {
    if (shouldLog('error')) {
      const message = `[ERROR] ${msg || ''} ${formatData(data)}`;
      console.error(message);
      addToBuffer({
        id: ++logIdCounter,
        timestamp: new Date().toISOString(),
        level: 'error',
        message,
        data,
      });
    }
  },
};
