import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../skills.js', () => ({
  scanAvailableSkills: vi.fn(() => [{ id: 'skill1', name: 'Test Skill' }]),
  getGroupSkills: vi.fn(() => ['skill1']),
  enableGroupSkill: vi.fn(),
  disableGroupSkill: vi.fn(),
}));

vi.mock('../config.js', () => ({
  GROUPS_DIR: '/test/groups',
}));

import request from 'supertest';
import { createTestApp, createMockDeps } from './helpers/route-test-setup.js';
import { createSkillsRouter } from '../routes/skills.js';

function makeApp(validateFolder?: (folder: string) => boolean) {
  const deps = createMockDeps();
  if (validateFolder) {
    deps.validateFolder = vi.fn(validateFolder);
  }
  return createTestApp(
    createSkillsRouter({ validateFolder: deps.validateFolder }),
  );
}

describe('routes/skills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/skills', () => {
    it('returns 200 with skills array', async () => {
      const app = makeApp();
      const res = await request(app).get('/api/skills');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([{ id: 'skill1', name: 'Test Skill' }]);
    });

    it('returns 500 when import fails', async () => {
      const { scanAvailableSkills } = await import('../skills.js');
      vi.mocked(scanAvailableSkills).mockImplementationOnce(() => {
        throw new Error('module error');
      });
      const app = makeApp();
      const res = await request(app).get('/api/skills');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to fetch skills' });
    });
  });

  describe('GET /api/groups/:folder/skills', () => {
    it('returns 200 with skill IDs for valid folder', async () => {
      const app = makeApp();
      const res = await request(app).get('/api/groups/mygroup/skills');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(['skill1']);
    });

    it('returns 400 for invalid folder', async () => {
      const app = makeApp(() => false);
      const res = await request(app).get('/api/groups/bad!folder/skills');
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Invalid folder' });
    });

    it('returns 400 for folder with special chars', async () => {
      const app = makeApp();
      const res = await request(app).get('/api/groups/bad%20folder/skills');
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Invalid folder' });
    });
  });

  describe('POST /api/groups/:folder/skills', () => {
    it('enables a skill and returns 200', async () => {
      const app = makeApp();
      const res = await request(app)
        .post('/api/groups/mygroup/skills')
        .send({ skillId: 'skill1', enabled: true });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { success: true } });
    });

    it('disables a skill and returns 200', async () => {
      const app = makeApp();
      const res = await request(app)
        .post('/api/groups/mygroup/skills')
        .send({ skillId: 'skill1', enabled: false });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { success: true } });
    });

    it('returns 400 for invalid folder', async () => {
      const app = makeApp(() => false);
      const res = await request(app)
        .post('/api/groups/bad folder/skills')
        .send({ skillId: 'skill1', enabled: true });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Invalid folder' });
    });

    it('returns 400 when skillId is missing', async () => {
      const app = makeApp();
      const res = await request(app)
        .post('/api/groups/mygroup/skills')
        .send({ enabled: true });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/skillId/);
    });

    it('returns 400 when enabled is not a boolean', async () => {
      const app = makeApp();
      const res = await request(app)
        .post('/api/groups/mygroup/skills')
        .send({ skillId: 'skill1', enabled: 'yes' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/enabled/);
    });

    it('returns 400 when body is empty', async () => {
      const app = makeApp();
      const res = await request(app)
        .post('/api/groups/mygroup/skills')
        .send({});
      expect(res.status).toBe(400);
    });
  });
});
