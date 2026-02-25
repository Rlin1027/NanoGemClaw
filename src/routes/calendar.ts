import { Router } from 'express';
import type { z } from 'zod';
import { logger } from '../logger.js';
import { validate } from '../middleware/validate.js';
import {
  calendarConfigBody,
  calendarDeleteBody,
  calendarEventsQuery,
} from '../schemas/calendar.js';

export function createCalendarRouter(): Router {
  const router = Router();

  // GET /api/calendar/configs
  router.get('/calendar/configs', async (_req, res) => {
    try {
      const { getCalendarConfigs } = await import('../google-calendar.js');
      const configs = getCalendarConfigs();
      res.json({ data: configs });
    } catch {
      res.status(500).json({ error: 'Failed to fetch calendar configs' });
    }
  });

  // POST /api/calendar/configs
  router.post(
    '/calendar/configs',
    validate({ body: calendarConfigBody }),
    async (req, res) => {
      try {
        const { url, name } = req.body;
        const { saveCalendarConfig } = await import('../google-calendar.js');
        saveCalendarConfig({ url, name });
        res.json({ data: { success: true } });
      } catch {
        res.status(500).json({ error: 'Failed to save calendar config' });
      }
    },
  );

  // DELETE /api/calendar/configs
  router.delete(
    '/calendar/configs',
    validate({ body: calendarDeleteBody }),
    async (req, res) => {
      try {
        const { url } = req.body;
        const { removeCalendarConfig } = await import('../google-calendar.js');
        const removed = removeCalendarConfig(url);
        res.json({ data: { removed } });
      } catch {
        res.status(500).json({ error: 'Failed to remove calendar config' });
      }
    },
  );

  // GET /api/calendar/events
  router.get(
    '/calendar/events',
    validate({ query: calendarEventsQuery }),
    async (req, res) => {
      try {
        const { getCalendarConfigs, fetchCalendarEvents } =
          await import('../google-calendar.js');

        const { days } = req.query as unknown as z.infer<
          typeof calendarEventsQuery
        >;
        const configs = getCalendarConfigs();

        const allEvents = [];
        for (const config of configs) {
          try {
            const events = await fetchCalendarEvents(config, days);
            allEvents.push(...events);
          } catch (err) {
            logger.warn(
              { config: config.name, err },
              'Failed to fetch calendar events',
            );
          }
        }

        // Sort by start time
        allEvents.sort((a, b) => a.start.getTime() - b.start.getTime());

        res.json({ data: allEvents });
      } catch {
        res.status(500).json({ error: 'Failed to fetch calendar events' });
      }
    },
  );

  return router;
}
