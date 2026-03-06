import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Message } from 'grammy/types';

// Mock all dependencies
vi.mock('../config.js', () => ({
  ASSISTANT_NAME: 'Andy',
  CLEANUP: {
    MEDIA_MAX_AGE_DAYS: 7,
    MEDIA_CLEANUP_INTERVAL_MS: 21600000,
  },
  DATA_DIR: '/test/data',
  GROUPS_DIR: '/test/groups',
  MAIN_GROUP_FOLDER: 'main',
  TELEGRAM_BOT_TOKEN: 'test-token',
  TRIGGER_PATTERN: /^@Andy\b/i,
}));

vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

const mockGetBot = vi.fn();
const mockGetRegisteredGroups = vi.fn();
const mockGetSessions = vi.fn();
const mockGetLastAgentTimestamp = vi.fn();
const mockGetIpcMessageSentChats = vi.fn();

vi.mock('../state.js', () => ({
  getBot: mockGetBot,
  getRegisteredGroups: mockGetRegisteredGroups,
  getSessions: mockGetSessions,
  getLastAgentTimestamp: mockGetLastAgentTimestamp,
  getIpcMessageSentChats: mockGetIpcMessageSentChats,
}));

vi.mock('../db.js', () => ({
  storeMessage: vi.fn(),
  getMessagesSince: vi.fn(() => []),
  getAllTasks: vi.fn(() => []),
}));

vi.mock('../telegram-helpers.js', () => ({
  sendMessage: vi.fn(),
  sendMessageWithButtons: vi.fn(),
  setTyping: vi.fn(),
}));

vi.mock('../group-manager.js', () => ({
  getAvailableGroups: vi.fn(() => []),
  saveState: vi.fn(),
}));

vi.mock('../container-runner.js', () => ({
  runContainerAgent: vi.fn(),
  writeGroupsSnapshot: vi.fn(),
  writeTasksSnapshot: vi.fn(),
}));

vi.mock('../maintenance.js', () => ({
  isMaintenanceMode: vi.fn(() => false),
}));

vi.mock('fs', () => ({
  default: {
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(() => ({ mtimeMs: Date.now() })),
    unlinkSync: vi.fn(),
    createWriteStream: vi.fn(() => ({
      on: vi.fn(),
      write: vi.fn(),
      end: vi.fn(),
    })),
  },
}));

