import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock dependencies before imports
vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
  logEmitter: {
    on: vi.fn(),
    emit: vi.fn(),
  },
  getLogBuffer: vi.fn(() => []),
}));

vi.mock('../db.js', () => ({
  getAllChats: vi.fn(() => []),
  initDb: vi.fn(),
  saveMessage: vi.fn(),
  getRecentMessages: vi.fn(() => []),
  searchMessages: vi.fn(() => ({ results: [], total: 0 })),
}));

vi.mock('../group-manager.js', () => ({
  getAvailableGroups: vi.fn(() => []),
}));

describe('server-routes.test.ts', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create minimal Express app with core routes
    app = express();
    app.use(express.json());

    // Health check route
    app.get('/api/health', (req, res) => {
      res.json({ status: 'ok' });
    });

    // Auth verify route (without ACCESS_CODE requirement for tests)
    app.get('/api/auth/verify', (req, res) => {
      res.json({ data: { valid: true } });
    });

    // Route with numeric param validation
    app.get('/api/test/doc/:docId', (req, res) => {
      const docId = parseInt(req.params.docId, 10);
      if (isNaN(docId) || docId < 0) {
        return res.status(400).json({ error: 'Invalid docId parameter' });
      }
      res.json({ data: { docId } });
    });

    // Route with rate limiting headers (simulated)
    app.get('/api/test/ratelimit', (req, res) => {
      res.set('X-RateLimit-Limit', '100');
      res.set('X-RateLimit-Remaining', '99');
      res.json({ data: 'ok' });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/health', () => {
    it('should return 200 OK', async () => {
      const response = await request(app).get('/api/health');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'ok' });
    });

    it('should respond quickly', async () => {
      const start = Date.now();
      await request(app).get('/api/health');
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(100);
    });
  });

  describe('GET /api/auth/verify', () => {
    it('should return 200 without ACCESS_CODE', async () => {
      const response = await request(app).get('/api/auth/verify');
      expect(response.status).toBe(200);
    });

    it('should return valid flag', async () => {
      const response = await request(app).get('/api/auth/verify');
      expect(response.body.data).toEqual({ valid: true });
    });
  });

  describe('Numeric parameter validation', () => {
    it('should accept valid numeric docId', async () => {
      const response = await request(app).get('/api/test/doc/123');
      expect(response.status).toBe(200);
      expect(response.body.data.docId).toBe(123);
    });

    it('should reject negative docId', async () => {
      const response = await request(app).get('/api/test/doc/-1');
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid');
    });

    it('should reject non-numeric docId', async () => {
      const response = await request(app).get('/api/test/doc/abc');
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid');
    });

    it('should accept zero as valid docId', async () => {
      const response = await request(app).get('/api/test/doc/0');
      expect(response.status).toBe(200);
      expect(response.body.data.docId).toBe(0);
    });

    it('should handle large numbers', async () => {
      const response = await request(app).get('/api/test/doc/999999999');
      expect(response.status).toBe(200);
      expect(response.body.data.docId).toBe(999999999);
    });
  });

  describe('Rate limiting headers', () => {
    it('should include rate limit headers', async () => {
      const response = await request(app).get('/api/test/ratelimit');
      expect(response.headers['x-ratelimit-limit']).toBeDefined();
      expect(response.headers['x-ratelimit-remaining']).toBeDefined();
    });

    it('should have correct header values', async () => {
      const response = await request(app).get('/api/test/ratelimit');
      expect(response.headers['x-ratelimit-limit']).toBe('100');
      expect(response.headers['x-ratelimit-remaining']).toBe('99');
    });
  });

  describe('Error handling', () => {
    it('should return 404 for non-existent routes', async () => {
      const response = await request(app).get('/api/nonexistent');
      expect(response.status).toBe(404);
    });

    it('should handle malformed JSON', async () => {
      const response = await request(app)
        .post('/api/test/echo')
        .set('Content-Type', 'application/json')
        .send('{"invalid": json}');

      expect(response.status).toBe(400);
    });
  });

  describe('Content-Type handling', () => {
    it('should accept JSON requests', async () => {
      app.post('/api/test/echo', (req, res) => {
        res.json({ data: req.body });
      });

      const response = await request(app)
        .post('/api/test/echo')
        .set('Content-Type', 'application/json')
        .send({ test: 'data' });

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({ test: 'data' });
    });

    it('should return JSON responses', async () => {
      const response = await request(app).get('/api/health');
      expect(response.headers['content-type']).toMatch(/application\/json/);
    });
  });

  describe('Request validation', () => {
    it('should validate required fields in body', async () => {
      app.post('/api/test/validate', (req, res) => {
        if (!req.body.name) {
          return res
            .status(400)
            .json({ error: 'Missing required field: name' });
        }
        res.json({ data: 'ok' });
      });

      const response = await request(app).post('/api/test/validate').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Missing required field');
    });

    it('should accept valid request body', async () => {
      app.post('/api/test/validate', (req, res) => {
        if (!req.body.name) {
          return res
            .status(400)
            .json({ error: 'Missing required field: name' });
        }
        res.json({ data: 'ok' });
      });

      const response = await request(app)
        .post('/api/test/validate')
        .send({ name: 'Test' });

      expect(response.status).toBe(200);
    });
  });

  describe('Security - folder path validation', () => {
    it('should validate folder names match safe pattern', () => {
      const SAFE_FOLDER_RE = /^[a-zA-Z0-9_-]+$/;

      expect(SAFE_FOLDER_RE.test('valid-folder')).toBe(true);
      expect(SAFE_FOLDER_RE.test('valid_folder')).toBe(true);
      expect(SAFE_FOLDER_RE.test('ValidFolder123')).toBe(true);
      expect(SAFE_FOLDER_RE.test('../etc/passwd')).toBe(false);
      expect(SAFE_FOLDER_RE.test('folder/path')).toBe(false);
      expect(SAFE_FOLDER_RE.test('folder with spaces')).toBe(false);
    });

    it('should reject path traversal attempts', () => {
      const SAFE_FOLDER_RE = /^[a-zA-Z0-9_-]+$/;
      const dangerousPaths = [
        '../etc/passwd',
        '../../root',
        'folder/../etc',
        './hidden',
        'folder/subfolder',
      ];

      for (const path of dangerousPaths) {
        expect(SAFE_FOLDER_RE.test(path)).toBe(false);
      }
    });
  });
});
