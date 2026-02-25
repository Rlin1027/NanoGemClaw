import { z } from 'zod';

/** POST /api/auth/verify body */
export const authVerifyBody = z.object({
  accessCode: z.string().optional(),
});
