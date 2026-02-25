import { Router } from 'express';
import { logger } from '../logger.js';

interface CalendarRouterDeps {
  validateNumericParam: (value: string, name: string) => number | null;
}

export function createCalendarRouter(deps: CalendarRouterDeps): Router {
  const router = Router();
  const { validateNumericParam } = deps;

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
  router.post('/calendar/configs', async (req, res) => {
    try {
      const { url, name } = req.body;
      if (
        !url ||
        !name ||
        typeof url !== 'string' ||
        typeof name !== 'string'
      ) {
        res
          .status(400)
          .json({ error: 'Missing or invalid fields: url and name required' });
        return;
      }
      const { saveCalendarConfig } = await import('../google-calendar.js');
      saveCalendarConfig({ url, name });
      res.json({ data: { success: true } });
    } catch {
      res.status(500).json({ error: 'Failed to save calendar config' });
    }
  });

  // DELETE /api/calendar/configs
  router.delete('/calendar/configs', async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || typeof url !== 'string') {
        res
          .status(400)
          .json({ error: 'Missing or invalid field: url required' });
        return;
      }
      const { removeCalendarConfig } = await import('../google-calendar.js');
      const removed = removeCalendarConfig(url);
      res.json({ data: { removed } });
    } catch {
      res.status(500).json({ error: 'Failed to remove calendar config' });
    }
  });

  // GET /api/calendar/events
  router.get('/calendar/events', async (req, res) => {
    try {
      const { getCalendarConfigs, fetchCalendarEvents } =
        await import('../google-calendar.js');

      let days = 7;
      if (req.query.days) {
        const parsedDays = validateNumericParam(
          req.query.days as string,
          'days',
        );
        if (parsedDays === null) {
          res.status(400).json({ error: 'Invalid days parameter' });
          return;
        }
        days = parsedDays;
      }

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
  });

  return router;
}
