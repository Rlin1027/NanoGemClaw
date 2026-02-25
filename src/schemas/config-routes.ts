import { z } from 'zod';

/** PUT /api/config body */
export const configUpdateBody = z.object({
  maintenanceMode: z.boolean().optional(),
  logLevel: z.string().optional(),
});