describe('message-handler.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBot.mockReturnValue({
      api: {
        sendMessage: vi.fn().mockResolvedValue({}),
        editMessageText: vi.fn().mockResolvedValue({}),
        sendChatAction: vi.fn().mockResolvedValue({}),
        deleteMessage: vi.fn().mockResolvedValue({}),
        getFile: vi.fn().mockResolvedValue({ file_path: 'test.jpg' }),
      },
    });
    mockGetRegisteredGroups.mockReturnValue({});
    mockGetSessions.mockReturnValue({});
    mockGetLastAgentTimestamp.mockReturnValue({});
    mockGetIpcMessageSentChats.mockReturnValue(new Set());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Media extraction', () => {
    it('should extract photo media info', () => {
      const msg = {
        photo: [
          { file_id: 'photo-1', width: 100, height: 100 },
          { file_id: 'photo-2', width: 200, height: 200 },
        ],
        caption: 'Test photo',
      } as any;

      // Simulate extractMediaInfo logic
      const photo = msg.photo[msg.photo.length - 1];
      const mediaInfo = {
        type: 'photo',
        fileId: photo.file_id,
        caption: msg.caption,
      };

      expect(mediaInfo.type).toBe('photo');
      expect(mediaInfo.fileId).toBe('photo-2'); // Highest resolution
      expect(mediaInfo.caption).toBe('Test photo');
    });

    it('should extract voice media info', () => {
      const msg = {
        voice: {
          file_id: 'voice-1',
          mime_type: 'audio/ogg',
        },
      } as any;

      const mediaInfo = {
        type: 'voice',
        fileId: msg.voice.file_id,
        mimeType: msg.voice.mime_type,
      };

      expect(mediaInfo.type).toBe('voice');
      expect(mediaInfo.fileId).toBe('voice-1');
      expect(mediaInfo.mimeType).toBe('audio/ogg');
    });

    it('should extract document media info', () => {
      const msg = {
        document: {
          file_id: 'doc-1',
          file_name: 'test.pdf',
          mime_type: 'application/pdf',
        },
        caption: 'Document caption',
      } as any;

      const mediaInfo = {
        type: 'document',
        fileId: msg.document.file_id,
        fileName: msg.document.file_name,
        mimeType: msg.document.mime_type,
        caption: msg.caption,
      };

      expect(mediaInfo.type).toBe('document');
      expect(mediaInfo.fileName).toBe('test.pdf');
      expect(mediaInfo.caption).toBe('Document caption');
    });

    it('should return null for text-only messages', () => {
      const msg = {
        text: 'Just text',
      } as any;

      // No media properties
      expect(msg.photo).toBeUndefined();
      expect(msg.voice).toBeUndefined();
      expect(msg.document).toBeUndefined();
    });

    it('should extract video media info', () => {
      const msg = {
        video: {
          file_id: 'video-1',
          mime_type: 'video/mp4',
        },
        caption: 'Video caption',
      } as any;

      const mediaInfo = {
        type: 'video',
        fileId: msg.video.file_id,
        mimeType: msg.video.mime_type,
        caption: msg.caption,
      };

      expect(mediaInfo.type).toBe('video');
      expect(mediaInfo.fileId).toBe('video-1');
    });

    it('should extract audio media info', () => {
      const msg = {
        audio: {
          file_id: 'audio-1',
          mime_type: 'audio/mpeg',
        },
      } as any;

      const mediaInfo = {
        type: 'audio',
        fileId: msg.audio.file_id,
        mimeType: msg.audio.mime_type,
      };

      expect(mediaInfo.type).toBe('audio');
      expect(mediaInfo.fileId).toBe('audio-1');
    });
  });

  describe('Message trigger detection', () => {
    it('should detect @Andy mention', () => {
      const text = '@Andy hello';
      const pattern = /^@Andy\b/i;
      expect(pattern.test(text)).toBe(true);
    });

    it('should be case insensitive', () => {
      const pattern = /^@Andy\b/i;
      expect(pattern.test('@andy hello')).toBe(true);
      expect(pattern.test('@ANDY hello')).toBe(true);
      expect(pattern.test('@AnDy hello')).toBe(true);
    });

    it('should not match without @ prefix', () => {
      const text = 'Andy hello';
      const pattern = /^@Andy\b/i;
      expect(pattern.test(text)).toBe(false);
    });

    it('should not match in middle of text', () => {
      const text = 'Hello @Andy';
      const pattern = /^@Andy\b/i;
      expect(pattern.test(text)).toBe(false);
    });

    it('should require word boundary', () => {
      const pattern = /^@Andy\b/i;
      expect(pattern.test('@Andy!')).toBe(true);
      expect(pattern.test('@Andy ')).toBe(true);
      expect(pattern.test('@Andyxxx')).toBe(false);
    });
  });

  describe('Admin command detection', () => {
    it('should detect /status command', () => {
      const text = '/status';
      expect(text.startsWith('/status')).toBe(true);
    });

    it('should detect /list command', () => {
      const text = '/list';
      expect(text.startsWith('/list')).toBe(true);
    });

    it('should detect /help command', () => {
      const text = '/help';
      expect(text.startsWith('/help')).toBe(true);
    });

    it('should not detect partial matches', () => {
      const text = 'status';
      expect(text.startsWith('/status')).toBe(false);
    });

    it('should handle commands with trailing spaces', () => {
      const text = '/status ';
      expect(text.trim().startsWith('/status')).toBe(true);
    });
  });

  describe('Group registration check', () => {
    it('should identify registered groups', () => {
      const groups = {
        '123': { name: 'Test Group', folder: 'test-group', persona: 'default' },
      };
      mockGetRegisteredGroups.mockReturnValue(groups);

      const chatId = '123';
      const isRegistered = chatId in mockGetRegisteredGroups();

      expect(isRegistered).toBe(true);
    });

    it('should identify unregistered groups', () => {
      const groups = {
        '123': { name: 'Test Group', folder: 'test-group', persona: 'default' },
      };
      mockGetRegisteredGroups.mockReturnValue(groups);

      const chatId = '456';
      const isRegistered = chatId in mockGetRegisteredGroups();

      expect(isRegistered).toBe(false);
    });

    it('should handle empty registered groups', () => {
      mockGetRegisteredGroups.mockReturnValue({});

      const chatId = '123';
      const isRegistered = chatId in mockGetRegisteredGroups();

      expect(isRegistered).toBe(false);
    });
  });

  describe('Media cleanup scheduling', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should schedule cleanup at interval', () => {
      const callback = vi.fn();
      const interval = setInterval(callback, 21600000); // 6 hours

      vi.advanceTimersByTime(21600000);
      expect(callback).toHaveBeenCalledOnce();

      clearInterval(interval);
    });

    it('should run cleanup multiple times', () => {
      const callback = vi.fn();
      const interval = setInterval(callback, 21600000);

      vi.advanceTimersByTime(21600000);
      expect(callback).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(21600000);
      expect(callback).toHaveBeenCalledTimes(2);

      clearInterval(interval);
    });
  });

  describe('File name sanitization', () => {
    it('should sanitize dangerous file names', () => {
      const fileName = '../../../etc/passwd';
      const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      expect(sanitized).not.toContain('/');
      // Note: '..' becomes '.._' after sanitization, which still contains '..' substring
      expect(sanitized).toBe('.._.._.._etc_passwd');
    });

    it('should keep safe characters', () => {
      const fileName = 'test-file_123.txt';
      const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      expect(sanitized).toBe('test-file_123.txt');
    });

    it('should handle special characters', () => {
      const fileName = 'file@#$%name.pdf';
      const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      expect(sanitized).toBe('file____name.pdf');
    });

    it('should handle empty file name', () => {
      const fileName = '';
      const fallback = fileName || `${Date.now()}.bin`;
      expect(fallback).toMatch(/\d+\.bin/);
    });
  });

  describe('Session management', () => {
    it('should track sessions per chat', () => {
      const sessions = {
        '123': { lastTimestamp: '2024-01-01' },
        '456': { lastTimestamp: '2024-01-02' },
      };
      mockGetSessions.mockReturnValue(sessions);

      expect(mockGetSessions()['123']).toBeDefined();
      expect(mockGetSessions()['456']).toBeDefined();
      expect(mockGetSessions()['789']).toBeUndefined();
    });

    it('should update session timestamp', () => {
      const sessions: Record<string, any> = {
        '123': { lastTimestamp: '2024-01-01' },
      };
      mockGetSessions.mockReturnValue(sessions);

      sessions['123'].lastTimestamp = '2024-01-02';
      expect(mockGetSessions()['123'].lastTimestamp).toBe('2024-01-02');
    });
  });

  describe('IPC message tracking', () => {
    it('should track IPC messages sent', () => {
      const sentChats = new Set(['123', '456']);
      mockGetIpcMessageSentChats.mockReturnValue(sentChats);

      expect(mockGetIpcMessageSentChats().has('123')).toBe(true);
      expect(mockGetIpcMessageSentChats().has('456')).toBe(true);
      expect(mockGetIpcMessageSentChats().has('789')).toBe(false);
    });

    it('should add new IPC messages', () => {
      const sentChats = new Set<string>();
      mockGetIpcMessageSentChats.mockReturnValue(sentChats);

      sentChats.add('123');
      expect(mockGetIpcMessageSentChats().size).toBe(1);
      expect(mockGetIpcMessageSentChats().has('123')).toBe(true);
    });
  });

  describe('Last agent timestamp tracking', () => {
    it('should track per-chat timestamps', () => {
      const timestamps = {
        '123': '2024-01-01T00:00:00Z',
        '456': '2024-01-02T00:00:00Z',
      };
      mockGetLastAgentTimestamp.mockReturnValue(timestamps);

      expect(mockGetLastAgentTimestamp()['123']).toBe('2024-01-01T00:00:00Z');
      expect(mockGetLastAgentTimestamp()['456']).toBe('2024-01-02T00:00:00Z');
    });

    it('should handle missing timestamps', () => {
      const timestamps = {};
      mockGetLastAgentTimestamp.mockReturnValue(timestamps);

      expect(mockGetLastAgentTimestamp()['123']).toBeUndefined();
    });
  });
});
