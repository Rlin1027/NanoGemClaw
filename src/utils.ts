import fs from 'fs';
import path from 'path';

export function loadJson<T>(filePath: string, defaultValue: T): T {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (err) {
    console.warn(`[utils] Failed to load JSON from ${filePath}:`, err instanceof Error ? err.message : err);
  }
  return defaultValue;
}

export function saveJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, filePath);
}

/**
 * Format an error for structured logging.
 * Extracts message, stack, and name from Error objects.
 */
export function formatError(err: unknown): { message: string; stack?: string; name?: string } {
  if (err instanceof Error) {
    return {
      message: err.message,
      stack: err.stack,
      name: err.name,
    };
  }
  return { message: String(err) };
}
