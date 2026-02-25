import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../google-calendar.js', () => ({
  getCalendarConfigs: vi.fn(() => [{ url: 'https://cal.test', name: 'Test' }]),
  saveCalendarConfig: vi.fn(),
  removeCalendarConfig: vi.fn(() => true),
  fetchCalendarEvents: vi.fn(() => [
    {
      start: new Date('2025-01-01'),
      end: new Date('2025-01-02'),
      summary: 'Test Event',
    },
  ]),
}));

vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

import request from 'supertest';
import { createTestApp } from './helpers/route-test-setup.js';
import { createCalendarRouter } from '../routes/calendar.js';

function makeApp() {
  return createTestApp(createCalendarRouter());
}

describe('routes/calendar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/calendar/configs', () => {
    it('returns 200 with configs array', async () => {
      const app = makeApp();
      const res = await request(app).get('/api/calendar/configs');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([
        { url: 'https://cal.test', name: 'Test' },
      ]);
    });

    it('returns 500 when import fails', async () => {
      const { getCalendarConfigs } = await import('../google-calendar.js');
      vi.mocked(getCalendarConfigs).mockImplementationOnce(() => {
        throw new Error('module error');
      });
      const app = makeApp();
      const res = await request(app).get('/api/calendar/configs');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to fetch calendar configs' });
    });
  });

  describe('POST /api/calendar/configs', () => {
    it('saves config with valid url and name and returns 200', async () => {
      const app = makeApp();
      const res = await request(app)
        .post('/api/calendar/configs')
        .send({ url: 'https://cal.example.com', name: 'Work' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { success: true } });
    });

    it('returns 400 when url is missing', async () => {
      const app = makeApp();
      const res = await request(app)
        .post('/api/calendar/configs')
        .send({ name: 'Work' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/url/);
    });

    it('returns 400 when name is missing', async () => {
      const app = makeApp();
      const res = await request(app)
        .post('/api/calendar/configs')
        .send({ url: 'https://cal.example.com' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/name/);
    });

    it('returns 400 when url is not a string', async () => {
      const app = makeApp();
      const res = await request(app)
        .post('/api/calendar/configs')
        .send({ url: 123, name: 'Work' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when name is not a string', async () => {
      const app = makeApp();
      const res = await request(app)
        .post('/api/calendar/configs')
        .send({ url: 'https://cal.example.com', name: true });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/calendar/configs', () => {
    it('removes config with valid url and returns 200 with removed: true', async () => {
      const app = makeApp();
      const res = await request(app)
        .delete('/api/calendar/configs')
        .send({ url: 'https://cal.test' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { removed: true } });
    });

    it('returns 400 when url is missing', async () => {
      const app = makeApp();
      const res = await request(app).delete('/api/calendar/configs').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/url/);
    });

    it('returns 400 when url is not a string', async () => {
      const app = makeApp();
      const res = await request(app)
        .delete('/api/calendar/configs')
        .send({ url: 42 });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/calendar/events', () => {
    it('returns 200 with events array using default 7 days', async () => {
      const app = makeApp();
      const res = await request(app).get('/api/calendar/events');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data[0].summary).toBe('Test Event');
    });

    it('accepts valid days query param', async () => {
      const { fetchCalendarEvents } = await import('../google-calendar.js');
      const app = makeApp();
      const res = await request(app).get('/api/calendar/events?days=14');
      expect(res.status).toBe(200);
      expect(vi.mocked(fetchCalendarEvents)).toHaveBeenCalledWith(
        expect.anything(),
        14,
      );
    });

    it('returns 400 for invalid days param', async () => {
      const app = makeApp();
      const res = await request(app).get('/api/calendar/events?days=abc');
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Invalid days parameter' });
    });

    it('returns 500 when import fails entirely', async () => {
      const { getCalendarConfigs } = await import('../google-calendar.js');
      vi.mocked(getCalendarConfigs).mockImplementationOnce(() => {
        throw new Error('module error');
      });
      const app = makeApp();
      const res = await request(app).get('/api/calendar/events');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Failed to fetch calendar events' });
    });

    it('still returns other events when one calendar fetch fails', async () => {
      const { getCalendarConfigs, fetchCalendarEvents } =
        await import('../google-calendar.js');
      vi.mocked(getCalendarConfigs).mockReturnValueOnce([
        { url: 'https://cal1.test', name: 'Cal1' },
        { url: 'https://cal2.test', name: 'Cal2' },
      ]);
      vi.mocked(fetchCalendarEvents)
        .mockRejectedValueOnce(new Error('cal1 error'))
        .mockResolvedValueOnce([
          {
            start: new Date('2025-02-01'),
            end: new Date('2025-02-02'),
            summary: 'Cal2 Event',
          },
        ]);
      const app = makeApp();
      const res = await request(app).get('/api/calendar/events');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].summary).toBe('Cal2 Event');
    });
  });
});
