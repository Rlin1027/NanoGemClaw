import { z } from 'zod';

/** POST /api/calendar/configs body */
export const calendarConfigBody = z.object({
  url: z
    .string()
    .min(1, 'Missing required field: url')
    .refine(
      (val) => {
        try {
          new URL(val);
          return true;
        } catch {
          return false;
        }
      },
      { message: 'Invalid URL format' },
    ),
  name: z.string().min(1, 'Missing required field: name'),
});

/** DELETE /api/calendar/configs body */
export const calendarDeleteBody = z.object({
  url: z
    .string()
    .min(1, 'Missing required field: url')
    .refine(
      (val) => {
        try {
          new URL(val);
          return true;
        } catch {
          return false;
        }
      },
      { message: 'Invalid URL format' },
    ),
});

/** GET /api/calendar/events query */
export const calendarEventsQuery = z.object({
  days: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return 7;
      const n = parseInt(val, 10);
      if (isNaN(n) || n < 0) return null;
      return n;
    })
    .refine((val) => val !== null, { message: 'Invalid days parameter' }),
});
