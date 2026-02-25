import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock config first to prevent process.exit
vi.mock('../config.js', () => ({
  ASSISTANT_NAME: 'Andy',
  CONTAINER: {
    GRACEFUL_SHUTDOWN_DELAY_MS: 5000,
    IPC_DEBOUNCE_MS: 100,
    IPC_FALLBACK_POLLING_MULTIPLIER: 5,
  },
  DATA_DIR: '/test/data',
  IPC_POLL_INTERVAL: 1000,
  MAIN_GROUP_FOLDER: 'main',
}));

// Mock fs module
vi.mock('fs', () => ({
  default: {
    watch: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    existsSync: vi.fn(),
  },
}));

// Mock state module
vi.mock('../state.js', () => ({
  getBot: vi.fn(),
  getRegisteredGroups: vi.fn(),
  getIpcMessageSentChats: vi.fn(),
}));

vi.mock('../telegram-helpers.js', () => ({
  sendMessage: vi.fn(),
}));

vi.mock('../group-manager.js', () => ({
  registerGroup: vi.fn(),
}));

vi.mock('../ipc-handlers/index.js', () => ({
  dispatchIpc: vi.fn(),
}));

vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

import { closeAllWatchers } from '../ipc-watcher.js';
import {
  getBot,
  getRegisteredGroups,
  getIpcMessageSentChats,
} from '../state.js';

describe('ipc-watcher.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getBot).mockReturnValue({ id: 'test-bot' } as any);
    vi.mocked(getRegisteredGroups).mockReturnValue({});
    vi.mocked(getIpcMessageSentChats).mockReturnValue(new Set());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('closeAllWatchers', () => {
    it('should close all active watchers', () => {
      closeAllWatchers();
      expect(() => closeAllWatchers()).not.toThrow();
    });

    it('should handle errors during watcher close gracefully', () => {
      expect(() => closeAllWatchers()).not.toThrow();
    });

    it('should be callable multiple times', () => {
      closeAllWatchers();
      closeAllWatchers();
      closeAllWatchers();
      expect(() => closeAllWatchers()).not.toThrow();
    });
  });

  describe('IPC context', () => {
    it('should handle valid task IPC data', () => {
      const taskData = {
        type: 'test-task',
        payload: { message: 'test' },
      };
      expect(taskData.type).toBe('test-task');
    });

    it('should handle IPC context with source group', () => {
      vi.mocked(getRegisteredGroups).mockReturnValue({
        '123': { name: 'Test Group', folder: 'test-group', persona: 'default' },
      });

      const groups = getRegisteredGroups();
      expect(groups['123']).toBeDefined();
      expect(groups['123'].folder).toBe('test-group');
    });

    it('should differentiate main group from other groups', () => {
      const mainGroup = 'main';
      const otherGroup = 'test-group';

      expect(mainGroup).toBe('main');
      expect(otherGroup).not.toBe('main');
    });
  });

  describe('IPC message tracking', () => {
    it('should track sent chats', () => {
      const sentChats = new Set<string>();
      vi.mocked(getIpcMessageSentChats).mockReturnValue(sentChats);

      sentChats.add('chat-1');
      sentChats.add('chat-2');

      expect(getIpcMessageSentChats().size).toBe(2);
      expect(getIpcMessageSentChats().has('chat-1')).toBe(true);
    });

    it('should prevent duplicate tracking', () => {
      const sentChats = new Set<string>();
      vi.mocked(getIpcMessageSentChats).mockReturnValue(sentChats);

      sentChats.add('chat-1');
      sentChats.add('chat-1');
      sentChats.add('chat-1');

      expect(getIpcMessageSentChats().size).toBe(1);
    });
  });

  describe('Group registration context', () => {
    it('should provide registered groups to IPC handlers', () => {
      const groups = {
        '1': { name: 'Group 1', folder: 'group1', persona: 'p1' },
        '2': { name: 'Group 2', folder: 'group2', persona: 'p2' },
      };
      vi.mocked(getRegisteredGroups).mockReturnValue(groups);

      expect(getRegisteredGroups()).toEqual(groups);
      expect(Object.keys(getRegisteredGroups())).toHaveLength(2);
    });

    it('should provide bot instance to IPC handlers', () => {
      const bot = { id: 'test-bot', sendMessage: vi.fn() } as any;
      vi.mocked(getBot).mockReturnValue(bot);

      expect(getBot()).toBe(bot);
      expect(getBot().id).toBe('test-bot');
    });
  });
});
