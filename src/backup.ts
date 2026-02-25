/**
 * Automatic SQLite Database Backup
 * Uses better-sqlite3's .backup() API for safe, online backups.
 */
import fs from 'fs';
import path from 'path';
import { STORE_DIR } from './config.js';
import { logger } from './logger.js';

// Configuration
const BACKUP_DIR = path.join(STORE_DIR, 'backups');
const BACKUP_RETENTION_DAYS = parseInt(
  process.env.BACKUP_RETENTION_DAYS || '7',
  10,
);
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

let backupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Perform a database backup using better-sqlite3's .backup() API.
 * This is safe to call while the database is in use.
 */
export async function backupDatabase(): Promise<string | null> {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });

    const timestamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const backupFile = path.join(BACKUP_DIR, `messages-${timestamp}.db`);

    // Skip if today's backup already exists
    if (fs.existsSync(backupFile)) {
      logger.debug({ backupFile }, 'Backup already exists for today, skipping');
      return backupFile;
    }

    const dbPath = path.join(STORE_DIR, 'messages.db');
    if (!fs.existsSync(dbPath)) {
      logger.warn('Database file not found, skipping backup');
      return null;
    }

    // Use better-sqlite3's backup API via dynamic import
    const Database = (await import('better-sqlite3')).default;
    const sourceDb = new Database(dbPath, { readonly: true });

    try {
      await sourceDb.backup(backupFile);
      logger.info({ backupFile }, 'Database backup completed');
    } finally {
      sourceDb.close();
    }

    // Cleanup old backups
    cleanupOldBackups();

    return backupFile;
  } catch (err) {
    logger.error({ err }, 'Database backup failed');
    return null;
  }
}

/**
 * Remove backup files older than BACKUP_RETENTION_DAYS.
 */
function cleanupOldBackups(): void {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return;

    const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('messages-') && f.endsWith('.db'));

    for (const file of files) {
      const filePath = path.join(BACKUP_DIR, file);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
        logger.info({ file }, 'Removed old backup');
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to cleanup old backups');
  }
}

/**
 * Start the automatic daily backup schedule.
 */
export function startBackupSchedule(): void {
  // Run initial backup after a short delay (don't block startup)
  setTimeout(() => {
    backupDatabase().catch((err) => {
      logger.error({ err }, 'Initial backup failed');
    });
  }, 30_000); // 30 seconds after startup

  // Schedule daily backups
  backupTimer = setInterval(() => {
    backupDatabase().catch((err) => {
      logger.error({ err }, 'Scheduled backup failed');
    });
  }, BACKUP_INTERVAL_MS);

  logger.info(
    { retentionDays: BACKUP_RETENTION_DAYS, intervalHours: 24 },
    'Backup schedule started',
  );
}

/**
 * Stop the backup schedule.
 */
export function stopBackupSchedule(): void {
  if (backupTimer) {
    clearInterval(backupTimer);
    backupTimer = null;
    logger.info('Backup schedule stopped');
  }
}
