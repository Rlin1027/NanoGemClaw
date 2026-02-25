import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../db.js', () => ({
  getAllChatsPaginated: vi.fn(() => ({ rows: [], total: 0 })),
  getTasksForGroup: vi.fn(() => []),
  getUsageStats: vi.fn(() => ({})),
  getErrorState: vi.fn(() => null),
  getConversationExport: vi.fn(() => ({ messages: [] })),
  formatExportAsMarkdown: vi.fn(() => '# Export'),
  getPreferences: vi.fn(() => ({})),
  setPreference: vi.fn(),
  getMemorySummary: vi.fn(() => null),
  getDatabase: vi.fn(() => ({})),
  searchMessages: vi.fn(() => []),
}));

vi.mock('../utils/pagination.js', () => ({
  parsePagination: vi.fn(() => ({ limit: 20, offset: 0 })),
}));

vi.mock('../personas.js', () => ({
  getAllPersonas: vi.fn(() => ({
    default: {
      name: 'Default',
      description: '',
      systemPrompt: 'You are helpful.',
    },
  })),
  saveCustomPersona: vi.fn(),
  deleteCustomPersona: vi.fn(() => true),
}));

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../config.js', () => ({
  GROUPS_DIR: '/test/groups',
  DATA_DIR: '/test/data',
}));

vi.mock('../search.js', () => ({
  searchMessages: vi.fn(() => []),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => 'prompt content'),
    readdirSync: vi.fn(() => []),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    statSync: vi.fn(() => ({ isFile: () => true, size: 100, mtimeMs: 1000 })),
  },
}));

import request from 'supertest';
import { createTestApp, createMockDeps } from './helpers/route-test-setup.js';
import { createGroupsRouter } from '../routes/groups.js';
import * as dbModule from '../db.js';
import * as paginationModule from '../utils/pagination.js';
import * as personasModule from '../personas.js';
import * as searchModule from '../search.js';
import fs from 'fs';

function createGroupsDeps(overrides = {}) {
  const base = createMockDeps();
  return {
    ...base,
    groupsProvider: vi.fn(() => [
      { id: 'grp1', folder: 'grp1', name: 'Group One' },
    ]),
    groupRegistrar: vi.fn((chatId: string, name: string) => ({
      id: chatId,
      folder: chatId,
      name,
    })),
    groupUpdater: vi.fn(
      (_folder: string, updates: Record<string, unknown>) => ({
        id: 'grp1',
        folder: 'grp1',
        name: 'Group One',
        ...updates,
      }),
    ),
    chatJidResolver: vi.fn((_folder: string) => '-100123456'),
    ...overrides,
  };
}

