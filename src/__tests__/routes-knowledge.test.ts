import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../knowledge.js', () => ({
  getKnowledgeDocsPaginated: vi.fn(() => ({ rows: [], total: 0 })),
  addKnowledgeDoc: vi.fn(() => ({
    id: 1,
    group_folder: 'grp1',
    filename: 'doc.md',
    title: 'Doc',
    content: '',
  })),
  searchKnowledge: vi.fn(() => []),
  getKnowledgeDoc: vi.fn(() => ({
    id: 1,
    group_folder: 'grp1',
    filename: 'doc.md',
    title: 'Doc',
    content: 'hello',
  })),
  updateKnowledgeDoc: vi.fn(() => ({
    id: 1,
    group_folder: 'grp1',
    filename: 'doc.md',
    title: 'Updated',
    content: 'new',
  })),
  deleteKnowledgeDoc: vi.fn(),
}));

vi.mock('../db.js', () => ({
  getDatabase: vi.fn(() => ({})),
}));

vi.mock('../utils/pagination.js', () => ({
  parsePagination: vi.fn(() => ({ limit: 20, offset: 0 })),
}));

import request from 'supertest';
import { createTestApp, createMockDeps } from './helpers/route-test-setup.js';
import { createKnowledgeRouter } from '../routes/knowledge.js';
import * as knowledgeModule from '../knowledge.js';

function createKnowledgeDeps(overrides = {}) {
  return { ...createMockDeps(), ...overrides };
}

