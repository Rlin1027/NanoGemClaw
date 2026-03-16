/**
 * Admin Authorization Module
 *
 * Manages bot owner identity for private chat admin access.
 * Two-layer persistence: env var (ADMIN_USER_ID) takes priority,
 * file-based fallback (data/admin_user_id.txt) for runtime bootstrap.
 */
import fs from 'fs';
import path from 'path';

import { ADMIN_PRIVATE_FOLDER, ADMIN_USER_ID, DATA_DIR } from './config.js';
import { logger } from './logger.js';
import { safeCompare } from './utils/safe-compare.js';

const ADMIN_FILE = path.join(DATA_DIR, 'admin_user_id.txt');

let adminUserId: string = '';

/**
 * Load admin user ID at startup.
 * Priority: env var > file > empty (auto-detection armed).
 */
export function loadAdminUserId(): void {
  // Env var takes absolute priority
  if (ADMIN_USER_ID) {
    adminUserId = ADMIN_USER_ID;
    logger.info({ source: 'env' }, 'Admin user ID loaded from environment');
    return;
  }

  // File-based fallback
  try {
    if (fs.existsSync(ADMIN_FILE)) {
      const stored = fs.readFileSync(ADMIN_FILE, 'utf-8').trim();
      if (stored) {
        adminUserId = stored;
        logger.info({ source: 'file' }, 'Admin user ID loaded from file');
        return;
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to read admin user ID file');
  }

  logger.info('No admin user ID configured — auto-detection armed');
}

/**
 * Set the admin user ID (one-time bootstrap via /start).
 */
export function setAdminUserId(userId: string): void {
  adminUserId = userId;
  try {
    fs.writeFileSync(ADMIN_FILE, userId, { encoding: 'utf-8', mode: 0o600 });
    logger.info({ userId }, 'Admin user ID saved');
  } catch (err) {
    logger.warn({ err }, 'Failed to write admin user ID file');
  }
}

/**
 * Check if a user ID matches the admin.
 */
export function isAdminUser(userId: string): boolean {
  return !!adminUserId && safeCompare(userId, adminUserId);
}

/**
 * Get the current admin user ID.
 */
export function getAdminUserId(): string {
  return adminUserId;
}

/**
 * Centralized predicate: is this folder the admin private chat?
 * ALL admin-detection checks MUST use this function.
 */
export function isAdminGroup(folder: string): boolean {
  return folder === ADMIN_PRIVATE_FOLDER;
}