describe('routes/groups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // GET /api/groups
  describe('GET /api/groups', () => {
    it('returns groups list', async () => {
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app).get('/api/groups');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('returns empty array when provider returns none', async () => {
      const deps = createGroupsDeps({ groupsProvider: vi.fn(() => []) });
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app).get('/api/groups');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  // GET /api/groups/discover
  describe('GET /api/groups/discover', () => {
    it('returns paginated chats', async () => {
      vi.mocked(dbModule.getAllChatsPaginated).mockReturnValue({
        rows: [{ id: '1' }],
        total: 1,
      });
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app).get('/api/groups/discover');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('pagination');
    });

    it('returns empty when no chats', async () => {
      vi.mocked(dbModule.getAllChatsPaginated).mockReturnValue({
        rows: [],
        total: 0,
      });
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app).get('/api/groups/discover');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.total).toBe(0);
    });
  });

  // POST /api/groups/:chatId/register
  describe('POST /api/groups/:chatId/register', () => {
    it('registers a group', async () => {
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app)
        .post('/api/groups/-100123456/register')
        .send({ name: 'My Group' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
    });

    it('returns 400 for invalid chatId', async () => {
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app)
        .post('/api/groups/notanumber/register')
        .send({ name: 'My Group' });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('returns 400 when name missing', async () => {
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app)
        .post('/api/groups/-100123/register')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/name/i);
    });

    it('returns 503 when registrar not available', async () => {
      const deps = createGroupsDeps({ groupRegistrar: null });
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app)
        .post('/api/groups/-100123/register')
        .send({ name: 'My Group' });
      expect(res.status).toBe(503);
    });
  });

  // GET /api/groups/:folder/detail
  describe('GET /api/groups/:folder/detail', () => {
    it('returns group detail', async () => {
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app).get('/api/groups/grp1/detail');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
    });

    it('returns 400 for invalid folder', async () => {
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app).get('/api/groups/bad!folder/detail');
      expect(res.status).toBe(400);
    });

    it('returns 404 when group not found', async () => {
      const deps = createGroupsDeps({ groupsProvider: vi.fn(() => []) });
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app).get('/api/groups/grp1/detail');
      expect(res.status).toBe(404);
    });
  });

  // PUT /api/groups/:folder
  describe('PUT /api/groups/:folder', () => {
    it('updates a group', async () => {
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app)
        .put('/api/groups/grp1')
        .send({ name: 'Updated' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
    });

    it('returns 400 for invalid folder', async () => {
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app)
        .put('/api/groups/bad!folder')
        .send({ name: 'x' });
      expect(res.status).toBe(400);
    });

    it('returns 503 when updater not available', async () => {
      const deps = createGroupsDeps({ groupUpdater: null });
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app)
        .put('/api/groups/grp1')
        .send({ name: 'x' });
      expect(res.status).toBe(503);
    });

    it('returns 404 when group not found', async () => {
      const deps = createGroupsDeps({ groupUpdater: vi.fn(() => null) });
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app)
        .put('/api/groups/grp1')
        .send({ name: 'x' });
      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid persona', async () => {
      vi.mocked(personasModule.getAllPersonas).mockReturnValue({});
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app)
        .put('/api/groups/grp1')
        .send({ persona: 'nonexistent' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/persona/i);
    });

    it('returns 400 for invalid geminiModel', async () => {
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app)
        .put('/api/groups/grp1')
        .send({ geminiModel: 'bad-model' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/model/i);
    });
  });

  // GET /api/personas
  describe('GET /api/personas', () => {
    it('returns personas', async () => {
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app).get('/api/personas');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
    });
  });

  // POST /api/personas
  describe('POST /api/personas', () => {
    it('creates a persona', async () => {
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app).post('/api/personas').send({
        key: 'my-persona',
        name: 'My Persona',
        systemPrompt: 'You are...',
      });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('key', 'my-persona');
    });

    it('returns 400 when required fields missing', async () => {
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app)
        .post('/api/personas')
        .send({ key: 'test' });
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid key format', async () => {
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app)
        .post('/api/personas')
        .send({ key: 'bad key!', name: 'Test', systemPrompt: 'You are...' });
      expect(res.status).toBe(400);
    });
  });

  // DELETE /api/personas/:key
  describe('DELETE /api/personas/:key', () => {
    it('deletes a persona', async () => {
      vi.mocked(personasModule.deleteCustomPersona).mockReturnValue(true);
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app).delete('/api/personas/my-persona');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('success', true);
    });

    it('returns 404 when persona not found', async () => {
      vi.mocked(personasModule.deleteCustomPersona).mockReturnValue(false);
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app).delete('/api/personas/nope');
      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid key', async () => {
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app).delete('/api/personas/bad!key');
      expect(res.status).toBe(400);
    });
  });

  // GET /api/groups/:folder/preferences
  describe('GET /api/groups/:folder/preferences', () => {
    it('returns preferences', async () => {
      vi.mocked(dbModule.getPreferences).mockReturnValue({
        language: 'en',
      } as any);
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app).get('/api/groups/grp1/preferences');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
    });

    it('returns 400 for invalid folder', async () => {
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app).get('/api/groups/bad!folder/preferences');
      expect(res.status).toBe(400);
    });
  });

  // PUT /api/groups/:folder/preferences
  describe('PUT /api/groups/:folder/preferences', () => {
    it('saves a preference', async () => {
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app)
        .put('/api/groups/grp1/preferences')
        .send({ key: 'language', value: 'fr' });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ key: 'language', value: 'fr' });
    });

    it('returns 400 for invalid folder', async () => {
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app)
        .put('/api/groups/bad!folder/preferences')
        .send({ key: 'language', value: 'fr' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when key missing', async () => {
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app)
        .put('/api/groups/grp1/preferences')
        .send({ value: 'fr' });
      expect(res.status).toBe(400);
    });

    it('returns 400 for disallowed key', async () => {
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app)
        .put('/api/groups/grp1/preferences')
        .send({ key: 'not_allowed', value: 'x' });
      expect(res.status).toBe(400);
    });
  });

  // GET /api/groups/:folder/export
  describe('GET /api/groups/:folder/export', () => {
    it('returns JSON export', async () => {
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app).get('/api/groups/grp1/export');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
    });

    it('returns markdown export', async () => {
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app).get('/api/groups/grp1/export?format=md');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/markdown/);
    });

    it('returns 400 for invalid folder', async () => {
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app).get('/api/groups/bad!folder/export');
      expect(res.status).toBe(400);
    });

    it('returns 503 when resolver not available', async () => {
      const deps = createGroupsDeps({ chatJidResolver: null });
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app).get('/api/groups/grp1/export');
      expect(res.status).toBe(503);
    });

    it('returns 404 when chat not resolved', async () => {
      const deps = createGroupsDeps({ chatJidResolver: vi.fn(() => null) });
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app).get('/api/groups/grp1/export');
      expect(res.status).toBe(404);
    });
  });

  // GET /api/prompt/:groupFolder
  describe('GET /api/prompt/:groupFolder', () => {
    it('returns prompt content', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('prompt content');
      vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: 1234 } as any);
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app).get('/api/prompt/grp1');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('content');
      expect(res.body.data).toHaveProperty('mtime');
    });

    it('returns empty when file does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app).get('/api/prompt/grp1');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ content: '', mtime: 0 });
    });

    it('returns 400 for invalid folder', async () => {
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app).get('/api/prompt/bad!folder');
      expect(res.status).toBe(400);
    });
  });

  // PUT /api/prompt/:groupFolder
  describe('PUT /api/prompt/:groupFolder', () => {
    it('saves prompt content', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: 5000 } as any);
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app)
        .put('/api/prompt/grp1')
        .send({ content: '# Custom Prompt' });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('mtime');
    });

    it('returns 400 when content missing', async () => {
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app).put('/api/prompt/grp1').send({});
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid folder', async () => {
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app)
        .put('/api/prompt/bad!folder')
        .send({ content: 'x' });
      expect(res.status).toBe(400);
    });

    it('returns 409 on mtime conflict', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: 9999 } as any);
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app)
        .put('/api/prompt/grp1')
        .send({ content: 'x', expectedMtime: 1000 });
      expect(res.status).toBe(409);
    });
  });

  // GET /api/memory/:groupFolder
  describe('GET /api/memory/:groupFolder', () => {
    it('returns memory summary', async () => {
      vi.mocked(dbModule.getMemorySummary).mockReturnValue(
        'some memory' as any,
      );
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app).get('/api/memory/grp1');
      expect(res.status).toBe(200);
      expect(res.body.data).toBe('some memory');
    });

    it('returns null when no memory', async () => {
      vi.mocked(dbModule.getMemorySummary).mockReturnValue(undefined as any);
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app).get('/api/memory/grp1');
      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
    });

    it('returns 400 for invalid folder', async () => {
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app).get('/api/memory/bad!folder');
      expect(res.status).toBe(400);
    });
  });

  // GET /api/search
  describe('GET /api/search', () => {
    it('searches messages', async () => {
      vi.mocked(searchModule.searchMessages).mockReturnValue([
        { id: 1 },
      ] as any);
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app).get('/api/search?q=hello');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('returns 400 when q missing', async () => {
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app).get('/api/search');
      expect(res.status).toBe(400);
    });

    it('returns 400 when q is blank', async () => {
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app).get('/api/search?q=   ');
      expect(res.status).toBe(400);
    });

    it('accepts limit and offset params', async () => {
      vi.mocked(searchModule.searchMessages).mockReturnValue([]);
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app).get(
        '/api/search?q=test&limit=5&offset=10',
      );
      expect(res.status).toBe(200);
    });

    it('returns 400 for invalid limit', async () => {
      const deps = createGroupsDeps();
      const app = createTestApp(createGroupsRouter(deps));
      const res = await request(app).get('/api/search?q=test&limit=abc');
      expect(res.status).toBe(400);
    });
  });
});
