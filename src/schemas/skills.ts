import { z } from 'zod';
import { folderParam } from './shared.js';

/** Route params for endpoints with :folder */
export const skillsFolderParams = z.object({
  folder: folderParam,
});

/** POST /api/groups/:folder/skills body */
export const skillsUpdateBody = z.object({
  skillId: z.string().min(1, 'Missing required field: skillId'),
  enabled: z.boolean({ message: 'Missing required field: enabled' }),
});
