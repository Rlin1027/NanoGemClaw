import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { RegisteredGroup } from '../types.js';

// Mock config first to prevent process.exit
vi.mock('../config.js', () => ({
  DATA_DIR: '/test/data',
  GROUPS_DIR: '/test/groups',
}));

// Mock logger
vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock fs module
vi.mock('fs', () => ({
  default: {
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    existsSync: vi.fn(),
  },
}));

// Mock state module
vi.mock('../state.js', () => ({
  getRegisteredGroups: vi.fn(),
  setRegisteredGroups: vi.fn(),
  getSessions: vi.fn(),
  setSessions: vi.fn(),
  getLastAgentTimestamp: vi.fn(),
  setLastAgentTimestamp: vi.fn(),
}));

// Mock db module
vi.mock('../db.js', () => ({
  getAllChats: vi.fn(),
}));

// Mock utils module
vi.mock('../utils.js', () => ({
  loadJson: vi.fn((path: string, defaultValue: any) => defaultValue),
  saveJson: vi.fn(),
}));

// Mock i18n module (both shim and new path)
vi.mock('../i18n.js', () => ({
  setLanguage: vi.fn(),
  availableLanguages: ['en', 'zh-TW', 'zh-CN', 'es', 'ja', 'ko', 'pt', 'ru'],
  getLanguage: vi.fn(() => 'en'),
}));
vi.mock('../i18n/index.js', () => ({
  setLanguage: vi.fn(),
  availableLanguages: ['en', 'zh-TW', 'zh-CN', 'es', 'ja', 'ko', 'pt', 'ru'],
  getLanguage: vi.fn(() => 'en'),
}));

import fs from 'fs';
import {
  loadState,
  saveState,
  registerGroup,
  getAvailableGroups,
} from '../group-manager.js';
import {
  getRegisteredGroups,
  setRegisteredGroups,
  getSessions,
  setSessions,
  getLastAgentTimestamp,
  setLastAgentTimestamp,
} from '../state.js';
import { getAllChats } from '../db.js';
import { loadJson, saveJson } from '../utils.js';
import { setLanguage } from '../i18n/index.js';

