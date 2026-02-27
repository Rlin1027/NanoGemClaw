import { z } from 'zod';
import { folderParam, chatIdParam, paginationQuery } from './shared.js';

/** Params for routes with :folder */
export const folderParams = z.object({
  folder: folderParam,
});

/** Params for routes with :groupFolder */
export const groupFolderParams = z.object({
  groupFolder: folderParam,
});

/** Params for routes with :chatId */
export const chatIdParams = z.object({
  chatId: chatIdParam,
});

/** Params for :key (persona key — same regex as folder) */
export const personaKeyParams = z.object({
  key: folderParam,
});

/** Pagination query */
export const groupsPaginationQuery = paginationQuery;

/** POST /api/groups/:chatId/register body */
export const registerGroupBody = z.object({
  name: z.string().min(1, 'Name is required'),
});

/** PUT /api/groups/:folder body — persona dynamic check stays in handler */
export const updateGroupBody = z.object({
  persona: z.string().optional(),
  enableWebSearch: z.boolean().optional(),
  requireTrigger: z.boolean().optional(),
  name: z.string().optional(),
  geminiModel: z.string().optional(),
});

/** POST /api/personas body */
export const createPersonaBody = z.object({
  key: folderParam,
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  systemPrompt: z.string().min(1, 'systemPrompt is required'),
});

/** PUT /api/groups/:folder/preferences body */
export const updatePreferencesBody = z.object({
  key: z.enum([
    'language',
    'nickname',
    'response_style',
    'interests',
    'timezone',
    'custom_instructions',
  ]),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.record(z.string(), z.unknown()),
    z.array(z.unknown()),
  ]),
});

/** PUT /api/prompt/:groupFolder body */
export const updatePromptBody = z.object({
  content: z.string(),
  expectedMtime: z.number().optional(),
});

/** GET /api/groups/:folder/export query */
export const exportQuery = z.object({
  format: z.string().optional(),
  since: z.string().optional(),
});

/** GET /api/search query */
export const searchQuery = z.object({
  q: z.string().min(1, 'Query parameter "q" is required'),
  group: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return 20;
      const n = parseInt(val, 10);
      return isNaN(n) || n < 0 ? null : n;
    }),
  offset: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return 0;
      const n = parseInt(val, 10);
      return isNaN(n) || n < 0 ? null : n;
    }),
});
