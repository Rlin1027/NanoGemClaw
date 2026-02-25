import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../utils/safe-compare.js', () => ({
  safeCompare: vi.fn((a: string, b: string) => a === b),
}));

import request from 'supertest';
import { createTestApp } from './helpers/route-test-setup.js';
import { createAuthRouter } from '../routes/auth.js';

describe('routes/auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('POST /api/auth/verify — with accessCode configured', () => {
    const app = createTestApp(createAuthRouter({ accessCode: 'test-secret' }));

    it('returns 200 with correct code in body', async () => {
      const res = await request(app)
        .post('/api/auth/verify')
        .send({ accessCode: 'test-secret' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { success: true } });
    });

    it('returns 200 with correct code in x-access-code header', async () => {
      const res = await request(app)
        .post('/api/auth/verify')
        .set('x-access-code', 'test-secret')
        .send({});
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { success: true } });
    });

    it('prefers header over body when both provided', async () => {
      const res = await request(app)
        .post('/api/auth/verify')
        .set('x-access-code', 'test-secret')
        .send({ accessCode: 'wrong' });
      expect(res.status).toBe(200);
    });

    it('returns 401 with wrong code in body', async () => {
      const res = await request(app)
        .post('/api/auth/verify')
        .send({ accessCode: 'wrong-code' });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Invalid access code' });
    });

    it('returns 401 with wrong code in header', async () => {
      const res = await request(app)
        .post('/api/auth/verify')
        .set('x-access-code', 'wrong-code')
        .send({});
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: 'Invalid access code' });
    });

    it('returns 401 with empty code', async () => {
      const res = await request(app)
        .post('/api/auth/verify')
        .send({ accessCode: '' });
      expect(res.status).toBe(401);
    });

    it('returns 401 with missing code', async () => {
      const res = await request(app).post('/api/auth/verify').send({});
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/auth/verify — no accessCode configured', () => {
    const app = createTestApp(createAuthRouter({ accessCode: undefined }));

    it('returns 200 with any code', async () => {
      const res = await request(app)
        .post('/api/auth/verify')
        .send({ accessCode: 'anything' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { success: true } });
    });

    it('returns 200 with no code at all', async () => {
      const res = await request(app).post('/api/auth/verify').send({});
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { success: true } });
    });
  });
});
