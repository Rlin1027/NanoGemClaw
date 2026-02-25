import {
  vi,
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from 'vitest';
import path from 'path';
import fs from 'fs';

// Use vi.hoisted so TEST_STORE_DIR is available inside vi.mock factory
// Note: vi.hoisted runs before all imports, so we must use require() for node builtins
const { TEST_STORE_DIR } = vi.hoisted(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  const _os = require('os') as typeof import('os');
  const _path = require('path') as typeof import('path');
  const TEST_STORE_DIR = _path.join(
    _os.tmpdir(),
    `nanogemclaw-test-${Date.now()}`,
  );
  return { TEST_STORE_DIR };
});

// Mock config to use temporary directory
vi.mock('../config.js', () => ({
  STORE_DIR: TEST_STORE_DIR,
}));

// Import db functions after mocking
import { initDatabase, closeDatabase } from '../db.js';
import { resetDatabase, cleanupTestDir } from './helpers/db-test-setup.js';

describe('db/connection', () => {
  beforeAll(() => {
    initDatabase();
  });

  afterAll(() => {
    closeDatabase();
    cleanupTestDir(TEST_STORE_DIR);
  });

  describe('Database Initialization', () => {
    beforeEach(() => resetDatabase(TEST_STORE_DIR));

    it('should create database file', () => {
      const dbPath = path.join(TEST_STORE_DIR, 'messages.db');
      expect(fs.existsSync(dbPath)).toBe(true);
    });

    it('should initialize without errors', () => {
      expect(() => initDatabase()).not.toThrow();
    });

    it('should close database without errors', () => {
      expect(() => closeDatabase()).not.toThrow();
    });
  });
});
