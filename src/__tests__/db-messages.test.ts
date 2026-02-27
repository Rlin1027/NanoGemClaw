import {
  vi,
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from 'vitest';

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
import {
  initDatabase,
  closeDatabase,
  storeChatMetadata,
  updateChatName,
  getAllChats,
  getLastGroupSync,
  setLastGroupSync,
  storeMessage,
  getNewMessages,
  getMessagesSince,
  getMessageById,
  getGroupMessageStats,
  getMessagesForSummary,
  deleteOldMessages,
  getRecentConversation,
} from '../db.js';
import { resetDatabase, cleanupTestDir } from './helpers/db-test-setup.js';

describe('db/messages', () => {
  beforeAll(() => {
    initDatabase();
  });

  afterAll(() => {
    closeDatabase();
    cleanupTestDir(TEST_STORE_DIR);
  });

  describe('Chat Metadata', () => {
    beforeEach(() => resetDatabase(TEST_STORE_DIR));

    it('should store chat metadata with name', () => {
      const chatJid = 'chat1@g.us';
      const timestamp = '2026-02-08T10:00:00Z';
      const name = 'Test Chat 1';

      storeChatMetadata(chatJid, timestamp, name);

      const chats = getAllChats();
      expect(chats).toHaveLength(1);
      expect(chats[0].jid).toBe(chatJid);
      expect(chats[0].name).toBe(name);
      expect(chats[0].last_message_time).toBe(timestamp);
    });

    it('should store chat metadata without name', () => {
      const chatJid = 'chat2@g.us';
      const timestamp = '2026-02-08T11:00:00Z';

      storeChatMetadata(chatJid, timestamp);

      const chats = getAllChats();
      const chat = chats.find((c) => c.jid === chatJid);
      expect(chat).toBeDefined();
      expect(chat?.name).toBe(chatJid); // Name defaults to jid
    });

    it('should update chat name', () => {
      const chatJid = 'chat3@g.us';
      const initialTimestamp = '2026-02-08T12:00:00Z';
      const newName = 'Updated Chat Name';

      storeChatMetadata(chatJid, initialTimestamp);
      updateChatName(chatJid, newName);

      const chats = getAllChats();
      const chat = chats.find((c) => c.jid === chatJid);
      expect(chat?.name).toBe(newName);
    });

    it('should preserve newer timestamp on conflict', () => {
      const chatJid = 'chat4@g.us';
      const olderTimestamp = '2026-02-08T10:00:00Z';
      const newerTimestamp = '2026-02-08T12:00:00Z';

      storeChatMetadata(chatJid, newerTimestamp);
      storeChatMetadata(chatJid, olderTimestamp); // Should not overwrite

      const chats = getAllChats();
      const chat = chats.find((c) => c.jid === chatJid);
      expect(chat?.last_message_time).toBe(newerTimestamp);
    });

    it('should return chats ordered by most recent activity', () => {
      const chat1 = 'order_test_old@g.us';
      const chat2 = 'order_test_new@g.us';

      storeChatMetadata(chat1, '2026-02-08T10:00:00Z');
      storeChatMetadata(chat2, '2026-02-08T12:00:00Z');

      const chats = getAllChats();
      const chat1Index = chats.findIndex((c) => c.jid === chat1);
      const chat2Index = chats.findIndex((c) => c.jid === chat2);
      expect(chat2Index).toBeLessThan(chat1Index); // More recent chat should come first
    });
  });

  describe('Group Sync Tracking', () => {
    beforeEach(() => resetDatabase(TEST_STORE_DIR));

    it('should return null when no sync has occurred', () => {
      const lastSync = getLastGroupSync();
      expect(lastSync).toBeNull();
    });

    it('should record and retrieve group sync timestamp', () => {
      setLastGroupSync();
      const lastSync = getLastGroupSync();
      expect(lastSync).toBeTruthy();
      expect(typeof lastSync).toBe('string');
    });

    it('should update group sync timestamp', async () => {
      setLastGroupSync();
      const firstSync = getLastGroupSync();

      // Wait a bit and sync again
      await new Promise((resolve) => setTimeout(resolve, 10));
      setLastGroupSync();
      const secondSync = getLastGroupSync();
      expect(secondSync).not.toBe(firstSync);
      expect(secondSync! > firstSync!).toBe(true);
    });
  });

  describe('Message Storage', () => {
    beforeEach(() => resetDatabase(TEST_STORE_DIR));

    it('should store a message', () => {
      const msgId = 'msg1';
      const chatId = 'chat1@g.us';
      const senderId = 'user1@s.whatsapp.net';
      const senderName = 'User One';
      const content = 'Hello World';
      const timestamp = '2026-02-08T10:00:00Z';

      // Create chat first (foreign key requirement)
      storeChatMetadata(chatId, timestamp);
      storeMessage(
        msgId,
        chatId,
        senderId,
        senderName,
        content,
        timestamp,
        false,
      );

      const message = getMessageById(chatId, msgId);
      expect(message).toBeDefined();
      expect(message?.content).toBe(content);
      expect(message?.sender_name).toBe(senderName);
    });

    it('should replace message on duplicate id', () => {
      const msgId = 'msg2';
      const chatId = 'chat1@g.us';
      const initialContent = 'Initial content';
      const updatedContent = 'Updated content';

      // Create chat first (foreign key requirement)
      storeChatMetadata(chatId, '2026-02-08T10:00:00Z');
      storeMessage(
        msgId,
        chatId,
        'user@s.whatsapp.net',
        'User',
        initialContent,
        '2026-02-08T10:00:00Z',
        false,
      );
      storeMessage(
        msgId,
        chatId,
        'user@s.whatsapp.net',
        'User',
        updatedContent,
        '2026-02-08T10:00:00Z',
        false,
      );

      const message = getMessageById(chatId, msgId);
      expect(message?.content).toBe(updatedContent);
    });

    it('should retrieve new messages since timestamp', () => {
      const chatId = 'chat2@g.us';
      const botPrefix = 'Bot';

      // Create chat first (foreign key requirement)
      storeChatMetadata(chatId, '2026-02-08T12:00:00Z');
      storeMessage(
        'msg3',
        chatId,
        'user@s.whatsapp.net',
        'User',
        'User message',
        '2026-02-08T10:00:00Z',
        false,
      );
      storeMessage(
        'msg4',
        chatId,
        'user@s.whatsapp.net',
        'User',
        'Another message',
        '2026-02-08T11:00:00Z',
        false,
      );
      storeMessage(
        'msg5',
        chatId,
        'bot@s.whatsapp.net',
        'Bot',
        'Bot: Response',
        '2026-02-08T12:00:00Z',
        true,
      );

      const result = getNewMessages(
        [chatId],
        '2026-02-08T09:00:00Z',
        botPrefix,
      );

      expect(result.messages).toHaveLength(2); // Bot message filtered out
      expect(result.messages[0].content).toBe('User message');
      expect(result.newTimestamp).toBe('2026-02-08T11:00:00Z');
    });

    it('should filter out bot messages by prefix', () => {
      const chatId = 'chat3@g.us';
      const botPrefix = 'GemBot';

      // Create chat first (foreign key requirement)
      storeChatMetadata(chatId, '2026-02-08T11:00:00Z');
      storeMessage(
        'msg6',
        chatId,
        'user@s.whatsapp.net',
        'User',
        'Hello',
        '2026-02-08T10:00:00Z',
        false,
      );
      storeMessage(
        'msg7',
        chatId,
        'bot@s.whatsapp.net',
        'GemBot',
        'GemBot: Hi',
        '2026-02-08T11:00:00Z',
        true,
      );

      const messages = getMessagesSince(
        chatId,
        '2026-02-08T09:00:00Z',
        botPrefix,
      );

      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Hello');
    });

    it('should return messages ordered by timestamp', () => {
      const chatId = 'chat4@g.us';

      // Create chat first (foreign key requirement)
      storeChatMetadata(chatId, '2026-02-08T12:00:00Z');
      storeMessage(
        'msg8',
        chatId,
        'user@s.whatsapp.net',
        'User',
        'Third',
        '2026-02-08T12:00:00Z',
        false,
      );
      storeMessage(
        'msg9',
        chatId,
        'user@s.whatsapp.net',
        'User',
        'First',
        '2026-02-08T10:00:00Z',
        false,
      );
      storeMessage(
        'msg10',
        chatId,
        'user@s.whatsapp.net',
        'User',
        'Second',
        '2026-02-08T11:00:00Z',
        false,
      );

      const messages = getMessagesSince(chatId, '2026-02-08T09:00:00Z', '');

      expect(messages).toHaveLength(3);
      expect(messages[0].content).toBe('First');
      expect(messages[2].content).toBe('Third');
    });

    it('should return empty array for empty jids', () => {
      const result = getNewMessages([], '2026-02-08T10:00:00Z', 'Bot');
      expect(result.messages).toHaveLength(0);
      expect(result.newTimestamp).toBe('2026-02-08T10:00:00Z');
    });

    it('should return undefined for non-existent message', () => {
      const message = getMessageById('nonexistent@g.us', 'nonexistent');
      expect(message).toBeUndefined();
    });
  });

  describe('Message Statistics and Archiving', () => {
    beforeEach(() => resetDatabase(TEST_STORE_DIR));

    it('should return null for chat with no messages', () => {
      const stats = getGroupMessageStats('empty@g.us');
      // better-sqlite3's .get() returns undefined when no row is found
      expect(stats).toBeUndefined();
    });

    it('should get message stats for chat', () => {
      const chatJid = 'stats_chat@g.us';

      // Create chat first (foreign key requirement)
      storeChatMetadata(chatJid, '2026-02-08T11:00:00Z');
      storeMessage(
        'msg1',
        chatJid,
        'user@s.whatsapp.net',
        'User',
        'Hello',
        '2026-02-08T10:00:00Z',
        false,
      );
      storeMessage(
        'msg2',
        chatJid,
        'user@s.whatsapp.net',
        'User',
        'World',
        '2026-02-08T11:00:00Z',
        false,
      );

      const stats = getGroupMessageStats(chatJid);
      expect(stats).toBeDefined();
      expect(stats?.message_count).toBe(2);
      expect(stats?.oldest_timestamp).toBe('2026-02-08T10:00:00Z');
      expect(stats?.newest_timestamp).toBe('2026-02-08T11:00:00Z');
    });

    it('should get messages for summary with limit', () => {
      const chatJid = 'summary_chat@g.us';

      // Create chat first (foreign key requirement)
      storeChatMetadata(chatJid, '2026-02-08T19:00:00Z');
      for (let i = 0; i < 10; i++) {
        storeMessage(
          `msg${i}`,
          chatJid,
          'user@s.whatsapp.net',
          'User',
          `Message ${i}`,
          `2026-02-08T${String(10 + i).padStart(2, '0')}:00:00Z`,
          false,
        );
      }

      const messages = getMessagesForSummary(chatJid, 5);
      expect(messages).toHaveLength(5);
      expect(messages[0].content).toBe('Message 0'); // Ordered by timestamp ASC
    });

    it('should delete old messages', () => {
      const chatJid = 'delete_chat@g.us';

      // Create chat first (foreign key requirement)
      storeChatMetadata(chatJid, '2026-02-08T10:00:00Z');
      storeMessage(
        'old1',
        chatJid,
        'user@s.whatsapp.net',
        'User',
        'Old',
        '2026-02-01T10:00:00Z',
        false,
      );
      storeMessage(
        'old2',
        chatJid,
        'user@s.whatsapp.net',
        'User',
        'Old2',
        '2026-02-02T10:00:00Z',
        false,
      );
      storeMessage(
        'new1',
        chatJid,
        'user@s.whatsapp.net',
        'User',
        'New',
        '2026-02-08T10:00:00Z',
        false,
      );

      const deleted = deleteOldMessages(chatJid, '2026-02-05T00:00:00Z');
      expect(deleted).toBe(2);

      const stats = getGroupMessageStats(chatJid);
      expect(stats?.message_count).toBe(1);
    });
  });

  describe('Forum Topics Thread Filtering', () => {
    beforeEach(() => resetDatabase(TEST_STORE_DIR));

    it('should store message with messageThreadId', () => {
      const chatId = 'forum_chat@g.us';
      storeChatMetadata(chatId, '2026-02-08T10:00:00Z');
      storeMessage('msg1', chatId, 'user1', 'User', 'Hello from topic', '2026-02-08T10:00:00Z', false, '12345');

      const message = getMessageById(chatId, 'msg1');
      expect(message).toBeDefined();
      expect(message?.content).toBe('Hello from topic');
    });

    it('should store message without messageThreadId (backward compat)', () => {
      const chatId = 'normal_chat@g.us';
      storeChatMetadata(chatId, '2026-02-08T10:00:00Z');
      storeMessage('msg1', chatId, 'user1', 'User', 'Hello', '2026-02-08T10:00:00Z', false);

      const message = getMessageById(chatId, 'msg1');
      expect(message).toBeDefined();
      expect(message?.content).toBe('Hello');
    });

    it('should filter getRecentConversation by specific thread', () => {
      const chatId = 'forum_filter@g.us';
      storeChatMetadata(chatId, '2026-02-08T12:00:00Z');
      // Thread A messages
      storeMessage('t1', chatId, 'user1', 'User', 'Topic A msg 1', '2026-02-08T10:00:00Z', false, '100');
      storeMessage('t2', chatId, 'user1', 'User', 'Topic A msg 2', '2026-02-08T10:01:00Z', false, '100');
      // Thread B messages
      storeMessage('t3', chatId, 'user1', 'User', 'Topic B msg 1', '2026-02-08T10:02:00Z', false, '200');
      // No-thread message
      storeMessage('t4', chatId, 'user1', 'User', 'General msg', '2026-02-08T10:03:00Z', false);

      const threadA = getRecentConversation(chatId, 50, '100');
      expect(threadA).toHaveLength(2);
      expect(threadA[0].text).toBe('Topic A msg 1');
      expect(threadA[1].text).toBe('Topic A msg 2');
    });

    it('should filter getRecentConversation for non-forum messages (null)', () => {
      const chatId = 'forum_null@g.us';
      storeChatMetadata(chatId, '2026-02-08T12:00:00Z');
      storeMessage('t1', chatId, 'user1', 'User', 'In topic', '2026-02-08T10:00:00Z', false, '100');
      storeMessage('t2', chatId, 'user1', 'User', 'No topic', '2026-02-08T10:01:00Z', false);

      const noThread = getRecentConversation(chatId, 50, null);
      expect(noThread).toHaveLength(1);
      expect(noThread[0].text).toBe('No topic');
    });

    it('should return all messages when no thread filter (backward compat)', () => {
      const chatId = 'forum_all@g.us';
      storeChatMetadata(chatId, '2026-02-08T12:00:00Z');
      storeMessage('t1', chatId, 'user1', 'User', 'In topic', '2026-02-08T10:00:00Z', false, '100');
      storeMessage('t2', chatId, 'user1', 'User', 'No topic', '2026-02-08T10:01:00Z', false);

      const all = getRecentConversation(chatId, 50);
      expect(all).toHaveLength(2);
    });

    it('should filter getMessagesSince by specific thread', () => {
      const chatId = 'forum_since@g.us';
      storeChatMetadata(chatId, '2026-02-08T12:00:00Z');
      storeMessage('t1', chatId, 'user1', 'User', 'Topic A', '2026-02-08T10:00:00Z', false, '100');
      storeMessage('t2', chatId, 'user1', 'User', 'Topic B', '2026-02-08T10:01:00Z', false, '200');
      storeMessage('t3', chatId, 'user1', 'User', 'General', '2026-02-08T10:02:00Z', false);

      const threadA = getMessagesSince(chatId, '2026-02-08T09:00:00Z', 'Bot', '100');
      expect(threadA).toHaveLength(1);
      expect(threadA[0].content).toBe('Topic A');
    });

    it('should filter getMessagesSince for non-forum (null)', () => {
      const chatId = 'forum_since_null@g.us';
      storeChatMetadata(chatId, '2026-02-08T12:00:00Z');
      storeMessage('t1', chatId, 'user1', 'User', 'In topic', '2026-02-08T10:00:00Z', false, '100');
      storeMessage('t2', chatId, 'user1', 'User', 'General', '2026-02-08T10:01:00Z', false);

      const general = getMessagesSince(chatId, '2026-02-08T09:00:00Z', 'Bot', null);
      expect(general).toHaveLength(1);
      expect(general[0].content).toBe('General');
    });

    it('should return all messages in getMessagesSince without thread filter', () => {
      const chatId = 'forum_since_all@g.us';
      storeChatMetadata(chatId, '2026-02-08T12:00:00Z');
      storeMessage('t1', chatId, 'user1', 'User', 'Topic A', '2026-02-08T10:00:00Z', false, '100');
      storeMessage('t2', chatId, 'user1', 'User', 'General', '2026-02-08T10:01:00Z', false);

      const all = getMessagesSince(chatId, '2026-02-08T09:00:00Z', 'Bot');
      expect(all).toHaveLength(2);
    });
  });
});