describe('group-manager.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRegisteredGroups).mockReturnValue({});
    vi.mocked(getSessions).mockReturnValue({});
    vi.mocked(getLastAgentTimestamp).mockReturnValue({});
    vi.mocked(loadJson).mockReturnValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadState', () => {
    it('should load router_state.json and set last agent timestamp', async () => {
      vi.mocked(loadJson).mockImplementation(
        (path: string, defaultValue: any) => {
          if (path.includes('router_state.json')) {
            return {
              last_agent_timestamp: { '123': '2024-01-01' },
              language: 'en',
            };
          }
          return defaultValue;
        },
      );

      await loadState();

      expect(setLastAgentTimestamp).toHaveBeenCalledWith({
        '123': '2024-01-01',
      });
      expect(setSessions).toHaveBeenCalled();
      expect(setRegisteredGroups).toHaveBeenCalled();
    });

    it('should handle missing router_state.json gracefully', async () => {
      vi.mocked(loadJson).mockReturnValue({});

      await loadState();

      expect(setLastAgentTimestamp).toHaveBeenCalledWith({});
    });

    it('should set language if valid', async () => {
      vi.mocked(loadJson).mockImplementation((path: string) => {
        if (path.includes('router_state.json')) {
          return { language: 'zh-TW' };
        }
        return {};
      });

      await loadState();

      expect(setLanguage).toHaveBeenCalledWith('zh-TW');
    });

    it('should not set language if invalid', async () => {
      vi.mocked(loadJson).mockImplementation((path: string) => {
        if (path.includes('router_state.json')) {
          return { language: 'invalid-lang' };
        }
        return {};
      });

      await loadState();

      expect(setLanguage).not.toHaveBeenCalled();
    });

    it('should load sessions and registered groups', async () => {
      const sessions = { '1': { lastTimestamp: '2024-01-01' } };
      const groups = {
        '1': { name: 'Test', folder: 'test', persona: 'default' },
      };

      vi.mocked(loadJson).mockImplementation(
        (path: string, defaultValue: any) => {
          if (path.includes('sessions.json')) return sessions;
          if (path.includes('registered_groups.json')) return groups;
          return defaultValue;
        },
      );

      await loadState();

      expect(setSessions).toHaveBeenCalledWith(sessions);
      expect(setRegisteredGroups).toHaveBeenCalledWith(groups);
    });
  });

  describe('saveState', () => {
    it('should save router_state.json with current state', async () => {
      vi.mocked(getLastAgentTimestamp).mockReturnValue({ '123': '2024-01-01' });
      vi.mocked(getSessions).mockReturnValue({
        '1': { lastTimestamp: '2024-01-01' },
      });

      await saveState();

      expect(saveJson).toHaveBeenCalledTimes(2);
      expect(saveJson).toHaveBeenCalledWith(
        expect.stringContaining('router_state.json'),
        expect.objectContaining({
          last_agent_timestamp: { '123': '2024-01-01' },
        }),
      );
    });

    it('should save sessions.json', async () => {
      const sessions = { '1': { lastTimestamp: '2024-01-01' } };
      vi.mocked(getSessions).mockReturnValue(sessions);
      vi.mocked(getLastAgentTimestamp).mockReturnValue({});

      await saveState();

      expect(saveJson).toHaveBeenCalledWith(
        expect.stringContaining('sessions.json'),
        sessions,
      );
    });
  });

  describe('registerGroup', () => {
    it('should register a valid group', () => {
      const group: RegisteredGroup = {
        name: 'Test Group',
        folder: 'test-group',
        persona: 'default',
      };
      const registeredGroups = {};
      vi.mocked(getRegisteredGroups).mockReturnValue(registeredGroups);

      registerGroup('123', group);

      expect(saveJson).toHaveBeenCalled();
      expect(fs.mkdirSync).toHaveBeenCalledTimes(3); // logs, media, knowledge
    });

    it('should create group folders (logs, media, knowledge)', () => {
      const group: RegisteredGroup = {
        name: 'Test Group',
        folder: 'test-group',
        persona: 'default',
      };
      vi.mocked(getRegisteredGroups).mockReturnValue({});

      registerGroup('123', group);

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('test-group/logs'),
        { recursive: true },
      );
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('test-group/media'),
        { recursive: true },
      );
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('test-group/knowledge'),
        { recursive: true },
      );
    });

    it('should reject invalid folder names', () => {
      const group: RegisteredGroup = {
        name: 'Invalid',
        folder: '../etc/passwd',
        persona: 'default',
      };
      vi.mocked(getRegisteredGroups).mockReturnValue({});

      registerGroup('123', group);

      expect(saveJson).not.toHaveBeenCalled();
      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });

    it('should reject folder names with special characters', () => {
      const invalidFolders = [
        'test@group',
        'test group',
        'test/group',
        'test\\group',
      ];
      vi.mocked(getRegisteredGroups).mockReturnValue({});

      for (const folder of invalidFolders) {
        vi.mocked(saveJson).mockClear();
        registerGroup('123', { name: 'Test', folder, persona: 'default' });
        expect(saveJson).not.toHaveBeenCalled();
      }
    });

    it('should accept valid folder names', () => {
      const validFolders = ['test-group', 'test_group', 'TestGroup123', 'ABC'];
      vi.mocked(getRegisteredGroups).mockReturnValue({});

      for (const folder of validFolders) {
        vi.mocked(saveJson).mockClear();
        registerGroup('123', { name: 'Test', folder, persona: 'default' });
        expect(saveJson).toHaveBeenCalled();
      }
    });
  });

  describe('getAvailableGroups', () => {
    it('should return all chats from database', () => {
      const chats = [
        { jid: '1', name: 'Chat 1', last_message_time: 1000 },
        { jid: '2', name: 'Chat 2', last_message_time: 2000 },
      ];
      vi.mocked(getAllChats).mockReturnValue(chats);
      vi.mocked(getRegisteredGroups).mockReturnValue({});

      const result = getAvailableGroups();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        jid: '1',
        name: 'Chat 1',
        lastActivity: 1000,
        isRegistered: false,
      });
    });

    it('should mark registered groups', () => {
      const chats = [
        { jid: '1', name: 'Chat 1', last_message_time: 1000 },
        { jid: '2', name: 'Chat 2', last_message_time: 2000 },
      ];
      vi.mocked(getAllChats).mockReturnValue(chats);
      vi.mocked(getRegisteredGroups).mockReturnValue({
        '1': { name: 'Chat 1', folder: 'chat1', persona: 'default' },
      });

      const result = getAvailableGroups();

      expect(result[0].isRegistered).toBe(true);
      expect(result[1].isRegistered).toBe(false);
    });

    it('should filter out __group_sync__ chat', () => {
      const chats = [
        { jid: '__group_sync__', name: 'Sync', last_message_time: 1000 },
        { jid: '1', name: 'Chat 1', last_message_time: 2000 },
      ];
      vi.mocked(getAllChats).mockReturnValue(chats);
      vi.mocked(getRegisteredGroups).mockReturnValue({});

      const result = getAvailableGroups();

      expect(result).toHaveLength(1);
      expect(result[0].jid).toBe('1');
    });

    it('should return empty array when no chats', () => {
      vi.mocked(getAllChats).mockReturnValue([]);
      vi.mocked(getRegisteredGroups).mockReturnValue({});

      const result = getAvailableGroups();

      expect(result).toEqual([]);
    });
  });
});
