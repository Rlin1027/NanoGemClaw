import { describe, it, expect } from 'vitest';
import express, { type Request, type Response } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validate, formatZodError } from '../middleware/validate.js';

function makeApp(schemas: Parameters<typeof validate>[0]) {
  const app = express();
  app.use(express.json());
  app.post('/test', validate(schemas), (req: Request, res: Response) => {
    res.json({ body: req.body, params: req.params, query: req.query });
  });
  return app;
}

describe('validate middleware', () => {
  describe('body validation', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });

    it('passes valid body and calls next', async () => {
      const app = makeApp({ body: schema });
      const res = await request(app)
        .post('/test')
        .send({ name: 'Alice', age: 30 });
      expect(res.status).toBe(200);
      expect(res.body.body).toEqual({ name: 'Alice', age: 30 });
    });

    it('returns 400 for missing required field', async () => {
      const app = makeApp({ body: schema });
      const res = await request(app).post('/test').send({ name: 'Alice' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Missing required field: age/);
    });

    it('returns 400 for wrong type', async () => {
      const app = makeApp({ body: schema });
      const res = await request(app)
        .post('/test')
        .send({ name: 'Alice', age: 'not-a-number' });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('returns 400 for empty body when fields required', async () => {
      const app = makeApp({ body: schema });
      const res = await request(app).post('/test').send({});
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('query validation', () => {
    const schema = z.object({
      limit: z
        .string()
        .optional()
        .transform((v) => (v ? parseInt(v, 10) : 10)),
    });

    it('passes valid query and transforms value', async () => {
      const app = makeApp({ query: schema });
      const res = await request(app).post('/test?limit=5');
      expect(res.status).toBe(200);
      // JSON serialization preserves number type
      expect(res.body.query.limit).toEqual(5);
    });

    it('passes with missing optional query param', async () => {
      const app = makeApp({ query: schema });
      const res = await request(app).post('/test');
      expect(res.status).toBe(200);
    });
  });

  describe('formatZodError', () => {
    it('returns "Missing required field" for single undefined field', () => {
      const schema = z.object({ prompt: z.string() });
      const result = schema.safeParse({});
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = formatZodError(result.error);
        // Zod v4 reports missing fields as invalid_type with "received undefined"
        expect(msg).toMatch(/Missing required field: prompt/);
      }
    });

    it('returns issue message for single non-missing error', () => {
      const schema = z.object({ count: z.number().min(1, 'Too small') });
      const result = schema.safeParse({ count: 0 });
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = formatZodError(result.error);
        expect(msg).toBe('Too small');
      }
    });

    it('joins multiple issue messages with comma', () => {
      const schema = z.object({
        a: z.string(),
        b: z.string(),
      });
      const result = schema.safeParse({});
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = formatZodError(result.error);
        expect(msg).toContain(',');
      }
    });
  });

  describe('multiple schema validation', () => {
    it('validates both body and query', async () => {
      const app = makeApp({
        body: z.object({ name: z.string() }),
        query: z.object({ page: z.string().optional() }),
      });
      const res = await request(app)
        .post('/test?page=1')
        .send({ name: 'test' });
      expect(res.status).toBe(200);
    });

    it('returns 400 when body fails even if query passes', async () => {
      const app = makeApp({
        body: z.object({ name: z.string() }),
        query: z.object({ page: z.string().optional() }),
      });
      const res = await request(app).post('/test?page=1').send({});
      expect(res.status).toBe(400);
    });
  });
});
