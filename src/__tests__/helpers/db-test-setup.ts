import path from 'path';
import fs from 'fs';

import {
  initDatabase,
  closeDatabase,
  getAllErrorStates,
  resetErrors,
} from '../../db.js';

/**
 * Reset database between tests: close, delete files, reinitialize.
 */
export function resetDatabase(testStoreDir: string): void {
  try {
    closeDatabase();
  } catch {
    // Ignore if already closed
  }

  const dbPath = path.join(testStoreDir, 'messages.db');
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
  // Remove WAL files
  ['-wal', '-shm'].forEach((ext) => {
    const walPath = dbPath + ext;
    if (fs.existsSync(walPath)) {
      fs.unlinkSync(walPath);
    }
  });

  initDatabase();

  // Reset error tracking state
  const allStates = getAllErrorStates();
  allStates.forEach((s) => resetErrors(s.group));
}

/**
 * Clean up temporary test directory.
 */
export function cleanupTestDir(testStoreDir: string): void {
  if (fs.existsSync(testStoreDir)) {
    fs.rmSync(testStoreDir, { recursive: true, force: true });
  }
}