describe('routes/knowledge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(knowledgeModule.getKnowledgeDoc).mockReturnValue({
      id: 1,
      group_folder: 'grp1',
      filename: 'doc.md',
      title: 'Doc',
      content: 'hello',
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // GET /api/groups/:folder/knowledge
  describe('GET /api/groups/:folder/knowledge', () => {
    it('returns paginated knowledge docs', async () => {
      vi.mocked(knowledgeModule.getKnowledgeDocsPaginated).mockReturnValue({
        rows: [{ id: 1, title: 'Doc' }] as any,
        total: 1,
      });
      const app = createTestApp(createKnowledgeRouter(createKnowledgeDeps()));
      const res = await request(app).get('/api/groups/grp1/knowledge');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('pagination');
    });

    it('returns empty when no docs', async () => {
      vi.mocked(knowledgeModule.getKnowledgeDocsPaginated).mockReturnValue({
        rows: [],
        total: 0,
      });
      const app = createTestApp(createKnowledgeRouter(createKnowledgeDeps()));
      const res = await request(app).get('/api/groups/grp1/knowledge');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.total).toBe(0);
    });

    it('returns 400 for invalid folder', async () => {
      const app = createTestApp(createKnowledgeRouter(createKnowledgeDeps()));
      const res = await request(app).get('/api/groups/bad!folder/knowledge');
      expect(res.status).toBe(400);
    });

    it('returns 500 on error', async () => {
      vi.mocked(knowledgeModule.getKnowledgeDocsPaginated).mockImplementation(
        () => {
          throw new Error('DB error');
        },
      );
      const app = createTestApp(createKnowledgeRouter(createKnowledgeDeps()));
      const res = await request(app).get('/api/groups/grp1/knowledge');
      expect(res.status).toBe(500);
    });
  });

  // POST /api/groups/:folder/knowledge
  describe('POST /api/groups/:folder/knowledge', () => {
    it('creates a knowledge doc', async () => {
      const app = createTestApp(createKnowledgeRouter(createKnowledgeDeps()));
      const res = await request(app).post('/api/groups/grp1/knowledge').send({
        filename: 'my-doc.md',
        title: 'My Doc',
        content: 'Some content',
      });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('data');
    });

    it('returns 400 for invalid folder', async () => {
      const app = createTestApp(createKnowledgeRouter(createKnowledgeDeps()));
      const res = await request(app)
        .post('/api/groups/bad!folder/knowledge')
        .send({ filename: 'doc.md', title: 'Doc', content: '' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when filename missing', async () => {
      const app = createTestApp(createKnowledgeRouter(createKnowledgeDeps()));
      const res = await request(app)
        .post('/api/groups/grp1/knowledge')
        .send({ title: 'Doc', content: 'Content' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when title missing', async () => {
      const app = createTestApp(createKnowledgeRouter(createKnowledgeDeps()));
      const res = await request(app)
        .post('/api/groups/grp1/knowledge')
        .send({ filename: 'doc.md', content: 'Content' });
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid filename format', async () => {
      const app = createTestApp(createKnowledgeRouter(createKnowledgeDeps()));
      const res = await request(app)
        .post('/api/groups/grp1/knowledge')
        .send({ filename: 'my doc.txt', title: 'Doc', content: '' });
      expect(res.status).toBe(400);
    });

    it('returns 400 for filename without .md extension', async () => {
      const app = createTestApp(createKnowledgeRouter(createKnowledgeDeps()));
      const res = await request(app)
        .post('/api/groups/grp1/knowledge')
        .send({ filename: 'doc.txt', title: 'Doc', content: '' });
      expect(res.status).toBe(400);
    });

    it('returns 500 on error', async () => {
      vi.mocked(knowledgeModule.addKnowledgeDoc).mockImplementation(() => {
        throw new Error('DB error');
      });
      const app = createTestApp(createKnowledgeRouter(createKnowledgeDeps()));
      const res = await request(app)
        .post('/api/groups/grp1/knowledge')
        .send({ filename: 'doc.md', title: 'Doc', content: '' });
      expect(res.status).toBe(500);
    });
  });

  // GET /api/groups/:folder/knowledge/search
  describe('GET /api/groups/:folder/knowledge/search', () => {
    it('searches knowledge docs', async () => {
      vi.mocked(knowledgeModule.searchKnowledge).mockReturnValue([
        { id: 1 },
      ] as any);
      const app = createTestApp(createKnowledgeRouter(createKnowledgeDeps()));
      const res = await request(app).get(
        '/api/groups/grp1/knowledge/search?q=hello',
      );
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('returns empty array when no results', async () => {
      vi.mocked(knowledgeModule.searchKnowledge).mockReturnValue([]);
      const app = createTestApp(createKnowledgeRouter(createKnowledgeDeps()));
      const res = await request(app).get(
        '/api/groups/grp1/knowledge/search?q=nothing',
      );
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('returns 400 for invalid folder', async () => {
      const app = createTestApp(createKnowledgeRouter(createKnowledgeDeps()));
      const res = await request(app).get(
        '/api/groups/bad!folder/knowledge/search?q=test',
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when q missing', async () => {
      const app = createTestApp(createKnowledgeRouter(createKnowledgeDeps()));
      const res = await request(app).get('/api/groups/grp1/knowledge/search');
      expect(res.status).toBe(400);
    });

    it('returns 500 on error', async () => {
      vi.mocked(knowledgeModule.searchKnowledge).mockImplementation(() => {
        throw new Error('DB error');
      });
      const app = createTestApp(createKnowledgeRouter(createKnowledgeDeps()));
      const res = await request(app).get(
        '/api/groups/grp1/knowledge/search?q=test',
      );
      expect(res.status).toBe(500);
    });
  });

  // GET /api/groups/:folder/knowledge/:docId
  describe('GET /api/groups/:folder/knowledge/:docId', () => {
    it('returns a knowledge doc', async () => {
      const app = createTestApp(createKnowledgeRouter(createKnowledgeDeps()));
      const res = await request(app).get('/api/groups/grp1/knowledge/1');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
    });

    it('returns 400 for invalid folder', async () => {
      const app = createTestApp(createKnowledgeRouter(createKnowledgeDeps()));
      const res = await request(app).get('/api/groups/bad!folder/knowledge/1');
      expect(res.status).toBe(400);
    });

    it('returns 400 for non-numeric docId', async () => {
      const app = createTestApp(createKnowledgeRouter(createKnowledgeDeps()));
      const res = await request(app).get('/api/groups/grp1/knowledge/abc');
      expect(res.status).toBe(400);
    });

    it('returns 404 when doc not found', async () => {
      vi.mocked(knowledgeModule.getKnowledgeDoc).mockReturnValue(
        undefined as any,
      );
      const app = createTestApp(createKnowledgeRouter(createKnowledgeDeps()));
      const res = await request(app).get('/api/groups/grp1/knowledge/99');
      expect(res.status).toBe(404);
    });

    it('returns 404 when doc belongs to different folder', async () => {
      vi.mocked(knowledgeModule.getKnowledgeDoc).mockReturnValue({
        id: 1,
        group_folder: 'other-group',
        filename: 'doc.md',
        title: 'Doc',
        content: '',
      } as any);
      const app = createTestApp(createKnowledgeRouter(createKnowledgeDeps()));
      const res = await request(app).get('/api/groups/grp1/knowledge/1');
      expect(res.status).toBe(404);
    });
  });

  // PUT /api/groups/:folder/knowledge/:docId
  describe('PUT /api/groups/:folder/knowledge/:docId', () => {
    it('updates a knowledge doc', async () => {
      const app = createTestApp(createKnowledgeRouter(createKnowledgeDeps()));
      const res = await request(app)
        .put('/api/groups/grp1/knowledge/1')
        .send({ title: 'Updated Title', content: 'New content' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
    });

    it('returns 400 for invalid folder', async () => {
      const app = createTestApp(createKnowledgeRouter(createKnowledgeDeps()));
      const res = await request(app)
        .put('/api/groups/bad!folder/knowledge/1')
        .send({ title: 'Title', content: '' });
      expect(res.status).toBe(400);
    });

    it('returns 400 for non-numeric docId', async () => {
      const app = createTestApp(createKnowledgeRouter(createKnowledgeDeps()));
      const res = await request(app)
        .put('/api/groups/grp1/knowledge/abc')
        .send({ title: 'Title', content: '' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when title missing', async () => {
      const app = createTestApp(createKnowledgeRouter(createKnowledgeDeps()));
      const res = await request(app)
        .put('/api/groups/grp1/knowledge/1')
        .send({ content: 'content' });
      expect(res.status).toBe(400);
    });

    it('returns 404 when doc not found', async () => {
      vi.mocked(knowledgeModule.getKnowledgeDoc).mockReturnValue(
        undefined as any,
      );
      const app = createTestApp(createKnowledgeRouter(createKnowledgeDeps()));
      const res = await request(app)
        .put('/api/groups/grp1/knowledge/99')
        .send({ title: 'Title', content: '' });
      expect(res.status).toBe(404);
    });

    it('returns 500 on error', async () => {
      vi.mocked(knowledgeModule.updateKnowledgeDoc).mockImplementation(() => {
        throw new Error('DB error');
      });
      const app = createTestApp(createKnowledgeRouter(createKnowledgeDeps()));
      const res = await request(app)
        .put('/api/groups/grp1/knowledge/1')
        .send({ title: 'Title', content: '' });
      expect(res.status).toBe(500);
    });
  });

  // DELETE /api/groups/:folder/knowledge/:docId
  describe('DELETE /api/groups/:folder/knowledge/:docId', () => {
    it('deletes a knowledge doc', async () => {
      const app = createTestApp(createKnowledgeRouter(createKnowledgeDeps()));
      const res = await request(app).delete('/api/groups/grp1/knowledge/1');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('success', true);
    });

    it('returns 400 for invalid folder', async () => {
      const app = createTestApp(createKnowledgeRouter(createKnowledgeDeps()));
      const res = await request(app).delete(
        '/api/groups/bad!folder/knowledge/1',
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 for non-numeric docId', async () => {
      const app = createTestApp(createKnowledgeRouter(createKnowledgeDeps()));
      const res = await request(app).delete('/api/groups/grp1/knowledge/abc');
      expect(res.status).toBe(400);
    });

    it('returns 404 when doc not found', async () => {
      vi.mocked(knowledgeModule.getKnowledgeDoc).mockReturnValue(
        undefined as any,
      );
      const app = createTestApp(createKnowledgeRouter(createKnowledgeDeps()));
      const res = await request(app).delete('/api/groups/grp1/knowledge/99');
      expect(res.status).toBe(404);
    });

    it('returns 404 when doc belongs to different folder', async () => {
      vi.mocked(knowledgeModule.getKnowledgeDoc).mockReturnValue({
        id: 1,
        group_folder: 'other-group',
        filename: 'doc.md',
        title: 'Doc',
        content: '',
      } as any);
      const app = createTestApp(createKnowledgeRouter(createKnowledgeDeps()));
      const res = await request(app).delete('/api/groups/grp1/knowledge/1');
      expect(res.status).toBe(404);
    });

    it('returns 500 on error', async () => {
      vi.mocked(knowledgeModule.deleteKnowledgeDoc).mockImplementation(() => {
        throw new Error('DB error');
      });
      const app = createTestApp(createKnowledgeRouter(createKnowledgeDeps()));
      const res = await request(app).delete('/api/groups/grp1/knowledge/1');
      expect(res.status).toBe(500);
    });
  });
});
