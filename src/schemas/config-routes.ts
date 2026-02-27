import { z } from 'zod';

/** PUT /api/config body */
export const configUpdateBody = z.object({
  maintenanceMode: z.boolean().optional(),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).optional(),
});
